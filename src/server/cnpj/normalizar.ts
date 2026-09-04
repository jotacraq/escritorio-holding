/**
 * Normalização e validação de CNPJ — a trava de SSRF desta feature.
 *
 * REGRA DURA (docs/ARQUITETURA-FASE-3.md §4.4.2): o CNPJ é normalizado para
 * exatamente `^[0-9]{14}$` ANTES de compor qualquer URL de saída. Concatenar
 * entrada de usuário direto numa URL de requisição de servidor é SSRF — e
 * este servidor roda com `SUPABASE_SERVICE_ROLE_KEY` no ambiente. Por isso:
 *
 *   1. `normalizarCnpj` só aceita dígitos, `.`, `-`, `/` e espaço na entrada
 *      (qualquer outro caractere é rejeitado ANTES do strip — não tentamos
 *      "limpar" esquema/host/porta que alguém tenha tentado injetar).
 *   2. O resultado tem que casar `^[0-9]{14}$` byte a byte.
 *   3. Só DEPOIS disso o chamador (`brasilapi.ts`) pode compor a URL —
 *      e mesmo assim, `encodeURIComponent` no valor final (defesa em
 *      profundidade: 14 dígitos não têm o que escapar, mas o padrão do
 *      projeto é nunca interpolar sem escapar).
 */

const CARACTERES_PERMITIDOS = /^[0-9.\-/\s]+$/;
const CATORZE_DIGITOS = /^[0-9]{14}$/;

export class CnpjInvalidoError extends Error {
  constructor(motivo: string) {
    super(`cnpj_invalido: ${motivo}`);
    this.name = "CnpjInvalidoError";
  }
}

/**
 * Normaliza uma entrada de CNPJ (com ou sem máscara) para 14 dígitos.
 * Lança `CnpjInvalidoError` — nunca devolve um valor fora do formato
 * `^[0-9]{14}$`. Chame isto antes de QUALQUER uso do valor (URL, banco).
 */
export function normalizarCnpj(entrada: string): string {
  if (typeof entrada !== "string" || entrada.trim().length === 0) {
    throw new CnpjInvalidoError("entrada vazia");
  }
  if (!CARACTERES_PERMITIDOS.test(entrada)) {
    throw new CnpjInvalidoError("entrada contém caractere não permitido (só dígitos, '.', '-', '/' e espaço)");
  }

  const digitos = entrada.replace(/[^0-9]/g, "");

  if (!CATORZE_DIGITOS.test(digitos)) {
    throw new CnpjInvalidoError(`esperado 14 dígitos, recebido ${digitos.length}`);
  }
  if (/^(\d)\1{13}$/.test(digitos)) {
    // Todos os dígitos iguais (00000000000000, 11111111111111, ...) nunca é
    // um CNPJ real — a Receita não emite. Corta aqui, sem gastar chamada de
    // rede (egress é da organização inteira — ver docs/ARQUITETURA-FASE-3.md §4.2).
    throw new CnpjInvalidoError("todos os dígitos iguais não é um CNPJ válido");
  }
  if (!digitosVerificadoresValidos(digitos)) {
    throw new CnpjInvalidoError("dígitos verificadores não conferem");
  }

  return digitos;
}

/** true/false em vez de lançar — para validação de UI/zod sem try/catch. */
export function cnpjEhValido(entrada: string): boolean {
  try {
    normalizarCnpj(entrada);
    return true;
  } catch {
    return false;
  }
}

const PESOS_PRIMEIRO_DIGITO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_SEGUNDO_DIGITO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function calcularDigitoVerificador(base: string, pesos: number[]): number {
  const soma = pesos.reduce((acc, peso, indice) => acc + peso * Number(base[indice]), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function digitosVerificadoresValidos(catorzeDigitos: string): boolean {
  const doze = catorzeDigitos.slice(0, 12);
  const d1 = calcularDigitoVerificador(doze, PESOS_PRIMEIRO_DIGITO);
  const treze = doze + String(d1);
  const d2 = calcularDigitoVerificador(treze, PESOS_SEGUNDO_DIGITO);
  return catorzeDigitos === treze + String(d2);
}
