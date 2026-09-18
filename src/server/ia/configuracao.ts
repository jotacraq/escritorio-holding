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
 * 🔴 ESPECIFICAÇÃO POR CHAVE para `lerConfiguracoesEmLote` — cada chave
 * declara seu próprio tipo (`bool` | `int` | `json`) e padrão. `json` cobre
 * também o caso de `ficha_teto_fixos`: 3 estados (`null` = deriva do
 * viewport, número = override, padrão = usado só quando a leitura falha),
 * então o "tipo" aqui não valida formato, só decide COMO interpretar
 * `valor` — igual `lerConfiguracaoJson` já fazia unitário.
 */
export type EspecificacaoConfig =
  | { tipo: "bool"; padrao: boolean }
  | { tipo: "int"; padrao: number }
  | { tipo: "json"; padrao: unknown };

type ValorResolvido<E extends EspecificacaoConfig> = E extends { tipo: "bool" }
  ? boolean
  : E extends { tipo: "int" }
    ? number
    : E["padrao"];

type ResultadoLote<E extends Record<string, EspecificacaoConfig>> = {
  [K in keyof E]: ValorResolvido<E[K]>;
};

/**
 * 🔴 LEITOR GENÉRICO EM LOTE — UMA query para bool + int + json juntos
 * (correção do Fable na 3ª rodada, 18/09/2026: a versão anterior somava
 * `lerConfiguracaoJson` de `ficha_teto_fixos` MAIS `lerConfiguracoesInt` do
 * silêncio como 2 idas A MAIS ao lado da leitura booleana — 3 requisições
 * onde cabia 1, e a 1ª delas incondicional mesmo com `ficha_cliente=false`,
 * que é o padrão de fábrica e o estado atual de produção).
 *
 * `montarEstadoCopiloto` (`estado.ts`) é quem bate essa função a cada tick de
 * `usePollingCopiloto` (3 s, tela em foco) — aqui SIM o número de idas
 * importa, porque multiplica por sessão ao vivo. Um único
 * `select chave, valor from configuracoes where chave in (...)` resolve
 * QUALQUER combinação de bool/int/json pedida, e cada chave é resolvida com
 * a MESMA semântica das leitoras unitárias que substitui:
 *
 * - `bool`: aceita booleano nativo ou texto `"true"`/`"false"`; qualquer
 *   outro valor (ou chave ausente, ou erro de query) cai no padrão da chave.
 * - `int`: `Number(valor)` finito; senão cai no padrão da chave.
 * - `json`: `valor` cru (pode ser `null` — é o 3º estado, não "ausente");
 *   só cai no padrão quando a CHAVE não veio na resposta ou a query falhou.
 *
 * Fail-safe do lote inteiro (erro de rede, driver sem `.in`, exceção): TODAS
 * as chaves caem no seu próprio padrão, nunca no lado oposto — preserva o
 * fail-CLOSED de quem passa `false`/`null`-como-ausente (`resumo_acumulado`,
 * B76) e o fail-OPEN de quem passa `true` (`inventario_mencionado`,
 * `dossie_cliente`) dentro do MESMO `try/catch` que as duas leitoras em
 * lote já usavam — nunca deixa uma exceção subir para a rota de polling.
 */
export async function lerConfiguracoesEmLote<E extends Record<string, EspecificacaoConfig>>(
  supabase: SupabaseClient,
  especificacao: E,
): Promise<ResultadoLote<E>> {
  const chaves = Object.keys(especificacao);
  const resultado = Object.fromEntries(
    chaves.map((chave) => [chave, especificacao[chave].padrao]),
  ) as ResultadoLote<E>;

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
    const chave = linha.chave;
    const spec = especificacao[chave];
    if (!spec) continue; // chave devolvida que não foi pedida: ignorada

    if (spec.tipo === "bool") {
      if (typeof linha.valor === "boolean") (resultado as Record<string, unknown>)[chave] = linha.valor;
      else if (linha.valor === "true") (resultado as Record<string, unknown>)[chave] = true;
      else if (linha.valor === "false") (resultado as Record<string, unknown>)[chave] = false;
      // outro tipo: mantém o padrão já copiado
    } else if (spec.tipo === "int") {
      const valor = Number(linha.valor);
      if (Number.isFinite(valor)) (resultado as Record<string, unknown>)[chave] = valor;
      // não-numérico: mantém o padrão já copiado
    } else {
      // "json": valor cru, incluindo `null` — é estado válido (ver ficha_teto_fixos),
      // não é "ausente". Só a AUSÊNCIA da chave na resposta usa o padrão.
      (resultado as Record<string, unknown>)[chave] = linha.valor;
    }
  }

  return resultado;
}

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
 * Mantida como fatia fina sobre `lerConfiguracoesEmLote` (3ª rodada, achado
 * do Fable) — quem só precisa de booleanos continua chamando isto sem lidar
 * com a especificação genérica. `montarEstadoCopiloto`, que já precisa
 * misturar bool + int + json no MESMO tick, chama `lerConfiguracoesEmLote`
 * direto, para não pagar 2 requisições onde cabe 1.
 */
export async function lerConfiguracoesBool<K extends string>(
  supabase: SupabaseClient,
  padroes: Record<K, boolean>,
): Promise<Record<K, boolean>> {
  const chaves = Object.keys(padroes) as K[];
  const especificacao = Object.fromEntries(
    chaves.map((chave) => [chave, { tipo: "bool" as const, padrao: padroes[chave] }]),
  ) as Record<K, EspecificacaoConfig>;
  return (await lerConfiguracoesEmLote(supabase, especificacao)) as unknown as Record<K, boolean>;
}

/**
 * 🔴 LEITURA EM LOTE DE INTEIROS (18/09/2026, Ficha do Cliente/migration
 * 0122) — MESMO padrão de `lerConfiguracoesBool` acima, espelhado para
 * `copiloto_sessao.silencio_atencao_s`/`silencio_alerta_s`.
 *
 * Mantida como fatia fina sobre `lerConfiguracoesEmLote` (ver comentário
 * acima) só para não obrigar quem já chama `lerConfiguracoesInt` isolado
 * (fora do polling) a lidar com a especificação genérica. Mesma semântica de
 * fail-safe: chave ausente, ilegível, não-inteira ou a query inteira
 * falhando caem no padrão INFORMADO por chave — nunca no lado oposto, nunca
 * lançam (roda também no GET de polling ao vivo).
 */
export async function lerConfiguracoesInt<K extends string>(
  supabase: SupabaseClient,
  padroes: Record<K, number>,
): Promise<Record<K, number>> {
  const chaves = Object.keys(padroes) as K[];
  const especificacao = Object.fromEntries(
    chaves.map((chave) => [chave, { tipo: "int" as const, padrao: padroes[chave] }]),
  ) as Record<K, EspecificacaoConfig>;
  return (await lerConfiguracoesEmLote(supabase, especificacao)) as unknown as Record<K, number>;
}

