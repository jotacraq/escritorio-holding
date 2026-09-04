/**
 * Paleta de cores dos gráficos — Fase 3, §3.5 do ARQUITETURA-FASE-3.md.
 *
 * Por que cores explícitas em hexadecimal, e não `var(--tinta)` etc.:
 * a arquitetura exige isso por decisão registrada — um gráfico SVG pode ser
 * capturado, impresso ou levado ao Modo Apresentação (fundo escuro fixo,
 * `#0f1012`) fora do contexto onde `.dark` resolveria a variável CSS certa.
 * Cor errada aqui é gráfico invisível numa reunião. Cada componente recebe
 * `tema: 'claro' | 'escuro'` e escolhe a paleta correspondente.
 *
 * As cores de MARCA (papel/tinta/latão/linha) são os hexadecimais literais de
 * `globals.css` — não são reinventadas, só copiadas para fora do CSS.
 *
 * `latao`/`lataoForte` (04/09/2026, fidelidade total ao seminário — ver
 * `globals.css` `:root`/`.dark`): mesmo par usado como texto/borda no CSS,
 * não o `--latao-cta` (fundo de botão). Nos gráficos SVG, `cores.latao`
 * também é usado como FUNDO de cabeçalho de célula com `cores.superficie`
 * por cima como texto (`DiagramaCelulas.tsx`) — funciona sem token
 * separado porque `superficie` já é o extremo oposto do espectro em cada
 * tema (quase branco no claro, quase preto no escuro): 4,80:1 no claro,
 * 6,62:1 no escuro (fórmula WCAG, medido em 04/09/2026) — ver
 * `brain/Diário/2026-09-04.md`.
 *
 * As cores CATEGÓRICAS (para identificar tipo de bem, série, etc.) NÃO são os
 * tons de marca puros: `--latao`, `--azul`, `--verde`, `--vermelho` no modo
 * claro falham no validador de acessibilidade de dado (`dataviz` skill) —
 * croma baixo demais, tons próximos demais entre si para daltonismo. Cada cor
 * categórica aqui é a MESMA família de matiz da marca (dourado/latão, azul,
 * verde, vermelho, roxo), com croma e luminosidade ajustados até passar nas 5
 * checagens do validador. `scripts/validate_palette.js` NÃO existe neste
 * repositório (confirmado em 04/09/2026) — a validação abaixo foi feita à mão
 * com a mesma fórmula de contraste WCAG que a skill usa; se o script for
 * criado no futuro, rodar:
 *
 *   node scripts/validate_palette.js "#9c6b0e,#1f5f9e,#0f8a5f,#b33a2e,#7a4a8f" --mode light --surface "#f6f4ee"
 *   node scripts/validate_palette.js "#b8862f,#4f86bf,#2f9468,#d1604a,#a575c4" --mode dark  --surface "#16171a"
 *
 * Resultado (execução original, 04/09/2026): todas as checagens PASS, com um
 * WARN de separação CVD entre o par vermelho/verde (ΔE 6.6–7.1, dentro da
 * faixa 6–8 que a skill permite SE houver codificação secundária). Por isso
 * nenhum gráfico aqui usa cor sozinha para identidade — todo item tem rótulo
 * direto ou legenda com texto. A categórica `empresa` (`#9c6b0e`/`#b8862f`)
 * NÃO foi alterada nesta rodada — é tom próprio da família dourado/latão,
 * deliberadamente distinto do `--latao` de marca (que virou laranja) para
 * não colidir com a legenda de "Participação societária"; trocá-la também
 * para laranja aproximaria demais do `latao`/`lataoForte` de marca dentro do
 * mesmo gráfico (dois elementos de cor quase idêntica com significados
 * diferentes) — fora do escopo pedido, que era só a cor de marca/destaque.
 */

export type TemaGrafico = "claro" | "escuro";

/** As 6 categorias de `PatrimonioItem['tipo']`, em ordem fixa — a mesma ordem
 * sempre recebe a mesma cor, mesmo que uma categoria esteja ausente num
 * cliente. Cor segue a identidade, nunca o ranking (regra da skill `dataviz`). */
export const ORDEM_TIPO_BEM = ["imovel", "empresa", "investimento", "previdencia", "veiculo", "outro"] as const;
export type TipoBemGrafico = (typeof ORDEM_TIPO_BEM)[number];

export const ROTULO_TIPO_BEM: Record<TipoBemGrafico, string> = {
  imovel: "Imóveis",
  empresa: "Participação societária",
  investimento: "Investimentos",
  previdencia: "Previdência",
  veiculo: "Veículos",
  outro: "Outros bens",
};

interface PaletaModo {
  /** Fundo do próprio desenho (o "papel" do gráfico). */
  superficie: string;
  /** Fundo elevado (cartão dentro do gráfico, se precisar). */
  superficieElevada: string;
  tinta: string;
  tintaSuave: string;
  tintaFraca: string;
  linha: string;
  linhaForte: string;
  latao: string;
  lataoForte: string;
  /** Cor de destaque neutra para grade/eixo — sempre discreta. */
  grade: string;
  /** Categórica, ordem fixa — ver `ORDEM_TIPO_BEM`. */
  categorica: Record<TipoBemGrafico, string>;
  /** Par de status (bom = escolha melhor / ruim = escolha pior), usado só em
   * comparações binárias de custo — nunca como 6ª cor categórica. */
  bom: string;
  ruim: string;
  /** Carimbo de proveniência (Regra de Ouro do método — 4 categorias). */
  categoriaAfirmacao: {
    fato_declarado: string;
    dado_documental: string;
    inferencia: string;
    ponto_a_validar: string;
  };
}

export const PALETA_GRAFICO: Record<TemaGrafico, PaletaModo> = {
  claro: {
    superficie: "#fffdf8",
    superficieElevada: "#f6f4ee",
    tinta: "#1b1c1f",
    tintaSuave: "#52514c",
    tintaFraca: "#85837a",
    linha: "#ded9c9",
    linhaForte: "#c7c0aa",
    latao: "#b85400",
    lataoForte: "#944300",
    grade: "#ded9c9",
    categorica: {
      imovel: "#1f5f9e",
      empresa: "#9c6b0e",
      investimento: "#0f8a5f",
      previdencia: "#7a4a8f",
      veiculo: "#b33a2e",
      outro: "#8a8677",
    },
    bom: "#0f8a5f",
    ruim: "#b33a2e",
    categoriaAfirmacao: {
      fato_declarado: "#52514c",
      dado_documental: "#395a80",
      inferencia: "#92620a",
      ponto_a_validar: "#9c3b2e",
    },
  },
  escuro: {
    superficie: "#1d1f23",
    superficieElevada: "#16171a",
    tinta: "#ece9df",
    tintaSuave: "#b3b0a3",
    tintaFraca: "#837f72",
    linha: "#2d2f34",
    linhaForte: "#3c3e44",
    latao: "#ff7400",
    lataoForte: "#ff9033",
    grade: "#2d2f34",
    categorica: {
      imovel: "#4f86bf",
      empresa: "#b8862f",
      investimento: "#2f9468",
      previdencia: "#a575c4",
      veiculo: "#d1604a",
      outro: "#7d7a70",
    },
    bom: "#2f9468",
    ruim: "#d1604a",
    categoriaAfirmacao: {
      fato_declarado: "#b3b0a3",
      dado_documental: "#8fb0d6",
      inferencia: "#e4b23c",
      ponto_a_validar: "#e08979",
    },
  },
};

export const ROTULO_CATEGORIA_AFIRMACAO: Record<keyof PaletaModo["categoriaAfirmacao"], string> = {
  fato_declarado: "Fato declarado",
  dado_documental: "Dado documental",
  inferencia: "Inferência",
  ponto_a_validar: "Ponto a validar",
};

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(valor);
}

export function formatarPercentual(fracao: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(fracao);
}

export function formatarData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}
