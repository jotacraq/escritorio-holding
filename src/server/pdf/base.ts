import fs from "node:fs";
import path from "node:path";

/**
 * Base comum dos PDFs do SIC-HF: paleta da marca e carregamento das fontes.
 *
 * Extraído de `src/server/material/pdf.ts` (Fase 4) quando o dossiê LGPD
 * (Fase 7) passou a precisar do mesmo cabeçalho visual — dois renderizadores,
 * uma paleta e um carregador de fonte só. `material/pdf.ts` importa daqui.
 *
 * Identidade (brief da Fase 4): ink `#141b22`, cinza `#43454f`, apagado
 * `#6d6a64`, laranja de marca `#ff7400`, areia `#e8e0d6`. Texto sobre laranja é
 * escuro, nunca claro.
 */

export const COR = {
  tinta: "#141b22",
  texto: "#43454f",
  apagada: "#6d6a64",
  marca: "#ff7400",
  areia: "#e8e0d6",
} as const;

export const MARGEM = 56;
export const LARGURA_A4 = 595.28;
export const ALTURA_A4 = 841.89;
export const LARGURA_UTIL = LARGURA_A4 - 2 * MARGEM;

export const FONTE_REGULAR = "Neuetra";
export const FONTE_BOLD = "Neuetra-Bold";

export interface Tipografia {
  regular: string;
  bold: string;
}

/** Usada quando a Neuetra não carrega — o PDF sai, só que em Helvetica. */
export const TIPOGRAFIA_HELVETICA: Tipografia = { regular: "Helvetica", bold: "Helvetica-Bold" };
export const TIPOGRAFIA_NEUETRA: Tipografia = { regular: FONTE_REGULAR, bold: FONTE_BOLD };

export interface FontesCarregadas {
  regular: Buffer;
  bold: Buffer;
}

/**
 * A Neuetra do site vive em `public/fonts/*.woff2`. O fontkit LÊ WOFF2, mas não
 * consegue SUBSETAR fonte com tabela `glyf` transformada (a `loca` do WOFF2 é
 * derivada; `TTFSubset._addGlyph` lê bytes crus e estoura —
 * `RangeError: Offset is outside the bounds of the DataView`, medido em
 * 04/09/2026 com fontkit 2.0.4). Por isso as mesmas fontes existem em TTF
 * (conversão 1:1 com fonttools, mesmos 380 glifos), fora de `public/` para não
 * expor um arquivo copiável a mais.
 */
export function caminhoFonte(arquivo: string): string {
  return path.join(process.cwd(), "src", "server", "material", "fontes", arquivo);
}

export function lerFontes(): FontesCarregadas {
  return {
    regular: fs.readFileSync(caminhoFonte("TBJNeuetra-Regular.ttf")),
    bold: fs.readFileSync(caminhoFonte("TBJNeuetra-Bold.ttf")),
  };
}
