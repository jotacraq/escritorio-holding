import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Custo em USD nunca é constante no código — vive em `modelos_ia_precos`
 * (ARQUITETURA.md §4.6, §2.9). Trocar preço é UPDATE, não deploy.
 */

export interface TokensUso {
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheEscrita: number;
  tokensCacheLeitura: number;
}

interface PrecoModelo {
  entrada_usd_mtok: number;
  saida_usd_mtok: number;
  cache_escrita_mult: number;
  cache_leitura_mult: number;
}

/**
 * Busca o preço vigente do modelo (o mais recente com `vigente_desde <= hoje`) e
 * calcula o custo total em USD. Retorna `null` se não houver preço cadastrado —
 * a chamada deve gravar `custo_usd = null` em vez de inventar um número.
 */
export async function calcularCustoUsd(
  supabaseAdmin: SupabaseClient,
  modelo: string,
  uso: TokensUso,
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("modelos_ia_precos")
    .select("entrada_usd_mtok, saida_usd_mtok, cache_escrita_mult, cache_leitura_mult")
    .eq("modelo", modelo)
    .lte("vigente_desde", new Date().toISOString().slice(0, 10))
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle<PrecoModelo>();

  if (error || !data) {
    return null;
  }

  const mtok = 1_000_000;
  const custoEntrada = (uso.tokensEntrada / mtok) * data.entrada_usd_mtok;
  const custoSaida = (uso.tokensSaida / mtok) * data.saida_usd_mtok;
  const custoCacheEscrita =
    (uso.tokensCacheEscrita / mtok) * data.entrada_usd_mtok * data.cache_escrita_mult;
  const custoCacheLeitura =
    (uso.tokensCacheLeitura / mtok) * data.entrada_usd_mtok * data.cache_leitura_mult;

  return custoEntrada + custoSaida + custoCacheEscrita + custoCacheLeitura;
}
