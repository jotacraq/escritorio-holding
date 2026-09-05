import { PALETA_GRAFICO } from "@/components/graficos/paleta";

/**
 * As superfícies em que uma tabela do croqui aparece, como DADO.
 *
 * A tabela é uma só (`TabelaCroqui`); o que muda entre a tela, a folha
 * impressa e o projetor é a paleta, se dá para rolar e se a explicação
 * interna da célula pode sair. Antes isso era um produto de três booleanos
 * (`paleta` × `rolavel` × `publico`) escrito em duas linguagens de estilo —
 * classe Tailwind no caminho do tema, `style` inline no caminho fixo. Uma
 * mudança de cor saía diferente no deck e na tela, e a projeção tinha perdido
 * a região rolável de carona com a cor, sem ninguém decidir isso.
 *
 * As paletas fixas DERIVAM de `graficos/paleta.ts` (`PALETA_GRAFICO`), que é
 * a fonte de verdade de cor de documento do projeto e passou pelo validador
 * de contraste (`scripts/validate_palette.js`). Isso importa: `DeckTabelas`
 * imprime tabela e gráfico na MESMA folha — não podem usar dois cinzas
 * diferentes para a mesma régua.
 */
export interface PaletaTabela {
  papel: string;
  papelLinha: string;
  tinta: string;
  tintaSuave: string;
  tintaFraca: string;
  linha: string;
  linhaForte: string;
  /** Célula ausente e avisos de falta. */
  atencao: string;
  /** Laranja de marca — rótulo do slide, marcador de ponto. */
  marca: string;
}

/**
 * A do tema: aponta para os tokens de `globals.css`, então claro/escuro
 * continuam valendo sem nenhum ramo no componente.
 */
export const PALETA_TEMA: PaletaTabela = {
  papel: "var(--papel-elevado)",
  papelLinha: "var(--papel)",
  tinta: "var(--tinta)",
  tintaSuave: "var(--tinta-suave)",
  tintaFraca: "var(--tinta-fraca)",
  linha: "var(--linha)",
  linhaForte: "var(--linha-forte)",
  atencao: "var(--ambar)",
  marca: "var(--latao)",
};

/** Papel e tinta do deck impresso — sempre claro, mesmo com `.dark` no `<html>`. */
export const PALETA_DOCUMENTO: PaletaTabela = {
  papel: PALETA_GRAFICO.claro.superficie,
  papelLinha: PALETA_GRAFICO.claro.superficieElevada,
  tinta: PALETA_GRAFICO.claro.tinta,
  tintaSuave: PALETA_GRAFICO.claro.tintaSuave,
  tintaFraca: PALETA_GRAFICO.claro.tintaFraca,
  linha: PALETA_GRAFICO.claro.linha,
  linhaForte: PALETA_GRAFICO.claro.linhaForte,
  // O mesmo âmbar que o gráfico usa para "inferência" — que é exatamente o
  // que uma célula sem parâmetro é.
  atencao: PALETA_GRAFICO.claro.categoriaAfirmacao.inferencia,
  marca: PALETA_GRAFICO.claro.latao,
};

/** A tela escura projetada para a família — espelha `CORES_APRESENTACAO`. */
export const PALETA_PROJECAO: PaletaTabela = {
  papel: PALETA_GRAFICO.escuro.superficie,
  papelLinha: "#26282d",
  tinta: PALETA_GRAFICO.escuro.tinta,
  tintaSuave: PALETA_GRAFICO.escuro.tintaSuave,
  tintaFraca: PALETA_GRAFICO.escuro.tintaFraca,
  linha: PALETA_GRAFICO.escuro.linha,
  linhaForte: "#55585f",
  // 6,3:1 sobre `#1d1f23`. O âmbar do tema claro não passa em fundo escuro.
  atencao: "#e4b23c",
  marca: PALETA_GRAFICO.escuro.latao,
};

// ---------------------------------------------------------------------------
// Superfície — o único eixo que a tabela conhece
// ---------------------------------------------------------------------------

/**
 *  · `tela`      — app autenticado, tema claro/escuro, rola e é focável.
 *  · `publico`   — `/p/m`, mesmo visual, mas NENHUMA explicação interna sai
 *                  (fórmula, versão do parâmetro, o que falta cadastrar).
 *  · `projecao`  — a tela escura no projetor.
 *  · `documento` — a folha impressa: papel não rola, então a célula quebra
 *                  em duas linhas em vez de ser cortada.
 */
export type Superficie = "tela" | "publico" | "projecao" | "documento";

export interface EstiloSuperficie {
  paleta: PaletaTabela;
  /** Região rolável e focável; célula em uma linha só. */
  rolavel: boolean;
  /** Esconde toda explicação interna de célula. */
  publico: boolean;
}

export const SUPERFICIES: Record<Superficie, EstiloSuperficie> = {
  tela: { paleta: PALETA_TEMA, rolavel: true, publico: false },
  publico: { paleta: PALETA_TEMA, rolavel: true, publico: true },
  projecao: { paleta: PALETA_PROJECAO, rolavel: true, publico: false },
  documento: { paleta: PALETA_DOCUMENTO, rolavel: false, publico: false },
};
