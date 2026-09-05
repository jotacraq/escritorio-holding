import type { Celula, ChaveTabela, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { podeAfirmar } from "@/server/motor-croqui/formatar";
import { GRUPOS_CROQUI } from "./formatoTabela";

/**
 * Montagem dos blocos de leitura do croqui — pura, sem React. Tela, deck de
 * impressão, apresentação e `/p/m` chamam estas funções: a ordem das tabelas
 * e a leitura da economia saem de um lugar só, ou não é o mesmo croqui.
 */

// ---------------------------------------------------------------------------
// Pareamento "hoje × após a reforma"
// ---------------------------------------------------------------------------

/**
 * Tabela que o motor entrega separada e que o MÉTODO sempre apresenta como
 * segunda coluna de outra. Hoje só há um par (slides 4 e 5 do deck real): o
 * inventário de hoje e o de depois da reforma têm as mesmas chaves de linha,
 * e é o contraste entre as duas colunas que vende.
 *
 * O motor está certo em calcular separado — são duas passagens contra faixas
 * de ITCMD diferentes, com conjuntos de `falta` próprios. Juntar é decisão de
 * apresentação, e mora AQUI, uma vez: quem lista tabela (`GRUPOS_CROQUI`) e
 * quem monta slide (`slidesDoMetodo`) passam os dois por `resolverTabelas`.
 */
export const PAREAMENTOS: Partial<Record<ChaveTabela, ChaveTabela>> = {
  inventario_atual: "inventario_reforma",
};

/** Todas as chaves que aparecem como coluna de outra tabela, nunca sozinhas. */
export const CHAVES_PAREADAS: ReadonlySet<ChaveTabela> = new Set(Object.values(PAREAMENTOS));

/**
 * Junta duas tabelas de mesma estrutura em uma de duas colunas. Nenhuma
 * célula é recalculada, somada ou inventada: linha que só existe de um lado
 * fica vazia do outro (a tabela mostra "·", nunca zero).
 */
export function emparelharReforma(hoje: Tabela, reforma: Tabela | undefined): Tabela {
  if (!reforma) return hoje;

  const vistas = new Set<string>();
  const chaves: string[] = [];
  for (const l of [...hoje.linhas, ...reforma.linhas]) {
    if (vistas.has(l.chave)) continue;
    vistas.add(l.chave);
    chaves.push(l.chave);
  }
  const mHoje = new Map(hoje.linhas.map((l) => [l.chave, l]));
  const mReforma = new Map(reforma.linhas.map((l) => [l.chave, l]));

  return {
    chave: hoje.chave,
    titulo: hoje.titulo,
    ...(hoje.nota ? { nota: hoje.nota } : {}),
    colunas: [
      { chave: "valor", rotulo: "Hoje" },
      { chave: "reforma", rotulo: "Após a reforma" },
    ],
    linhas: chaves.map((chave) => {
      const a = mHoje.get(chave);
      const b = mReforma.get(chave);
      const base = (a ?? b) as NonNullable<typeof a>;
      return {
        chave,
        rotulo: base.rotulo,
        ...(base.destaque ? { destaque: true as const } : {}),
        celulas: {
          ...(a ? { valor: a.celulas.valor } : {}),
          ...(b ? { reforma: b.celulas.valor } : {}),
        },
      };
    }),
    falta: [...hoje.falta, ...reforma.falta].filter(
      (f, i, todas) =>
        todas.findIndex((o) => o.chave === f.chave && o.uf === f.uf && o.municipio === f.municipio) === i,
    ),
  };
}

/**
 * As tabelas presentes no resultado, na ordem pedida, já com os pares
 * resolvidos. Tabela que o motor não devolveu (sem insumo) simplesmente não
 * aparece — e o par também respeita o filtro (o recorte público não pode
 * trazer pela coluna o que barrou pela chave).
 */
export function resolverTabelas(
  chaves: readonly ChaveTabela[],
  resultado: ResultadoCroqui,
  permitida: (chave: ChaveTabela) => boolean = () => true,
): Tabela[] {
  return chaves.flatMap((chave): Tabela[] => {
    if (CHAVES_PAREADAS.has(chave) || !permitida(chave)) return [];
    const tabela = resultado.tabelas[chave];
    if (!tabela) return [];
    const par = PAREAMENTOS[chave];
    if (par && permitida(par)) return [emparelharReforma(tabela, resultado.tabelas[par])];
    return [tabela];
  });
}

export interface BlocoCroqui {
  /** ≤ 3 palavras (lei de texto). */
  rotulo: string;
  tabelas: Tabela[];
}

/** Os blocos de leitura, na ordem das 19 abas. Grupo que fica vazio some. */
export function montarBlocos(
  resultado: ResultadoCroqui,
  permitida?: (chave: ChaveTabela) => boolean,
): BlocoCroqui[] {
  return GRUPOS_CROQUI.map((grupo) => ({
    rotulo: grupo.rotulo,
    tabelas: resolverTabelas(grupo.tabelas, resultado, permitida),
  })).filter((grupo) => grupo.tabelas.length > 0);
}

/**
 * Colunas em que TODA célula está ausente. O croqui completo mostra essas
 * colunas assim mesmo — com a tira de falta embaixo dizendo o que cadastrar,
 * porque lá o objetivo é fechar o cadastro. No SIMULADOR, onde a família está
 * olhando, uma coluna inteira de travessões só rouba largura da que tem
 * número: ali elas saem (`colunasOcultas`).
 */
export function colunasVazias(tabela: Tabela): string[] {
  return tabela.colunas
    .filter((coluna) =>
      tabela.linhas.every((linha) => {
        const celula = linha.celulas[coluna.chave];
        return !celula || celula.procedencia === "ausente";
      }),
    )
    .map((coluna) => coluna.chave);
}

/** Quantas das 19 tabelas o resultado fechou. */
export function contarTabelas(resultado: ResultadoCroqui): number {
  return Object.keys(resultado.tabelas).length;
}

// ---------------------------------------------------------------------------
// A economia — o número que a reunião inteira serve para dizer
// ---------------------------------------------------------------------------

export interface MelhorEconomia {
  /** Rótulo do modelo ("3 células"). */
  modelo: string;
  economia: Celula;
  percentual: Celula | undefined;
}

/**
 * O modelo que mais economiza contra o inventário, em T13.
 *
 * Duas regras que valem nas DUAS superfícies (simulador e slide), porque
 * antes cada uma tinha a sua e a mesma família via respostas opostas na mesma
 * reunião:
 *  · célula ausente não entra na disputa (`podeAfirmar`) — a economia não se
 *    calcula sobre meio custo;
 *  · economia ≤ 0 devolve `null`. Se a melhor arquitetura sai mais cara que o
 *    inventário, isso NÃO é "economia negativa" num número grande e verde: é
 *    o comparativo inteiro dizendo que a resposta está na tabela, não no
 *    destaque.
 */
export function melhorEconomia(comparativo: Tabela | undefined): MelhorEconomia | null {
  if (!comparativo) return null;

  let melhor: MelhorEconomia | null = null;
  let maior = 0;

  for (const linha of comparativo.linhas) {
    if (linha.chave === "inventario") continue;
    const economia = linha.celulas.dif_inventario;
    if (!economia || !podeAfirmar(economia)) continue;
    const valor = economia.valor as number;
    if (valor <= 0 || (melhor && valor <= maior)) continue;
    maior = valor;
    melhor = { modelo: linha.rotulo, economia, percentual: linha.celulas.dif_percentual };
  }

  return melhor;
}
