import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Leitura de `configuracoes` para as integrações (chaves semeadas em 0053/0054
 * e 0052). Mesmo contrato de `agenda/config.ts`: o `padrao` só cobre chave
 * ausente ou falha de leitura, nunca mascara valor real.
 */
export const CHAVE_LIGACAO_AUTOMATICA = "ligacao_ia.automatica";
export const CHAVE_LIGACAO_PROVEDOR = "ligacao_ia.provedor";
export const CHAVE_LIGACAO_MAX_TENTATIVAS = "ligacao_ia.max_tentativas";
export const CHAVE_LIGACAO_INTERVALO_MIN = "ligacao_ia.intervalo_retentativa_minutos";
export const CHAVE_LIGACAO_TIMEOUT_MIN = "ligacao_ia.timeout_minutos";
export const CHAVE_CANAL_WHATSAPP = "regua.canal_whatsapp";
export const CHAVE_SALA_PROVEDOR = "sala.provedor";
export const CHAVE_ULTIMO_CRON = "regua.ultimo_cron_em";

export async function lerConfiguracoes(
  supabase: SupabaseClient,
  chaves: string[],
): Promise<Map<string, { valor: unknown; descricao: string }>> {
  const mapa = new Map<string, { valor: unknown; descricao: string }>();
  if (chaves.length === 0) return mapa;
  const { data, error } = await supabase.from("configuracoes").select("chave, valor, descricao").in("chave", chaves);
  if (error || !data) return mapa;
  for (const linha of data as Array<{ chave: string; valor: unknown; descricao: string }>) {
    mapa.set(linha.chave, { valor: linha.valor, descricao: linha.descricao });
  }
  return mapa;
}

export async function lerConfiguracaoTexto(supabase: SupabaseClient, chave: string, padrao: string): Promise<string> {
  const mapa = await lerConfiguracoes(supabase, [chave]);
  const valor = mapa.get(chave)?.valor;
  return typeof valor === "string" && valor.length > 0 ? valor : padrao;
}

export async function lerConfiguracaoBool(supabase: SupabaseClient, chave: string, padrao: boolean): Promise<boolean> {
  const mapa = await lerConfiguracoes(supabase, [chave]);
  const valor = mapa.get(chave)?.valor;
  return typeof valor === "boolean" ? valor : padrao;
}

export async function lerConfiguracaoInteiro(supabase: SupabaseClient, chave: string, padrao: number): Promise<number> {
  const mapa = await lerConfiguracoes(supabase, [chave]);
  const valor = Number(mapa.get(chave)?.valor);
  return Number.isFinite(valor) && valor >= 0 ? valor : padrao;
}
