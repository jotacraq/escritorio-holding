import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";

/**
 * Os TRÊS gatilhos do ciclo automático (Fase 10, Fatia 3,
 * docs/ARQUITETURA-FASE-10.md §4.3) — "o primeiro que ocorrer":
 *
 *   1. **tempo + fala nova**: ≥ `intervalo_segundos` (config `configuracoes`,
 *      20s desde 15/09/2026 — migration 0102) desde a última execução E ≥1
 *      segmento novo desde então. `intervaloSegundos` é OBRIGATÓRIO nos
 *      params de `avaliarGatilho` (Fase 11: a constante local que existia
 *      como fallback foi removida — quem chama sem passar o valor do banco
 *      não compila, em vez de herdar 45s em silêncio).
 *   2. **virada de bloco MANUAL** — com PISO de `PISO_VIRADA_BLOCO_SEGUNDOS`
 *      (8s) anti-martelada (trocar de bloco 3x em 3s não dispara 3 ciclos).
 *
 *      🔴 CORRIGIDO (Fase 12, Fatia 1): até esta fatia, `blocoAtualIndice`
 *      vinha SEMPRE da tela, e qualquer mudança de índice contava como
 *      "virada de bloco". Isso deixou de ser seguro quando o PRÓPRIO ciclo
 *      passou a poder mudar o bloco atual por inferência
 *      (`estado.ts::resolverBlocoAtual`, `ciclo.ts` grava `bloco_inferido`
 *      em `copiloto_sugestoes.bloco_id`): sem esta correção, a cadeia vira
 *      ciclo infere bloco novo → grava → a AVALIAÇÃO SEGUINTE vê o índice
 *      mudar → dispara "virada de bloco" (ignorando o piso de 20s do
 *      intervalo) → infere de novo → dispara de novo — um laço que
 *      multiplica chamadas de IA sem limite, alimentado pela própria saída
 *      do ciclo anterior. Por isso este gatilho agora SÓ conta quando a
 *      mudança de bloco veio de CORREÇÃO MANUAL (`origem === "manual"` no
 *      bloco novo) — mudança inferida pela IA já aconteceu DENTRO de um
 *      ciclo, por definição, e não é um evento novo que justifique disparar
 *      outro. O piso de `PISO_VIRADA_BLOCO_SEGUNDOS` continua valendo (a
 *      advogada corrigindo 3x em 3s ainda não dispara 3 ciclos).
 *   3. **sob demanda**: o botão da Fatia 2 — não passa por este módulo; ele
 *      já ignora o intervalo por natureza (`POST .../sugestao` não usa
 *      `copiloto_ciclos`, é fora do escopo desta claim).
 *
 * "NUNCA por turno de fala. NUNCA por cron fixo. Silêncio = zero chamada." —
 * este módulo é o que torna essa frase código: sem segmento novo E sem
 * virada de bloco MANUAL, `avaliarGatilho` devolve `nenhum`, mesmo que o
 * intervalo já tenha estourado há muito tempo (uma sessão em silêncio de 20
 * minutos não acumula 26 chamadas represadas — ela não dispara nenhuma).
 *
 * FUNÇÃO PURA no núcleo (`decidirGatilho`) — testável sem banco. A parte que
 * lê o banco (`avaliarGatilho`) só busca os fatos de que a função pura
 * precisa: quando foi o último ciclo desta sessão, se há segmento novo desde
 * então, e a ORIGEM do bloco na última claim vs. agora.
 */

const PISO_VIRADA_BLOCO_SEGUNDOS = 8;

export type TipoGatilhoCopiloto = "intervalo" | "virada_bloco" | "sob_demanda";

export interface DecisaoGatilho {
  dispara: boolean;
  gatilho: TipoGatilhoCopiloto | null;
}

/** Origem do bloco atual no momento de uma avaliação de gatilho — MESMO
 * conceito de `BlocoAtualResolvido.origem` (types/copiloto.ts), reduzido ao
 * que este módulo precisa distinguir: só `"manual"` conta como evento de
 * virada (ver comentário de topo). */
export type OrigemBlocoParaGatilho = "manual" | "inferido" | "indisponivel";

export interface EstadoParaGatilho {
  /** `criado_em` da última linha de `copiloto_ciclos` desta sessão, ou `null`
   * se o ciclo nunca disparou (primeira avaliação da sessão). */
  ultimoCicloEm: string | null;
  /** Existe pelo menos 1 `sessoes_copiloto_segmentos` com `ordem` maior que a
   * maior ordem vista no último ciclo. */
  houveSegmentoNovo: boolean;
  /** Índice do bloco no momento da última claim (`null` = nunca claimado). */
  ultimoBlocoIndice: number | null;
  /** Índice do bloco AGORA, resolvido pelo servidor (`estado.ts::resolverBlocoAtual`). */
  blocoAtualIndice: number;
  /** Origem do bloco AGORA — só `"manual"` pode disparar `virada_bloco`
   * (ver comentário de topo, Fase 12/Fatia 1). */
  blocoAtualOrigem: OrigemBlocoParaGatilho;
  agoraMs: number;
  intervaloSegundos: number;
}

/**
 * Núcleo puro. Ordem de avaliação importa: intervalo+fala-nova primeiro,
 * porque é o gatilho "de fundo" que sustenta a sessão inteira; virada de
 * bloco depois, como um evento pontual que pode disparar MAIS CEDO que o
 * intervalo (é o próprio ponto do gatilho 2 — reagir ao ato DELIBERADO da
 * advogada, não à inferência do próprio sistema, e não esperar o relógio).
 */
export function decidirGatilho(estado: EstadoParaGatilho): DecisaoGatilho {
  const segundosDesdeUltimoCiclo = estado.ultimoCicloEm
    ? (estado.agoraMs - Date.parse(estado.ultimoCicloEm)) / 1000
    : Number.POSITIVE_INFINITY;

  const mudouDeBlocoPorCorrecaoManual =
    estado.blocoAtualOrigem === "manual" &&
    estado.ultimoBlocoIndice !== null &&
    estado.ultimoBlocoIndice !== estado.blocoAtualIndice;

  if (mudouDeBlocoPorCorrecaoManual && segundosDesdeUltimoCiclo >= PISO_VIRADA_BLOCO_SEGUNDOS) {
    return { dispara: true, gatilho: "virada_bloco" };
  }

  if (segundosDesdeUltimoCiclo >= estado.intervaloSegundos && estado.houveSegmentoNovo) {
    return { dispara: true, gatilho: "intervalo" };
  }

  return { dispara: false, gatilho: null };
}

/**
 * Camada de leitura: busca os 3 fatos de que `decidirGatilho` precisa.
 *
 * 🔴 CORREÇÃO (achado do Fable): a versão anterior deste comentário afirmava
 * que a leitura de `sessoes_copiloto_segmentos` era "a MESMA query do
 * polling" (`where sessao_id = $1 and ordem > $2`) — não é. O predicado
 * REAL, caractere a caractere, é:
 *
 *   where sessao_id = $1 and criado_em > $2 limit 1   -- COM ciclo anterior (ramo `if (ultimoCiclo)`, abaixo)
 *   where sessao_id = $1 limit 1                       -- SEM ciclo anterior (ramo `else`, abaixo)
 *
 * ÍNDICES sobre o caminho quente:
 *   - `copiloto_ciclos`: `order by janela desc limit 1` sobre a PK
 *     `(sessao_id, janela)` — Index Scan pela própria chave primária (0096).
 *   - `sessoes_copiloto_segmentos`: o `eq(sessao_id)` usa
 *     `idx_copiloto_segmentos_polling (sessao_id, ordem)` — MESMO índice do
 *     polling, mas só pela COLUNA `sessao_id`: restringe a UMA sessão e já
 *     entrega qualquer linha dela via Index Scan. O `gt(criado_em)` NÃO tem
 *     índice próprio nesta tabela e vira filtro RESIDUAL dentro do Index
 *     Scan já restrito por `sessao_id` — aceitável pelo MESMO raciocínio de
 *     `contexto.ts::buscarJanelaTranscricao` (cardinalidade POR SESSÃO é
 *     pequena por desenho, §2.1 do plano: teto de ~180 segmentos numa sessão
 *     de 90 min inteira). `.limit(1)` é o que importa aqui — é uma checagem
 *     de existência ("há algo mais novo que X?"), não uma listagem; não há
 *     `select count`. `explain (analyze)` A MEDIR em
 *     `scripts/verificacao-0096.sql` §8 (c)/(d).
 */
export async function avaliarGatilho(
  supabase: SupabaseClient,
  params: {
    sessaoId: string;
    blocoAtualIndice: number;
    /** Fase 12, Fatia 1 — origem do bloco atual resolvido pelo chamador
     * (`estado.ts::resolverBlocoAtual`). Só `"manual"` pode disparar
     * `virada_bloco` (ver comentário de topo do arquivo). */
    blocoAtualOrigem: OrigemBlocoParaGatilho;
    intervaloSegundos: number;
    agoraMs?: number;
  },
): Promise<DecisaoGatilho> {
  const agoraMs = params.agoraMs ?? Date.now();
  const { intervaloSegundos } = params;

  try {
    const { data: ultimoCiclo, error: erroCiclo } = await supabase
      .from("copiloto_ciclos")
      .select("janela, criado_em, bloco_indice")
      .eq("sessao_id", params.sessaoId)
      .order("janela", { ascending: false })
      .limit(1)
      .maybeSingle<{ janela: number; criado_em: string; bloco_indice: number | null }>();
    if (erroCiclo) throw erroCiclo;

    let houveSegmentoNovo = true; // sem ciclo anterior: qualquer segmento existente já conta como "novo" para a 1ª avaliação
    if (ultimoCiclo) {
      const { data: segmentoNovo, error: erroSegmento } = await supabase
        .from("sessoes_copiloto_segmentos")
        .select("ordem")
        .eq("sessao_id", params.sessaoId)
        .gt("criado_em", ultimoCiclo.criado_em)
        .limit(1)
        .maybeSingle<{ ordem: number }>();
      if (erroSegmento) throw erroSegmento;
      houveSegmentoNovo = segmentoNovo !== null;
    } else {
      const { data: existeSegmento, error: erroExiste } = await supabase
        .from("sessoes_copiloto_segmentos")
        .select("ordem")
        .eq("sessao_id", params.sessaoId)
        .limit(1)
        .maybeSingle<{ ordem: number }>();
      if (erroExiste) throw erroExiste;
      houveSegmentoNovo = existeSegmento !== null;
    }

    return decidirGatilho({
      ultimoCicloEm: ultimoCiclo?.criado_em ?? null,
      houveSegmentoNovo,
      ultimoBlocoIndice: ultimoCiclo?.bloco_indice ?? null,
      blocoAtualIndice: params.blocoAtualIndice,
      blocoAtualOrigem: params.blocoAtualOrigem,
      agoraMs,
      intervaloSegundos,
    });
  } catch (erro) {
    registrarErro("copiloto/gatilho.avaliarGatilho", erro, { sessao_id: params.sessaoId });
    // Falha de leitura NUNCA dispara — mesmo princípio de conferirGateCopiloto/
    // conferirOrcamentoCopiloto: "não saber" não é licença para gastar IA.
    return { dispara: false, gatilho: null };
  }
}
