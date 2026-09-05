/**
 * Motor do Croqui — tipos do contrato congelado (Fase 5, §4 de
 * `docs/ARQUITETURA-FASE-5.md`). Consumidos por:
 *   - `src/server/motor-croqui/**` (M1, quem calcula)
 *   - M4 (tela do croqui, apresentação, simulador ao vivo)
 *   - M6 (`.docx`) e o `/p/m` público
 *
 * O croqui deixa de ser texto gerado e vira **cálculo determinístico com
 * procedência por célula**. Duas leis atravessam este arquivo inteiro:
 *
 * 1. **Ausência nunca é zero.** Célula sem insumo é `procedencia: "ausente"`
 *    com `valor: null` e `motivo` em português. Zero só existe quando a conta
 *    deu zero (ITBI de bem sem valorização, por exemplo).
 * 2. **Parcela ausente contamina o total.** Nunca existe soma parcial que
 *    pareça total — é a lei da `vw_cenarios_totais` (0060) em TypeScript.
 *
 * Isso não é preciosismo: o recon do Drive achou um deck REAL entregue ao
 * cliente com "R$ 0,00" no custo do inventário e a frase "a família perde
 * aproximadamente R$ 0,00" — a sincronização Sheets→Slides falhou em silêncio.
 * O caso virou o teste C de `scripts/teste-motor-croqui.ts`.
 */

// ---------------------------------------------------------------------------
// Célula — a unidade do resultado
// ---------------------------------------------------------------------------

/**
 * MESMO vocabulário do enum `procedencia_valor` (0057) — de propósito: a
 * célula do motor e a rubrica do Cenário Patrimonial falam a mesma língua, e
 * um override gravado em `cenario_rubricas` vira `digitado` aqui sem tradução.
 *
 * Regra fixa do método (deságio de 20%, base de ITCMD por modelo, cascata das
 * células) NÃO é uma quarta procedência: é `calculado` com
 * `fonte: "fixo_metodo"` — ver `FonteCelula`. Assim a tela continua com três
 * estados para renderizar, e a explicação "de onde veio" fica em `fonte`.
 */
export type Procedencia = "calculado" | "digitado" | "ausente";

/**
 * De onde saiu o número, quando há mais de um caminho possível:
 * - `tabela_uf` — tabela de emolumentos da UF (fonte de verdade do TJ)
 * - `percentual_fallback` — aproximação por percentual, porque a UF não tem
 *   tabela cadastrada. A tela e o `.docx` PRECISAM dizer qual dos dois entrou:
 *   hoje o escritório não sabe distinguir.
 * - `fixo_metodo` — regra de desenho do método, não parâmetro de banco
 *   (`src/server/motor-croqui/dominio.ts`).
 */
export type FonteCelula = "tabela_uf" | "percentual_fallback" | "fixo_metodo";

/** Parâmetro que faltou, com a jurisdição em que faltou. */
export interface FaltaParametro {
  chave: string;
  uf?: string;
  municipio?: string;
}

export interface Celula {
  valor: number | null;
  procedencia: Procedencia;
  /** "faixa 2% sobre a base de mercado (SP, doação)" — em português, na tela. */
  formula?: string;
  /** versão de `parametros_metodo` que entrou na conta (carimbo de auditoria) */
  parametro_id?: string;
  parametro_chave?: string;
  aliquota?: number;
  /** ordem da faixa, quando veio de tabela progressiva */
  faixa_aplicada?: number;
  fonte?: FonteCelula;
  /** só em `digitado`: override vindo de `cenario_rubricas` */
  rubrica_id?: string;
  /** só em `ausente`: o que falta, em português, na tela */
  motivo?: string;
  /** só em `ausente`: as chaves de parâmetro que destravam esta célula */
  falta?: FaltaParametro[];
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type ClasseBem = "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";

export const MODELOS_CROQUI = ["inventario", "doacao", "celula_1", "celula_2", "celula_3"] as const;
export type ModeloCroqui = (typeof MODELOS_CROQUI)[number];

/** Modelos de holding (os que têm honorário, junta e contabilidade). */
export const MODELOS_HOLDING = ["celula_1", "celula_2", "celula_3"] as const;
export type ModeloHolding = (typeof MODELOS_HOLDING)[number];

export const ROTULO_MODELO: Record<ModeloCroqui, string> = {
  inventario: "Inventário",
  doacao: "Doação em vida",
  celula_1: "1 célula",
  celula_2: "2 células",
  celula_3: "3 células",
};

export interface BemCroqui {
  /** `patrimonio_itens.id` */
  id: string;
  classe: ClasseBem;
  descricao: string;
  /** `patrimonio_itens.valor_historico` */
  valor_dirpf: number | null;
  valor_mercado: number | null;
  destinacao: "uso" | "locacao" | "venda" | "operacional" | null;
  valor_locacao_mensal: number | null;
  ano_aquisicao: number | null;
  /** bem escolhido para dar liquidez ao inventário (T4) */
  vender_para_levantar?: boolean;
}

export interface FamiliaCroqui {
  regime_bens: string | null;
  tem_conjuge: boolean;
  filhos: number | null;
  netos: number | null;
  nucleos: number | null;
}

export interface OperacionalCroqui {
  faturamento_mensal: number | null;
  custo_operacional_mensal: number | null;
}

/** Override de célula vindo da gaveta do Cenário Patrimonial (0057). */
export interface OverrideCelula {
  tabela: ChaveTabela | string;
  linha: string;
  coluna: string;
  valor: number;
  rubrica_id: string;
}

export interface EntradaCroqui {
  jornada_id: string;
  /** jurisdição do ITCMD e dos cartórios */
  uf: string | null;
  /** jurisdição do ITBI */
  municipio: string | null;
  /** 2 células — domicílio fiscal vantajoso */
  uf_domicilio_vantajoso: string | null;
  familia: FamiliaCroqui;
  bens: BemCroqui[];
  operacional: OperacionalCroqui | null;
  modelos: ModeloCroqui[];
  /** premissa do payback; `null` usa o parâmetro `payback.cdi_anual.percentual` */
  cdi_anual?: number | null;
  overrides: OverrideCelula[];
}

// ---------------------------------------------------------------------------
// Faixas progressivas
// ---------------------------------------------------------------------------

/**
 * ITCMD (causa mortis e doação), IR sobre ganho de capital, IRPF mensal e
 * emolumentos de cartório **não são alíquotas únicas** — são tabelas por
 * faixa, que o escritório mantém para as 27 UFs.
 */
export type ModoFaixa = "faixa_unica" | "progressivo" | "valor_fixo";

export interface Faixa {
  /** sequencial a partir de 1 */
  ordem: number;
  /** teto da faixa; `null` só na última */
  ate: number | null;
  /** % — em `faixa_unica` e `progressivo` */
  aliquota?: number;
  /** R$ — em `valor_fixo` */
  valor?: number;
  /** parcela a deduzir (tabela progressiva do IRPF mensal) */
  deduzir?: number;
}

export interface TabelaFaixas {
  modo: ModoFaixa;
  /** base até aqui → resultado 0, `calculado` (isenção é resultado, não ausência) */
  isento_ate?: number;
  /** teto do valor calculado (não da base) */
  teto?: number;
  faixas: Faixa[];
}

export interface ResultadoFaixa {
  valor: number;
  faixa_aplicada: number;
  formula: string;
  aliquota?: number;
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export type UnidadeParametroCroqui =
  | "brl"
  | "percentual"
  | "parcelas"
  | "dias"
  | "meses"
  | "quantidade"
  | "faixas";

/**
 * Uma versão ativa de `parametros_metodo`, achatada para o motor. `valor` e
 * `faixas` são mutuamente exclusivos (CHECK XOR na 0062).
 */
export interface ParametroCroqui {
  id: string;
  chave: string;
  versao: number;
  unidade: UnidadeParametroCroqui;
  valor: number | null;
  faixas: TabelaFaixas | null;
  uf: string | null;
  municipio: string | null;
  base_legal: string | null;
}

/** Uma linha da tabela de horas por ato (`configuracoes['croqui.horas_por_ato']`). */
export interface HorasPorAto {
  ato: string;
  horas: Partial<Record<ModeloHolding, number>>;
}

/**
 * Mesma chave em duas versões conflitantes no material do escritório
 * (certidões 2.000 × 7.000, membership 1 plano × 3, IBS/CBS 26,5% × 36,92%).
 * O motor NUNCA escolhe um dos valores: trava a tabela dependente com
 * `ausente` e devolve a divergência para o Painel do admin.
 */
export interface DivergenciaParametro {
  chave: string;
  valores: number[];
  onde: string;
}

export interface ParametrosCroqui {
  /** chave de mapa = `chaveMapa(chave, uf, municipio)` */
  itens: Record<string, ParametroCroqui>;
  /** `configuracoes['croqui.horas_por_ato']` — vazio trava T15/T16 */
  horas_por_ato: HorasPorAto[];
  /** `configuracoes['croqui.sinal_modelo_referencia']` — default `celula_3` */
  sinal_modelo_referencia: ModeloHolding;
  /** `configuracoes['parametros.divergencias']` */
  divergencias: DivergenciaParametro[];
}

// ---------------------------------------------------------------------------
// Resultado — 19 tabelas, espelhando as 19 abas da planilha do escritório
// ---------------------------------------------------------------------------

export const CHAVES_TABELA = [
  "composicao_familiar", // T1  · aba 1 Família
  "formacao_patrimonial", // T2  · aba 2 Patrimônio
  "inventario_atual", // T3  · aba 3 Inventário (B3–B9)
  "levantamento_inventario", // T4  · aba 3 Inventário (B12–B18)
  "inventario_reforma", // T5  · deck (ITCMD pela tabela de reforma)
  "doacao", // T6  · aba 4 Doações
  "celula_1", // T7  · aba 5
  "celula_2", // T8  · aba 6
  "celula_3", // T9  · aba 7
  "operacional_pj", // T10 · aba 8 Operacional
  "payback", // T11 · aba 9 Payback
  "operacional_locacao", // T12 · aba 10 Aluguéis futuros
  "comparativo_geral", // T13 · aba 11 Comparativos
  "itbi", // T14 · aba 12 Comparativos com ITBI
  "horas_por_ato", // T15 · aba 13 Horas de trabalho
  "honorarios", // T16 · aba 14 Honorários (B6–B9)
  "deducoes", // T17 · aba 14 Honorários (B12–B19)
  "pagamento", // T18 · aba 14 Honorários (B22–B28)
  "membership", // T19 · contrato + slide 37
] as const;
export type ChaveTabela = (typeof CHAVES_TABELA)[number];

/**
 * Unidade de leitura de uma célula. **Vem do motor**, não do nome da chave.
 *
 * Antes desta versão a camada de apresentação reconstruía a unidade por nome
 * (`UNIDADE_POR_CHAVE` em `src/components/croqui/formatoTabela.ts`): uma linha
 * nova chamada `percentual` que fosse R$ renderizava como porcentagem em
 * silêncio. Agora quem monta a tabela carimba, porque é quem sabe.
 *
 * Campo OPCIONAL de propósito: ausência = `brl`, que é a unidade de ~90% das
 * ~250 células. Aditivo ao contrato congelado do §11.4.
 */
export type UnidadeCelula =
  | "brl"
  | "percentual"
  /** resultado de divisão — uma casa decimal + "meses" ("18,1 meses") */
  | "meses"
  /** contagem inteira de meses ("6 meses", nunca "6,0 meses") */
  | "meses_inteiros"
  /** contagem pura, sem sufixo (filhos, netos, núcleos) */
  | "contagem"
  | "horas";

export const UNIDADE_CELULA_PADRAO: UnidadeCelula = "brl";

export interface ColunaTabela {
  chave: string;
  rotulo: string;
  /** sobrepõe `Tabela.unidade` para esta coluna */
  unidade?: UnidadeCelula;
}

export interface LinhaTabela {
  chave: string;
  rotulo: string;
  /** linha de total/resultado — a tela dá peso visual */
  destaque?: boolean;
  /** sobrepõe coluna e tabela — é a mais específica das três */
  unidade?: UnidadeCelula;
  celulas: Record<string, Celula>;
}

export interface Tabela {
  chave: ChaveTabela;
  titulo: string;
  /** pass-through textual que não cabe em célula numérica (regime de bens etc.) */
  nota?: string;
  /** unidade de toda a tabela (T1 é contagem, T15 é hora) */
  unidade?: UnidadeCelula;
  colunas: ColunaTabela[];
  linhas: LinhaTabela[];
  /** união das faltas de todas as células desta tabela */
  falta: FaltaParametro[];
}

/**
 * Precedência: linha > coluna > tabela > `brl`. Uma regra, um lugar — tela,
 * deck, apresentação, simulador, `/p/m` e `.docx` leem daqui.
 */
export function resolverUnidade(
  tabela: Pick<Tabela, "unidade"> | undefined,
  linha: Pick<LinhaTabela, "unidade"> | undefined,
  coluna: Pick<ColunaTabela, "unidade"> | undefined,
): UnidadeCelula {
  return linha?.unidade ?? coluna?.unidade ?? tabela?.unidade ?? UNIDADE_CELULA_PADRAO;
}

// ---------------------------------------------------------------------------
// Recorte público do croqui (`/p/m`)
// ---------------------------------------------------------------------------

/**
 * O que o método considera material de CLIENTE. Comparações e arquiteturas
 * saem; **horas por ato (T15), honorários (T16), deduções (T17) e condição de
 * pagamento (T18) não** — é a margem e a negociação do escritório, e o link
 * público fica com o cliente, sem sessão, para sempre.
 *
 * Mora em `src/types/**` (e não em `src/components/**`) porque quem PRECISA
 * dela é o servidor, na serialização: filtrar no navegador é declaração, não
 * trava — o payload já atravessou a rede. `src/server/material/publico.ts`
 * importa daqui; a camada de apresentação reexporta para não duplicar a lista.
 */
export const TABELAS_VISIVEIS_AO_CLIENTE: ReadonlySet<ChaveTabela> = new Set<ChaveTabela>([
  "composicao_familiar",
  "formacao_patrimonial",
  "inventario_atual",
  "inventario_reforma",
  "levantamento_inventario",
  "doacao",
  "celula_1",
  "celula_2",
  "celula_3",
  "operacional_pj",
  "operacional_locacao",
  "comparativo_geral",
  "itbi",
  "payback",
  "membership",
]);

export function visivelAoCliente(chave: ChaveTabela): boolean {
  return TABELAS_VISIVEIS_AO_CLIENTE.has(chave);
}

export interface FaltaAgregada extends FaltaParametro {
  tabelas: ChaveTabela[];
}

export const MOTOR_VERSAO = "motor-croqui@1" as const;
export type MotorVersao = typeof MOTOR_VERSAO;

export interface ResultadoCroqui {
  motor_versao: MotorVersao;
  gerado_em: string;
  /** tabela sem insumo SAI do resultado — não vira linha de zeros */
  tabelas: Partial<Record<ChaveTabela, Tabela>>;
  faltas: FaltaAgregada[];
  divergencias: DivergenciaParametro[];
}

// ---------------------------------------------------------------------------
// Persistência (0063 `croqui_calculos`) e rota
// ---------------------------------------------------------------------------

export interface CroquiCalculo {
  id: string;
  jornada_id: string;
  croqui_id: string | null;
  versao: number;
  motor_versao: string;
  entrada_snapshot: EntradaCroqui;
  parametros_snapshot: ParametrosCroqui;
  resultado: ResultadoCroqui;
  atual: boolean;
  nota: string | null;
  criado_em: string;
  criado_por: string | null;
}

export type CroquiCalculoResumo = Omit<
  CroquiCalculo,
  "entrada_snapshot" | "parametros_snapshot" | "resultado"
>;

/** `GET /api/jornadas/[id]/croqui-calculo` */
export interface RespostaCroquiCalculo {
  atual: CroquiCalculo | null;
  historico: CroquiCalculoResumo[];
  /** entrada montada AGORA a partir da Ficha (a base do simulador ao vivo) */
  entrada: EntradaCroqui;
  /** parâmetros vigentes AGORA (o simulador recalcula no cliente com estes) */
  parametros: ParametrosCroqui;
  /** chaves que este cliente exige e que não têm versão ativa */
  ausentes: FaltaParametro[];
  divergencias: DivergenciaParametro[];
}

/**
 * `POST /api/jornadas/[id]/croqui-calculo` — o corpo é opcional e serve só
 * para carimbar o croqui e a nota. A rota **recalcula no servidor** com os
 * `parametros_metodo` vigentes e **ignora** qualquer `resultado` do corpo:
 * número que o cliente manda não vira versão gravada.
 */
export interface CorpoRegistrarCroquiCalculo {
  croqui_id?: string | null;
  nota?: string | null;
}

export interface RespostaRegistrarCroquiCalculo {
  calculo: CroquiCalculo;
}
