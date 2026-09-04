import type { TemaGrafico, TipoBemGrafico } from "./paleta";

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

/**
 * Uma linha da Tabela Patrimonial (Diagnóstico da SV — plano "Croqui rico em
 * dados", Fase C, `brain/Diário/2026-09-04.md`). Componente puro: não calcula
 * nada, só renderiza o que já veio pronto por prop.
 *
 * Regra dura do projeto (CLAUDE.md — "nada de dado inventado na tela"):
 * qualquer campo `null` é "não informado", NUNCA 0. Isto é distinto de
 * `ItemComposicaoPatrimonial` (`BarrasComposicao.tsx`), que já assume valor
 * numérico presente — aqui o dado pode legitimamente não existir ainda,
 * porque o motor de cálculo da Fase B (Cenário Patrimonial) está bloqueado
 * aguardando decisão de negócio (B26/B28).
 */
export interface ItemPatrimonialTabela {
  descricao: string;
  /** Mesmo enum de `patrimonio_itens.tipo` (`tipo_bem`, migration 0001) — reusa
   * `TipoBemGrafico`/`ROTULO_TIPO_BEM` de `paleta.ts`, não inventa rótulo novo. */
  tipo: TipoBemGrafico;
  /** Valor histórico/DIRPF. `null` = não informado — nunca renderizar como 0. */
  custoOrigemPF: number | null;
  /** Valor de mercado atual. `null` = não informado. */
  valorMercado: number | null;
  /** Rendimento mensal do bem (aluguel, dividendo, etc). `null` = não informado. */
  rendimentoMensal: number | null;
  /** Texto livre por enquanto — motor de tributação ainda não existe (Fase B bloqueada). */
  tributacao: string | null;
}

/**
 * Um cenário comparado no gráfico de barras N-cenários (`BarrasCenarios.tsx`).
 * Generalização de `BarrasComparativas` (hoje só 2 séries fixas: inventário ×
 * estrutura) para até 5 cenários do método (Inventário, Doação, 1/2/3 Células).
 */
export interface CenarioComparado {
  /** "Inventário" | "Doação" | "1 Célula" | "2 Células" | "3 Células" — texto
   * livre por enquanto, o vocabulário do método não é fixado em union aqui. */
  nome: string;
  /** `null` = cenário não computável ainda (rubrica ausente, procedência
   * "ausente" na Fase B). NÃO renderiza como barra de altura zero — omitida. */
  custoTotal: number | null;
  /** Relativo ao cenário de referência (`ehReferencia`). `null` se não computável. */
  diferencaPercentual: number | null;
  /** true só no cenário base da comparação — tipicamente "Inventário". */
  ehReferencia?: boolean;
}
