/**
 * Normalização de telefone para E.164 — o formato que `pessoas.telefone`
 * guarda (0003: "E.164 normalizado pelo app", índice único parcial).
 *
 * Regras conservadoras (nunca "inventa" DDI):
 *  - só dígitos; "+" inicial preservado como sinal de que o DDI já veio;
 *  - 10 ou 11 dígitos sem DDI → Brasil (+55);
 *  - 12 ou 13 dígitos começando por 55 → Brasil já com DDI;
 *  - qualquer outro tamanho → devolve `null` (não casa com ninguém, vai para
 *    "Sem correspondência" na tela, em vez de casar com a pessoa errada).
 */
export function normalizarTelefoneE164(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const temMais = bruto.trim().startsWith("+");
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 0) return null;

  if (temMais) {
    return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
  }
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return `+${digitos}`;
  return null;
}

/** Variantes que podem estar gravadas em `pessoas.telefone` para o mesmo número
 * (com/sem o 9 do celular). Usado só para BUSCAR, nunca para gravar. */
export function variantesTelefone(e164: string): string[] {
  const variantes = new Set<string>([e164]);
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (m) {
    const [, ddd, numero] = m;
    if (numero.length === 9 && numero.startsWith("9")) variantes.add(`+55${ddd}${numero.slice(1)}`);
    if (numero.length === 8) variantes.add(`+55${ddd}9${numero}`);
  }
  return [...variantes];
}
