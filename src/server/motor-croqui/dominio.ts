import type { ModeloCroqui } from "@/types/croqui-calculo";

/**
 * Regras FIXAS do método (§4.5) — desenho, não preço.
 *
 * Parametrizar isto seria oferecer ao Admin a chance de quebrar o método sem
 * perceber. Cada constante aqui sai da leitura célula a célula da planilha real
 * do escritório (`brain/06 - Materiais/Processo real do escritorio (Drive).md`)
 * e as células que dependem delas saem com `fonte: "fixo_metodo"`.
 */

/**
 * Base do ITCMD por modelo. A base de MERCADO em 1 e 2 células e DIRPF só em 3
 * é diferença de desenho tributário real entre os modelos — é o que faz a 3ª
 * célula ser tão mais barata.
 *
 * ⚠️ §11.5 BLOQUEIO 2: confirmar com a Dra. Elaine que é intencional, não
 * resquício. Está assim na planilha e muda muito o preço apresentado.
 */
export const BASE_ITCMD: Record<ModeloCroqui, "mercado" | "dirpf"> = {
  inventario: "mercado",
  doacao: "mercado",
  celula_1: "mercado",
  celula_2: "mercado",
  celula_3: "dirpf", // ← só a 3ª usa DIRPF
};

/** Base do cartório de imóveis por modelo — a DOAÇÃO usa DIRPF (aba 4, B9). */
export const BASE_CARTORIO_IMOVEIS: Record<ModeloCroqui, "mercado" | "dirpf"> = {
  inventario: "mercado",
  doacao: "dirpf", // ← a doação usa DIRPF
  celula_1: "mercado",
  celula_2: "mercado",
  celula_3: "mercado",
};

/** Cascata de controle: Destino controla Veículo, que controla Cofre. */
export const CASCATA_CELULAS = ["destino", "veiculo", "cofre"] as const;
export type CelulaEstrutural = (typeof CASCATA_CELULAS)[number];

/** T10 (aba 8) — custo operacional da PJ: 16,33% do faturamento + R$ 20.000. */
export const OPERACIONAL_CUSTO_PERCENTUAL = 16.33;
export const OPERACIONAL_CUSTO_FIXO = 20000;

/** T10 (aba 8, B7) — locação intercompany ("hemorragia reversa"): 10% do faturamento. */
export const OPERACIONAL_LOCACAO_INTERCOMPANY_PERCENTUAL = 10;

/**
 * T12 (aba 10, B24) — a planilha multiplica a economia mensal por **13**, não
 * por 12. Reproduzido de propósito, com a `formula` da célula dizendo isso na
 * tela: é número que o escritório já apresenta ao cliente.
 */
export const LOCACAO_MESES_ANO = 13;

/** T13/T11 — modelo cujo custo total serve de referência para o payback e o sinal. */
export const MODELO_REFERENCIA_PADRAO = "celula_3" as const;

/** Ordem de apresentação dos modelos no comparativo (T13/T14). */
export const ORDEM_MODELOS: ModeloCroqui[] = ["inventario", "doacao", "celula_1", "celula_2", "celula_3"];
