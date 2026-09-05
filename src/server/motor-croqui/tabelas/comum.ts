import type {
  Celula,
  ChaveTabela,
  ColunaTabela,
  LinhaTabela,
  ModeloHolding,
  Tabela,
  UnidadeCelula,
} from "@/types/croqui-calculo";
import { deduplicarFaltas } from "../celula";

/** Coluna única das tabelas de valor. */
export const COLUNA_VALOR: ColunaTabela[] = [{ chave: "valor", rotulo: "Valor" }];

/** Colunas dos três modelos de holding (T15–T18). */
export const COLUNAS_MODELOS: ColunaTabela[] = [
  { chave: "celula_1", rotulo: "1 célula" },
  { chave: "celula_2", rotulo: "2 células" },
  { chave: "celula_3", rotulo: "3 células" },
];

export const MODELOS_COLUNA: ModeloHolding[] = ["celula_1", "celula_2", "celula_3"];

/**
 * Carimba a unidade de leitura numa linha já montada. Quem SABE que "Economia"
 * é % e "Tempo para se pagar" é mês é quem monta a linha — não o nome da chave.
 * Antes disso a apresentação reconstruía por nome (`UNIDADE_POR_CHAVE`), e uma
 * linha nova chamada `percentual` que fosse R$ renderizava como porcentagem em
 * silêncio.
 */
export const comUnidade = (l: LinhaTabela, unidade: UnidadeCelula): LinhaTabela => ({ ...l, unidade });

/** Linha de coluna única. */
export const linha = (chave: string, rotulo: string, celula: Celula, destaque = false): LinhaTabela => ({
  chave,
  rotulo,
  ...(destaque ? { destaque: true } : {}),
  celulas: { valor: celula },
});

/** Linha com uma célula por modelo. */
export const linhaModelos = (
  chave: string,
  rotulo: string,
  porModelo: Record<ModeloHolding, Celula>,
  destaque = false,
): LinhaTabela => ({
  chave,
  rotulo,
  ...(destaque ? { destaque: true } : {}),
  celulas: { ...porModelo },
});

/**
 * Monta a tabela e agrega o `falta` de todas as células. A tela usa esse
 * agregado para dizer "faltam 2 parâmetros nesta tabela" sem varrer célula a
 * célula.
 */
export function montarTabela(args: {
  chave: ChaveTabela;
  titulo: string;
  nota?: string;
  /** unidade de TODA a tabela (T1 é contagem, T15 é hora); linha e coluna sobrepõem */
  unidade?: UnidadeCelula;
  colunas: ColunaTabela[];
  linhas: LinhaTabela[];
}): Tabela {
  const todas = args.linhas.flatMap((l) => Object.values(l.celulas));
  return {
    chave: args.chave,
    titulo: args.titulo,
    ...(args.nota ? { nota: args.nota } : {}),
    ...(args.unidade ? { unidade: args.unidade } : {}),
    colunas: args.colunas,
    linhas: args.linhas,
    falta: deduplicarFaltas(todas.flatMap((c) => c.falta ?? [])),
  };
}
