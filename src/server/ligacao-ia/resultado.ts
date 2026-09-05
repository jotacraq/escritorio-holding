import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroApi, registrarErro } from "@/server/erros";
import {
  CHAVE_LIGACAO_INTERVALO_MIN,
  CHAVE_LIGACAO_MAX_TENTATIVAS,
  lerConfiguracaoInteiro,
} from "@/server/integracoes/config";
import type { LigacaoIa, PayloadLigacaoIaEntrada, ResultadoAplicarEvento } from "@/types/integracoes";
import { urlDoLinkAgendamento, nomeEResponsavel } from "./fila";
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
  const url = await urlDoLinkAgendamento(admin, ligacao);
  if (url) {
    const { data, error } = await admin.rpc("enfileirar_link_agendamento_ligacao_ia", { p_ligacao_id: ligacao.id, p_url: url });
    if (error) {
      registrarErro("ligacao-ia/resultado.enviarFallbackLink#rpc", error, { ligacao_id: ligacao.id });
    } else if (Number(data) > 0) {
      return "link_enfileirado";
    }
  }
  const { responsavelId } = await nomeEResponsavel(admin, ligacao.jornada_id).catch(() => ({ responsavelId: null }));
  const tarefa = await criarTarefaLigarParaAgendar(admin, {
    jornadaId: ligacao.jornada_id,
    responsavelId,
    descricao: `${MOTIVOS_MANUAL.fallback_sem_link}\nTelefone: ${ligacao.telefone}\nLigação por IA #${ligacao.id.slice(0, 8)}: ${ligacao.status}${ligacao.erro ? ` (${ligacao.erro})` : ""}.`,
  });
  return tarefa ? "tarefa_criada" : "nada";
}

/**
 * Depois de `sem_resposta`/`falhou`: nova tentativa (linha nova, mesmo link,
 * `nao_antes_de` = agora + intervalo) enquanto `tentativa < max_tentativas`;
 * senão, fallback por link. A linha original fica como histórico.
 */
export async function tratarFalha(admin: SupabaseClient, ligacao: LigacaoIa): Promise<"reenfileirada" | "fallback"> {
  const [maxTentativas, intervaloMin] = await Promise.all([
    lerConfiguracaoInteiro(admin, CHAVE_LIGACAO_MAX_TENTATIVAS, 2),
    lerConfiguracaoInteiro(admin, CHAVE_LIGACAO_INTERVALO_MIN, 240),
  ]);

  if (ligacao.tentativa < maxTentativas) {
    const { error } = await admin.from("ligacoes_ia").insert({
      jornada_id: ligacao.jornada_id,
      link_id: ligacao.link_id,
      provedor: ligacao.provedor,
      tentativa: ligacao.tentativa + 1,
      nao_antes_de: new Date(Date.now() + intervaloMin * 60_000).toISOString(),
      origem: ligacao.origem,
      solicitada_por: ligacao.solicitada_por,
      telefone: ligacao.telefone,
    });
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
