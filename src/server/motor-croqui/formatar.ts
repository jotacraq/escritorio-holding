import type { Celula } from "@/types/croqui-calculo";
import { arredondar } from "./celula";

/**
 * Formatação de APRESENTAÇÃO — a única camada que arredonda. Tela, `.docx`,
 * slide e `/p/m` usam ESTA função; nenhuma delas formata por conta própria.
 *
 * A regra que existe por causa de um caso real: **célula ausente nunca vira
 * "R$ 0,00"**. O deck que o escritório entregou ao cliente dizia "a família
 * perde aproximadamente R$ 0,00" porque a sincronização falhou em silêncio.
 * Aqui, ausência é um travessão — e o motivo fica visível ao lado.
 */

/** O que aparece no lugar de um número que não existe. */
export const TEXTO_AUSENTE = "—";

export type TipoValor = "brl" | "percentual" | "numero" | "meses";

// Instanciados uma vez: o simulador ao vivo reformata ~200 células a cada
// tecla, e `new Intl.NumberFormat` por célula custa mais que a conta inteira.
const UMA_CASA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const MOEDA = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatarValor(valor: number, tipo: TipoValor = "brl"): string {
  switch (tipo) {
    case "percentual":
      return `${UMA_CASA.format(arredondar(valor, 1))}%`;
    case "meses":
      return `${UMA_CASA.format(arredondar(valor, 1))} meses`;
    case "numero":
      return INTEIRO.format(Math.round(valor));
    default:
      return MOEDA.format(arredondar(valor, 2));
  }
}

/**
 * Texto de uma célula. Ausente devolve `TEXTO_AUSENTE` — nunca um número, nunca
 * "R$ 0,00", nunca string vazia (que na tabela vira buraco silencioso).
 */
export function formatarCelula(celula: Celula, tipo: TipoValor = "brl"): string {
  if (celula.procedencia === "ausente" || celula.valor === null || !Number.isFinite(celula.valor)) {
    return TEXTO_AUSENTE;
  }
  return formatarValor(celula.valor, tipo);
}

/** Explicação da célula para `title`/tooltip: fórmula, ou o que falta. */
export function explicarCelula(celula: Celula): string | undefined {
  if (celula.procedencia === "ausente") return celula.motivo;
  return celula.formula;
}

/** `true` quando a célula pode entrar numa frase de fechamento ("a família
 * perde R$ X"). Frase com valor ausente NÃO é montada. */
export const podeAfirmar = (celula: Celula): boolean =>
  celula.procedencia !== "ausente" && celula.valor !== null && Number.isFinite(celula.valor);
