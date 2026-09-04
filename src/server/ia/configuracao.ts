import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Leitura de `configuracoes` para o domínio de IA (BLOQUEIO B24 —
 * ARQUITETURA-FASE-3.md §1.7/§1.10): teto de completude, pesos do score,
 * liga/desliga do orçamento de escrita. Mesma ideia de
 * `src/server/agenda/config.ts` (não é fronteira deste agente, por isso um
 * arquivo próprio aqui) — chave nova é migration (0027/0042), nunca escrita
 * livre pela tela; `padrao` só cobre falha pontual de leitura ou seed ausente,
 * nunca mascara um valor real diferente do padrão.
 */

export async function lerConfiguracaoInt(
  supabase: SupabaseClient,
  chave: string,
  padrao: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle<{ valor: unknown }>();

  if (error || data == null) return padrao;
  const valor = Number(data.valor);
  return Number.isFinite(valor) ? valor : padrao;
}

export async function lerConfiguracaoBool(
  supabase: SupabaseClient,
  chave: string,
  padrao: boolean,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle<{ valor: unknown }>();

  if (error || data == null) return padrao;
  if (typeof data.valor === "boolean") return data.valor;
  if (data.valor === "true") return true;
  if (data.valor === "false") return false;
  return padrao;
}

export async function lerConfiguracaoJson<T>(
  supabase: SupabaseClient,
  chave: string,
  padrao: T,
): Promise<T> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle<{ valor: unknown }>();

  if (error || data == null || data.valor == null) return padrao;
  return data.valor as T;
}

/** Chaves do domínio de IA — nomeadas aqui para não espalhar string solta (0027/0042). */
export const CHAVE_COOLDOWN_SEGUNDOS = "ia.cooldown_segundos";
export const CHAVE_TETO_EXECUCOES_DIA_POR_USUARIO = "ia.teto_execucoes_dia_por_usuario";
export const CHAVE_COMPLETUDE_PESOS = "ia.completude_pesos";
export const CHAVE_COMPLETUDE_MINIMA_BRIEFING = "ia.completude_minima_briefing";
export const CHAVE_ORCAMENTO_ESCRITA_ATIVO = "ia.orcamento_escrita_ativo";
