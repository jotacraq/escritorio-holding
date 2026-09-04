import type { TemaGrafico } from "./paleta";

/** As 4 categorias de afirmação do método (Agente do Croqui, Regra de Ouro).
 * Espelha `CategoriaAfirmacaoSchema` de `src/server/ia/schema-croqui-analise.ts`
 * sem importar do server — estes componentes não têm dependência de servidor. */
export type CategoriaAfirmacaoGrafico = "fato_declarado" | "dado_documental" | "inferencia" | "ponto_a_validar";

/** Uma pendência nomeada — o que falta, em português, para o gráfico existir. */
export interface ItemFaltante {
  /** Nome do campo em português, ex.: "Valor de mercado dos imóveis". */
  campo: string;
  /** Onde preencher, ex.: "Aba Patrimônio". Opcional. */
  onde?: string;
}

/** Props comuns a todo componente desta pasta. */
export interface GraficoBaseProps {
  /** Claro = Ficha 360 e impressão. Escuro = Modo Apresentação (fundo fixo
   * `#0f1012`). Nunca resolvido por CSS — ver `paleta.ts`. Padrão: 'claro'. */
  tema?: TemaGrafico;
  /** Modo Apresentação, com o cliente na frente: se o dado não existir, o
   * bloco de gráfico não aparece — nem o estado vazio explicativo. Padrão: false. */
  modoApresentacao?: boolean;
  className?: string;
}

export const LARGURA_PADRAO = 640;
export const ALTURA_PADRAO = 360;
