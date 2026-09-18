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

/**
 * 🔴 LEITURA EM LOTE DE FLAGS BOOLEANAS (18/09/2026, achado do Fable).
 *
 * `GET /api/sessoes/[id]/copiloto` é a rota de POLLING — `usePollingCopiloto`
 * bate a cada **3 000 ms** com a tela em foco. Cada `lerConfiguracaoBool` é
 * uma ida ao PostgREST; `montarEstadoCopiloto` fazia várias por chamada, e
 * numa sessão de 2 h isso é milhares de requisições para ler um punhado de
 * booleanos que quase nunca mudam.
 *
 * `chave` é PK de `configuracoes` (0027), então cada leitura unitária é
 * barata — o problema nunca foi o plano, foi a QUANTIDADE. Este leitor troca
 * N requisições por UMA (`in('chave', [...])`), preservando exatamente a
 * semântica de `lerConfiguracaoBool` por chave: ausente, ilegível ou de tipo
 * inesperado cai no padrão informado, NUNCA no lado oposto.
 *
 * Fail-safe do lote inteiro: se a query falhar, todas as chaves caem no seu
 * padrão — o mesmo que aconteceria com as leituras unitárias. Isso preserva o
 * fail-CLOSED de quem passa `false` como padrão (`copiloto_sessao.resumo_
 * acumulado`, B76) e o fail-OPEN de quem passa `true` (`dossie_cliente`,
 * `inventario_mencionado`), sem misturar as duas posturas num comportamento
 * global.
 */
export async function lerConfiguracoesBool<K extends string>(
  supabase: SupabaseClient,
  padroes: Record<K, boolean>,
): Promise<Record<K, boolean>> {
  const chaves = Object.keys(padroes) as K[];
  const resultado = { ...padroes };

  // 🔴 `try/catch`, não só `if (error)`. Esta função roda no GET de polling; um
  // THROW aqui (driver diferente, cliente sem `.in`, rede caindo no meio)
  // subiria pela rota e viraria HTTP 500 na tela ao vivo da advogada — foi
  // exatamente o que apareceu quando um mock de teste não implementava `.in`.
  // Config ilegível tem UMA resposta correta: cair no padrão de cada chave,
  // que é o mesmo que as leituras unitárias já faziam. Nunca derrubar quem
  // chamou.
  let data: Array<{ chave: string; valor: unknown }> | null = null;
  try {
    const resposta = await supabase
      .from("configuracoes")
      .select("chave, valor")
      .in("chave", chaves)
      .returns<Array<{ chave: string; valor: unknown }>>();
    if (resposta.error) return resultado;
    data = resposta.data;
  } catch {
    return resultado;
  }

  if (!Array.isArray(data)) return resultado;

  for (const linha of data) {
    const chave = linha.chave as K;
    if (!(chave in resultado)) continue;
    if (typeof linha.valor === "boolean") resultado[chave] = linha.valor;
    else if (linha.valor === "true") resultado[chave] = true;
    else if (linha.valor === "false") resultado[chave] = false;
    // qualquer outro tipo: mantém o padrão já copiado
  }

  return resultado;
}
