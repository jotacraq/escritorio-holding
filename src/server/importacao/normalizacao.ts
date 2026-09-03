/**
 * Normalização de campo — ÚNICA fonte de verdade (nunca duplicada em SQL; ver
 * comentário no topo de `0035_importacao.sql`). Cada função devolve o valor
 * limpo (ou `null` quando ausente/irrecuperável) e um aviso opcional, não
 * bloqueante — dado ruim numa coluna secundária não derruba a linha inteira,
 * só perde aquele campo específico, de forma visível para o operador.
 */

const TAMANHO_MAXIMO_TEXTO_PADRAO = 200;
const TAMANHO_MAXIMO_OBSERVACOES = 2000;

export { TAMANHO_MAXIMO_OBSERVACOES };

export function normalizarTexto(
  valor: string | undefined,
  tamanhoMaximo: number = TAMANHO_MAXIMO_TEXTO_PADRAO,
): string | null {
  const limpo = (valor ?? "").trim();
  if (!limpo) return null;
  return limpo.slice(0, tamanhoMaximo);
}

export interface ResultadoNormalizacao<T> {
  valor: T | null;
  aviso?: string;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAMANHO_MAXIMO_EMAIL = 200;

/** `pessoas.email` é sempre gravado em minúsculo (mesma convenção de
 * `resolverOuCriarPessoa`, `src/server/jornadas.ts`) — dedupe depende disso. */
export function normalizarEmail(valor: string | undefined): ResultadoNormalizacao<string> {
  const bruto = (valor ?? "").trim();
  if (!bruto) return { valor: null };

  const limpo = bruto.toLowerCase();
  if (limpo.length > TAMANHO_MAXIMO_EMAIL || !REGEX_EMAIL.test(limpo)) {
    return { valor: null, aviso: `E-mail em formato inválido, descartado: "${bruto}".` };
  }
  return { valor: limpo };
}

/**
 * Telefone brasileiro -> E.164 (`+55DDDNNNNNNNNN`), a mesma forma que
 * `pessoas.telefone` espera ("E.164 normalizado pelo app", comentário de
 * 0003). Aceita com/sem DDI, com/sem símbolos de formatação. Não inventa
 * país: se depois de tirar o DDI 55 (quando presente) sobrar uma quantidade
 * de dígitos que não é 10 nem 11 (DDD + fixo/celular), descarta com aviso —
 * nunca deixa lixo virar uma "chave" que colide por acaso com outra pessoa.
 */
export function normalizarTelefoneBr(valor: string | undefined): ResultadoNormalizacao<string> {
  const bruto = (valor ?? "").trim();
  if (!bruto) return { valor: null };

  const digitos = bruto.replace(/\D/g, "");
  if (!digitos) {
    return { valor: null, aviso: `Telefone sem dígitos, descartado: "${bruto}".` };
  }

  let semDdi = digitos;
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    semDdi = digitos.slice(2);
  } else if (digitos.length > 11) {
    // DDI diferente de 55, ou dígitos extras por erro de digitação — usa os
    // últimos 11 dígitos (heurística; não é validação internacional completa).
    semDdi = digitos.slice(-11);
  }

  if (semDdi.length !== 10 && semDdi.length !== 11) {
    return { valor: null, aviso: `Telefone com quantidade de dígitos inválida, descartado: "${bruto}".` };
  }

  return { valor: `+55${semDdi}` };
}

export function normalizarUf(valor: string | undefined): ResultadoNormalizacao<string> {
  const bruto = (valor ?? "").trim();
  if (!bruto) return { valor: null };

  const limpo = bruto.toUpperCase();
  if (!/^[A-Z]{2}$/.test(limpo)) {
    return { valor: null, aviso: `UF fora do padrão de 2 letras, descartada: "${bruto}".` };
  }
  return { valor: limpo };
}

/** `participacoes_seminario.dias_assistidos` é `smallint` entre 0 e 3 (0004/0003). */
export function normalizarDiasAssistidos(valor: string | undefined): ResultadoNormalizacao<number> {
  const bruto = (valor ?? "").trim();
  if (!bruto) return { valor: null };

  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero < 0 || numero > 3) {
    return { valor: null, aviso: `"Dias assistidos" fora do intervalo 0-3, descartado: "${bruto}".` };
  }
  return { valor: numero };
}
