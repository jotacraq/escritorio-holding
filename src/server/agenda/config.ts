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

/**
 * Lê um valor booleano de `configuracoes` — mesmo formato de `lerConfiguracaoInt`
 * acima, mesma regra de `padrao` (só cobre chave ausente/falha pontual de
 * leitura). Espelha `server/ia/configuracao.ts::lerConfiguracaoBool` — cada
 * domínio tem o seu porque nenhum dos dois é fronteira do outro.
 */
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

/** Chaves usadas pelo domínio de agenda — nomeadas aqui para não espalhar string solta. */
export const CHAVE_DURACAO_PADRAO_MINUTOS = "agenda.duracao_padrao_minutos";
export const CHAVE_SLOTS_OFERTADOS_AO_CLIENTE = "agenda.slots_ofertados_ao_cliente";
export const CHAVE_ANTECEDENCIA_MINIMA_HORAS = "agenda.antecedencia_minima_horas";
export const CHAVE_HORIZONTE_DIAS_OFERTA = "agenda.horizonte_dias_oferta";

/**
 * 17/09/2026 — "iniciar a sessão quando quiser, sem burocracia" (Fatia 1).
 * Kill-switch de `POST /api/jornadas/[id]/sessao/iniciar`: nasce `true`
 * (pedido explícito do dono — a filosofia é REMOVER exigência, não acrescentar
 * trava nova). `false` faz a rota devolver 409 `recurso_desligado`.
 */
export const CHAVE_INICIO_DIRETO_DO_CARD = "sessao.inicio_direto_do_card";
