import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lê um valor inteiro de `configuracoes` (BLOQUEIO B12, ARQUITETURA-FASE-2 §4.0/§4.2):
 * duração de sessão, antecedência mínima e horizonte de oferta NÃO vêm do
 * método — são valor inicial, ajustável em Admin sem deploy. Este arquivo é o
 * ÚNICO lugar do domínio de agenda que sabe ler essa tabela; nenhuma rota deve
 * hardcodar `60`/`24`/`6`/`21` em TypeScript.
 *
 * `padrao` só cobre "a chave nunca foi semeada" (não deveria acontecer — as
 * chaves nascem em 0027/0029) ou falha de leitura pontual; nunca mascara um
 * valor real diferente do padrão.
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

/** Chaves usadas pelo domínio de agenda — nomeadas aqui para não espalhar string solta. */
export const CHAVE_DURACAO_PADRAO_MINUTOS = "agenda.duracao_padrao_minutos";
export const CHAVE_SLOTS_OFERTADOS_AO_CLIENTE = "agenda.slots_ofertados_ao_cliente";
export const CHAVE_ANTECEDENCIA_MINIMA_HORAS = "agenda.antecedencia_minima_horas";
export const CHAVE_HORIZONTE_DIAS_OFERTA = "agenda.horizonte_dias_oferta";
