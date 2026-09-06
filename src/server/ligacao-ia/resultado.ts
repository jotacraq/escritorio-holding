import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroApi, registrarErro } from "@/server/erros";
import {
  CHAVE_LIGACAO_INTERVALO_MIN,
  CHAVE_LIGACAO_JANELA,
  CHAVE_LIGACAO_MAX_TENTATIVAS,
  lerConfiguracaoInteiro,
  lerConfiguracaoObjeto,
} from "@/server/integracoes/config";
import { proximaAbertura, sanitizarJanela } from "./janela";
import type { LigacaoIa, PayloadLigacaoIaEntrada, ResultadoAplicarEvento } from "@/types/integracoes";
import { colunaAusente, urlDoLinkAgendamento, nomeEResponsavel } from "./fila";
import { reselarToken } from "./token-cifrado";
import { MOTIVOS_MANUAL, criarTarefaLigarParaAgendar } from "./manual";
import { STATUS_TERMINAIS } from "./tipos";

/**
 * Máquina de estados da ligação por IA, alimentada pelo webhook do n8n e pelo
 * reaper. A transcrição/gravação SÓ é armazenada aqui (RLS eh_interno); ela
 * nunca vai para a IA por este módulo — o gate `tratamento_ia` fica no
 * contexto do briefing (agente E), igual à transcrição da ligação humana.
 */

type CamposExtras = Pick<LigacaoIa, "id_externo" | "transcricao" | "resumo" | "gravacao_url" | "custo_usd" | "duracao_segundos">;

function extrasDoEvento(evento: PayloadLigacaoIaEntrada): Partial<CamposExtras> {
  const extras: Partial<CamposExtras> = {};
  if (typeof evento.id_externo === "string" && evento.id_externo) extras.id_externo = evento.id_externo.slice(0, 200);
  if (typeof evento.transcricao === "string") extras.transcricao = evento.transcricao;
  if (typeof evento.resumo === "string") extras.resumo = evento.resumo.slice(0, 4000);
  if (typeof evento.gravacao_url === "string") extras.gravacao_url = evento.gravacao_url.slice(0, 2000);
  if (typeof evento.custo_usd === "number" && Number.isFinite(evento.custo_usd) && evento.custo_usd >= 0) {
    extras.custo_usd = Math.round(evento.custo_usd * 10_000) / 10_000;
  }
  const duracao = evento.duracao_segundos ?? evento.duracao_s;
  if (typeof duracao === "number" && Number.isFinite(duracao) && duracao >= 0) extras.duracao_segundos = Math.round(duracao);
  return extras;
}

async function carregarLigacao(admin: SupabaseClient, id: string): Promise<LigacaoIa | null> {
  const { data, error } = await admin.from("ligacoes_ia").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as LigacaoIa | null) ?? null;
}

async function atualizar(admin: SupabaseClient, id: string, campos: Partial<LigacaoIa>): Promise<LigacaoIa> {
  const { data, error } = await admin.from("ligacoes_ia").update(campos).eq("id", id).select("*").single();
  if (error) throw error;
  return data as LigacaoIa;
}

function resposta(l: LigacaoIa, extra: Partial<ResultadoAplicarEvento> = {}): ResultadoAplicarEvento {
  return { ligacao_id: l.id, status: l.status, resultado: l.resultado, agendamento_id: l.agendamento_id, ...extra };
}

/**
 * Fallback quando a IA não agendou: a MESMA oferta segue por e-mail e WhatsApp
 * com o link `/p/a` (template `agendamento_link`, 0053). Sem link possível →
 * tarefa humana rotulada. Nunca silencioso.
 */
export async function enviarFallbackLink(admin: SupabaseClient, ligacao: LigacaoIa): Promise<"link_enfileirado" | "tarefa_criada" | "nada"> {
  const { url, motivo } = await urlDoLinkAgendamento(admin, ligacao);
  if (url) {
    const { data, error } = await admin.rpc("enfileirar_link_agendamento_ligacao_ia", { p_ligacao_id: ligacao.id, p_url: url });
    if (error) {
      registrarErro("ligacao-ia/resultado.enviarFallbackLink#rpc", error, { ligacao_id: ligacao.id });
    } else if (Number(data) > 0) {
      return "link_enfileirado";
    }
  }
  const { responsavelId } = await nomeEResponsavel(admin, ligacao.jornada_id).catch(() => ({ responsavelId: null }));
  // O motivo REAL na frente (link humano preservado, sem horário, sem pepper):
  // a equipe precisa saber por que a mensagem não saiu para saber o que fazer.
  const explicacao = (motivo && MOTIVOS_MANUAL[motivo]) || MOTIVOS_MANUAL.fallback_sem_link;
  const tarefa = await criarTarefaLigarParaAgendar(admin, {
    jornadaId: ligacao.jornada_id,
    responsavelId,
    descricao: `${explicacao}\nTelefone: ${ligacao.telefone}\nLigação por IA #${ligacao.id.slice(0, 8)}: ${ligacao.status}${ligacao.erro ? ` (${ligacao.erro})` : ""}.`,
  });
  return tarefa ? "tarefa_criada" : "nada";
}

/**
 * Depois de `sem_resposta`/`falhou`: nova tentativa (linha nova, mesmo link,
 * `nao_antes_de` = max(agora + intervalo, próxima abertura da janela)) enquanto
 * `tentativa < max_tentativas`; senão, fallback por link. A linha original fica
 * como histórico.
 *
 * A janela entra AQUI e não só no cron (Fase 7 · entrega 1b): sem isso, uma
 * ligação que falha às 18h50 com intervalo de 240 min ficaria elegível às 22h50
 * e o cron da abertura seguinte discaria — mas `nao_antes_de` é o que a Ficha
 * mostra ao operador, e mostrar "22h50" seria mentira.
 */
export async function tratarFalha(admin: SupabaseClient, ligacao: LigacaoIa): Promise<"reenfileirada" | "fallback"> {
  const [maxTentativas, intervaloMin, janelaBruta] = await Promise.all([
    lerConfiguracaoInteiro(admin, CHAVE_LIGACAO_MAX_TENTATIVAS, 2),
    lerConfiguracaoInteiro(admin, CHAVE_LIGACAO_INTERVALO_MIN, 240),
    lerConfiguracaoObjeto(admin, CHAVE_LIGACAO_JANELA),
  ]);

  if (ligacao.tentativa < maxTentativas) {
    const janela = sanitizarJanela(janelaBruta);
    const naoAntesDe = proximaAbertura(new Date(Date.now() + intervaloMin * 60_000), janela);
    const base = {
      jornada_id: ligacao.jornada_id,
      link_id: ligacao.link_id,
      provedor: ligacao.provedor,
      tentativa: ligacao.tentativa + 1,
      nao_antes_de: naoAntesDe.toISOString(),
      origem: ligacao.origem,
      solicitada_por: ligacao.solicitada_por,
      telefone: ligacao.telefone,
    };
    // B2 do pentest: a retentativa herda o MESMO `link_id`, então tem de herdar
    // também o token cifrado dele. Sem isso, depois de um restart a tentativa 2
    // não recupera o token, `urlDoLinkAgendamento` reemite e REVOGA o link que
    // o próprio sistema já tinha criado — o cliente que recebeu a primeira
    // mensagem clica e cai em "link inválido". (O link humano já estava
    // protegido por `linkAgendamentoAtivo`; este é o do sistema.)
    //
    // Herdar é RESELAR, não copiar: desde o v2 o AAD amarra o blob ao `id` da
    // linha (B1), então o `id` da nova linha é gerado aqui para que o token
    // possa ser cifrado de novo para ela. `null` a qualquer momento do caminho
    // (sem pepper, sem coluna, blob de outra origem) devolve exatamente o
    // comportamento anterior — nunca um erro.
    const novoId = randomUUID();
    const herdado = reselarToken(ligacao.token_link_cifrado ?? null, ligacao.id, novoId);
    let { error } = await admin.from("ligacoes_ia").insert({ ...base, id: novoId, token_link_cifrado: herdado });
    if (error && colunaAusente(error)) {
      // 0073 ainda não aplicada: reenfileira sem a coluna, como antes da Fase 7.
      ({ error } = await admin.from("ligacoes_ia").insert({ ...base, id: novoId }));
    }
    if (!error) return "reenfileirada";
    if (error.code !== "23505") {
      registrarErro("ligacao-ia/resultado.tratarFalha#reenfileirar", error, { ligacao_id: ligacao.id });
    }
    // 23505 = já existe outra ativa para a jornada (corrida) — não duplica; segue para o fallback.
  }

  await enviarFallbackLink(admin, ligacao);
  return "fallback";
}

/**
 * Aplica um evento do n8n. Idempotência por `id_evento` é da rota
 * (`webhooks_eventos`); aqui a proteção é a máquina de estados: ligação em
 * estado terminal ignora qualquer evento novo (e o trigger da 0053 garante
 * isso também no banco).
 */
export async function aplicarResultado(admin: SupabaseClient, evento: PayloadLigacaoIaEntrada): Promise<ResultadoAplicarEvento> {
  const ligacao = await carregarLigacao(admin, evento.ligacao_id);
  if (!ligacao) throw new ErroApi(404, "ligacao_nao_encontrada", "Ligação não encontrada.");

  if (STATUS_TERMINAIS.has(ligacao.status)) {
    return resposta(ligacao, { ignorado: "ligacao_encerrada" });
  }

  // DEFESA EM PROFUNDIDADE (achado A1 do pentest, 06/09/2026). A autenticação
  // de verdade é o HMAC da rota; isto é a segunda tranca, para o caso de o
  // segredo do n8n vazar ou de alguém achar como fazer o n8n assinar um corpo
  // forjado. `id_externo` é o id da CALL na Vapi: ele só é conhecido por quem
  // recebeu a resposta do disparo. Se a ligação já foi carimbada com um e chega
  // evento com outro, não é reentrega nem correção — são duas origens
  // disputando a mesma linha. Nada é alterado; o evento fica no livro-razão
  // com o motivo, que é o que a equipe precisa ver.
  if (typeof evento.id_externo === "string" && evento.id_externo && ligacao.id_externo && ligacao.id_externo !== evento.id_externo.slice(0, 200)) {
    registrarErro("ligacao-ia/resultado.aplicarResultado#id_externo_divergente", new Error("id_externo divergente"), {
      ligacao_id: ligacao.id,
      id_externo_registrado: ligacao.id_externo,
    });
    return resposta(ligacao, { ignorado: "id_externo_divergente" });
  }

  const extras = extrasDoEvento(evento);
  const agora = new Date().toISOString();
  const tipo = evento.evento ?? evento.estado;

  switch (tipo) {
    case "discando": {
      const campos: Partial<LigacaoIa> = { ...extras };
      if (ligacao.status === "na_fila") {
        campos.status = "discando";
        campos.disparada_em = ligacao.disparada_em ?? agora;
      }
      return resposta(await atualizar(admin, ligacao.id, campos));
    }

    case "em_ligacao": {
      return resposta(await atualizar(admin, ligacao.id, { ...extras, status: "em_ligacao", atendida_em: ligacao.atendida_em ?? agora }));
    }

    case "concluida": {
      if (evento.horario_escolhido) {
        const { data, error } = await admin.rpc("registrar_horario_ligacao_ia", {
          p_ligacao_id: ligacao.id,
          p_inicio: evento.horario_escolhido,
        });
        if (error) throw new Error(`registrar_horario_ligacao_ia: ${error.message}`);
        const nucleo = (data ?? {}) as { ok?: boolean; erro?: string; agendamento_id?: string };

        if (nucleo.ok) {
          // O núcleo já pôs concluida/agendou/agendamento_id; aqui só os extras.
          return resposta(await atualizar(admin, ligacao.id, { ...extras, encerrada_em: agora }));
        }

        // Horário fora dos ofertados, jornada sem pagamento, link vencido...:
        // a IA "concluiu" com um horário que o banco recusou. Não retenta a
        // ligação (o cliente já escolheu); manda o link para ele escolher de novo.
        const codigo = nucleo.erro ?? "horario_recusado";
        const atualizada = await atualizar(admin, ligacao.id, {
          ...extras,
          status: "falhou",
          erro: codigo,
          encerrada_em: agora,
          horario_escolhido: evento.horario_escolhido,
        });
        await enviarFallbackLink(admin, atualizada);
        return resposta(atualizada, { erro: codigo });
      }

      const atualizada = await atualizar(admin, ligacao.id, {
        ...extras,
        status: "concluida",
        resultado: evento.resultado ?? null,
        encerrada_em: agora,
        erro: evento.motivo_falha ?? null,
      });
      // Não agendou (recusou / pediu retorno / ...): o cliente ganha o link para escolher sozinho.
      await enviarFallbackLink(admin, atualizada);
      return resposta(atualizada);
    }

    case "sem_resposta": {
      const atualizada = await atualizar(admin, ligacao.id, {
        ...extras,
        status: "sem_resposta",
        resultado: evento.resultado ?? null,
        erro: evento.motivo_falha ?? null,
        encerrada_em: agora,
      });
      await tratarFalha(admin, atualizada);
      return resposta(atualizada);
    }

    case "falhou": {
      const atualizada = await atualizar(admin, ligacao.id, {
        ...extras,
        status: "falhou",
        resultado: evento.resultado ?? null,
        erro: evento.motivo_falha ?? "falha_no_provedor",
        encerrada_em: agora,
      });
      await tratarFalha(admin, atualizada);
      return resposta(atualizada);
    }

    default:
      throw new ErroApi(422, "evento_invalido", "Evento desconhecido.");
  }
}
