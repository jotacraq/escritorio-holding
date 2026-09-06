import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { CHAVE_LIGACAO_JANELA, lerConfiguracaoObjeto } from "@/server/integracoes/config";
import { telefoneParaLigacao } from "@/server/integracoes/telefone";
import type { LigacaoIa, ResultadoProcessarFilaLigacoes } from "@/types/integracoes";
import { nomeEResponsavel, prepararOferta } from "./fila";
import { dentroDaJanela, proximaAbertura, rotuloAbertura, sanitizarJanela } from "./janela";
import { provedorManual } from "./manual";
import { provedorN8n } from "./n8n";
import { tratarFalha } from "./resultado";
import { LIMITE_LOTE_FILA, type ContextoDisparo, type OfertaHorarios } from "./tipos";

/**
 * Dispara UMA ligação já reivindicada (status `discando`). Decide o provedor
 * de verdade aqui: `n8n` só quando configurado E há horários; senão o manual
 * assume com o motivo rotulado. Erro de rede/provedor → `falhou` + retentativa
 * pela regra de `tratarFalha`.
 *
 * A janela de discagem NÃO é conferida aqui de propósito: quem chega até este
 * ponto ou passou pela conferência da fila, ou é o botão humano "Ligar por IA
 * agora" — ordem explícita de uma pessoa, que vale fora do horário (§1c).
 */
export async function dispararLigacao(admin: SupabaseClient, ligacao: LigacaoIa): Promise<"disparada" | "manual" | "falha"> {
  try {
    const { nome, responsavelId } = await nomeEResponsavel(admin, ligacao.jornada_id);

    // O payload para o n8n/Vapi vai SEMPRE em E.164 (Fase 7 · entrega 2). A
    // linha pode ter vindo do gatilho SQL de pagamento (0053), que copia
    // `pessoas.telefone` sem normalizar — a validação tem de existir aqui também.
    const telefone = telefoneParaLigacao(ligacao.telefone);
    if (!telefone.valido) {
      await provedorManual.disparar({ admin, ligacao, nome, responsavelId, oferta: null, motivoManual: "telefone_invalido" });
      return "manual";
    }
    ligacao.telefone = telefone.e164;

    let oferta: OfertaHorarios | null = null;
    let motivoOferta: string | null = null;
    try {
      oferta = await prepararOferta(admin, ligacao);
      if (!oferta || oferta.horarios.length === 0) motivoOferta = "sem_horarios";
    } catch (erroOferta) {
      registrarErro("ligacao-ia/processar.prepararOferta", erroOferta, { ligacao_id: ligacao.id });
      motivoOferta = "sem_link";
    }

    const ctx: ContextoDisparo = { admin, ligacao, nome, responsavelId, oferta };

    if (ligacao.provedor === "n8n" && provedorN8n.configurado() && !motivoOferta) {
      const resultado = await provedorN8n.disparar(ctx);
      const { error } = await admin
        .from("ligacoes_ia")
        .update({
          id_externo: resultado.tipo === "disparada" ? resultado.id_externo : null,
          erro: null,
          // Guarda o número REALMENTE discado — é o que a equipe precisa ver
          // quando for conferir por que a ligação não completou.
          ...(telefone.alterado ? { telefone: telefone.e164 } : {}),
        })
        .eq("id", ligacao.id);
      if (error) throw error;
      return "disparada";
    }

    ctx.motivoManual =
      motivoOferta ?? (ligacao.provedor === "n8n" && !provedorN8n.configurado() ? "n8n_nao_configurado" : "provedor_manual");
    await provedorManual.disparar(ctx);
    return "manual";
  } catch (erro) {
    registrarErro("ligacao-ia/processar.dispararLigacao", erro, { ligacao_id: ligacao.id, jornada_id: ligacao.jornada_id });
    const mensagem = erro instanceof Error ? erro.message.slice(0, 500) : String(erro);
    const { data } = await admin
      .from("ligacoes_ia")
      .update({ status: "falhou", erro: mensagem, encerrada_em: new Date().toISOString() })
      .eq("id", ligacao.id)
      .in("status", ["discando", "na_fila"])
      .select("*")
      .maybeSingle();
    if (data) {
      await tratarFalha(admin, data as LigacaoIa).catch((e) =>
        registrarErro("ligacao-ia/processar.tratarFalha", e, { ligacao_id: ligacao.id }),
      );
    }
    return "falha";
  }
}

/**
 * Etapa do cron único (`POST /api/cron/regua`, agente A): reivindica a fila
 * (FOR UPDATE SKIP LOCKED na RPC) e dispara cada ligação. Falha em uma não
 * derruba as outras.
 *
 * Fase 7 · entrega 1a — FORA DA JANELA a etapa não reivindica NADA. Em vez de
 * simplesmente sair, carimba `nao_antes_de = próxima abertura` nas linhas
 * `na_fila` que ainda não têm data (o gatilho de pagamento da 0053 insere sem
 * ela). Dois ganhos: a própria RPC `reivindicar_ligacoes_ia` passa a filtrar
 * pela janela no banco, e a Ficha tem o que mostrar ("próxima tentativa …")
 * em vez de um "na fila" mudo às 3 da manhã. É UMA instrução, e só fora do
 * horário — nunca no caminho quente.
 */
export async function processarFilaLigacoesIa(admin: SupabaseClient): Promise<ResultadoProcessarFilaLigacoes> {
  const janela = sanitizarJanela(await lerConfiguracaoObjeto(admin, CHAVE_LIGACAO_JANELA));
  const agora = new Date();

  if (!dentroDaJanela(agora, janela)) {
    const abertura = proximaAbertura(agora, janela);
    const { error } = await admin
      .from("ligacoes_ia")
      .update({ nao_antes_de: abertura.toISOString() })
      .eq("status", "na_fila")
      .or(`nao_antes_de.is.null,nao_antes_de.lt.${abertura.toISOString()}`);
    if (error) registrarErro("ligacao-ia/processar.carimbarJanela", error);
    return {
      processadas: 0,
      disparadas: 0,
      manuais: 0,
      falhas: 0,
      pulada: "fora_da_janela",
      proxima_abertura_em: abertura.toISOString(),
      detalhe: `fora da janela de discagem, próxima abertura em ${rotuloAbertura(abertura, janela.fuso)}`,
    };
  }

  const { data, error } = await admin.rpc("reivindicar_ligacoes_ia", { p_limite: LIMITE_LOTE_FILA });
  if (error) throw new Error(`falha_ao_reivindicar_ligacoes_ia: ${error.message}`);

  const lote = (data ?? []) as LigacaoIa[];
  const resumo: ResultadoProcessarFilaLigacoes = { processadas: lote.length, disparadas: 0, manuais: 0, falhas: 0 };

  for (const ligacao of lote) {
    const resultado = await dispararLigacao(admin, ligacao);
    if (resultado === "disparada") resumo.disparadas += 1;
    else if (resultado === "manual") resumo.manuais += 1;
    else resumo.falhas += 1;
  }
  return resumo;
}

/**
 * Caminho do botão "Ligar por IA agora": reivindica SÓ esta ligação (se ainda
 * `na_fila`) e dispara na hora, sem esperar o cron. Se outra passagem já a
 * pegou, devolve null e nada é feito duas vezes.
 *
 * Ignora a janela por desenho (§1c): é uma pessoa da equipe apertando o botão,
 * olhando para o relógio. A UI é quem avisa que está fora do horário.
 */
export async function dispararAgora(admin: SupabaseClient, ligacaoId: string): Promise<"disparada" | "manual" | "falha" | null> {
  const { data, error } = await admin
    .from("ligacoes_ia")
    .update({ status: "discando", disparada_em: new Date().toISOString() })
    .eq("id", ligacaoId)
    .eq("status", "na_fila")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return dispararLigacao(admin, data as LigacaoIa);
}
