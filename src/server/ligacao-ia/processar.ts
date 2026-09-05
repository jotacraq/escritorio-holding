import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { LigacaoIa, ResultadoProcessarFilaLigacoes } from "@/types/integracoes";
import { nomeEResponsavel, prepararOferta } from "./fila";
import { provedorManual } from "./manual";
import { provedorN8n } from "./n8n";
import { tratarFalha } from "./resultado";
import { LIMITE_LOTE_FILA, type ContextoDisparo, type OfertaHorarios } from "./tipos";

/**
 * Dispara UMA ligação já reivindicada (status `discando`). Decide o provedor
 * de verdade aqui: `n8n` só quando configurado E há horários; senão o manual
 * assume com o motivo rotulado. Erro de rede/provedor → `falhou` + retentativa
 * pela regra de `tratarFalha`.
 */
export async function dispararLigacao(admin: SupabaseClient, ligacao: LigacaoIa): Promise<"disparada" | "manual" | "falha"> {
  try {
    const { nome, responsavelId } = await nomeEResponsavel(admin, ligacao.jornada_id);

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
        .update({ id_externo: resultado.tipo === "disparada" ? resultado.id_externo : null, erro: null })
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
 */
export async function processarFilaLigacoesIa(admin: SupabaseClient): Promise<ResultadoProcessarFilaLigacoes> {
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
