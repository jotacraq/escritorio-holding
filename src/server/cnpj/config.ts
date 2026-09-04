import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lê um valor inteiro de `configuracoes`. Duplicado de propósito a partir de
 * `src/server/importacao/config.ts`/`src/server/agenda/config.ts` — mesmo
 * comentário deles vale aqui: agentes com fronteiras de arquivo disjuntas não
 * devem depender uns dos outros (docs/ARQUITETURA-FASE-3.md §6, regra 1).
 *
 * `padrao` só cobre "a chave nunca foi semeada" ou falha pontual de leitura;
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

export const CHAVE_VALIDADE_DIAS = "cnpj.validade_dias";
export const VALIDADE_DIAS_PADRAO = 30;
