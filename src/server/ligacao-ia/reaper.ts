import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { CHAVE_LIGACAO_TIMEOUT_MIN, lerConfiguracaoInteiro } from "@/server/integracoes/config";
import type { LigacaoIa, ResultadoReaperLigacoes } from "@/types/integracoes";
import { tratarFalha } from "./resultado";

export const MOTIVO_TIMEOUT_REAPER = "timeout_reaper";

/**
 * Reaper (padrão `RSVP · REAPER · destrava 'discando' preso`): ligação em
 * `discando`/`em_ligacao` há mais de `ligacao_ia.timeout_minutos` vira
 * `falhou` (motivo `timeout_reaper`) e segue a regra de retentativa/fallback.
 * Roda dentro do MESMO cron da régua (§1.6), depois de `processarFilaLigacoesIa`.
 */
export async function reaperLigacoesIa(admin: SupabaseClient): Promise<ResultadoReaperLigacoes> {
  const timeoutMin = await lerConfiguracaoInteiro(admin, CHAVE_LIGACAO_TIMEOUT_MIN, 20);
  const limite = new Date(Date.now() - Math.max(timeoutMin, 1) * 60_000).toISOString();

  const { data, error } = await admin
    .from("ligacoes_ia")
    .update({ status: "falhou", erro: MOTIVO_TIMEOUT_REAPER, encerrada_em: new Date().toISOString() })
    .in("status", ["discando", "em_ligacao"])
    .lt("disparada_em", limite)
    .select("*");
  if (error) throw new Error(`falha_no_reaper_ligacoes_ia: ${error.message}`);

  const presas = (data ?? []) as LigacaoIa[];
  const resumo: ResultadoReaperLigacoes = { liberadas: presas.length, reenfileiradas: 0, fallback: 0 };

  for (const ligacao of presas) {
    try {
      const destino = await tratarFalha(admin, ligacao);
      if (destino === "reenfileirada") resumo.reenfileiradas += 1;
      else resumo.fallback += 1;
    } catch (erroTratar) {
      registrarErro("ligacao-ia/reaper.tratarFalha", erroTratar, { ligacao_id: ligacao.id });
    }
  }
  return resumo;
}
