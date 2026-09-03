import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lê um valor inteiro de `configuracoes` (mesmo padrão de
 * `src/server/agenda/config.ts`, duplicado aqui de propósito — os dois
 * agentes possuem arquivos disjuntos e não devem depender um do outro).
 * Tamanho máximo de arquivo e limite de linhas da importação NÃO são
 * constante em TypeScript: são valor inicial, ajustável em Admin sem deploy
 * (ver 0035, mesma filosofia de `link.*`/`ia.*` em 0027).
 *
 * `padrao` só cobre "a chave nunca foi semeada" ou falha de leitura pontual;
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

export const CHAVE_TAMANHO_MAXIMO_BYTES = "importacao.tamanho_maximo_bytes";
export const CHAVE_LIMITE_LINHAS = "importacao.limite_linhas";

export const TAMANHO_MAXIMO_BYTES_PADRAO = 5 * 1024 * 1024; // 5 MiB
export const LIMITE_LINHAS_PADRAO = 5000;
