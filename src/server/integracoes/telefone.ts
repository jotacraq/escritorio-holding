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

/**
 * DDDs que existem no Brasil (Anatel). Um número com DDD inexistente não é
 * "quase certo": é lixo de digitação, e discar nele queima crédito e assusta
 * quem atende do outro lado.
 */
const DDDS_BRASIL = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type MotivoTelefoneInvalido =
  | "vazio"
  | "formato_desconhecido"
  | "ddd_inexistente"
  | "assinante_invalido";

export type ResultadoTelefoneLigacao =
  | { valido: true; e164: string; alterado: boolean }
  | { valido: false; motivo: MotivoTelefoneInvalido };

/**
 * Normalização ESTRITA para DISCAR (ligação por IA). Mais dura que
 * `normalizarTelefoneE164` de propósito: aqui um número errado não vira
 * "sem correspondência" numa tela, vira uma ligação para a pessoa errada.
 *
 * Regras para o Brasil (`+55`):
 *  - DDD tem de existir (`DDDS_BRASIL`);
 *  - assinante com 9 dígitos → móvel, tem de começar com 9 (`+55DDD9XXXXXXXX`);
 *  - assinante com 8 dígitos começando em 6–9 → móvel antigo: o 9 é ACRESCENTADO
 *    (é a migração da Anatel, não um chute — o número sem o 9 não completa mais);
 *  - assinante com 8 dígitos começando em 2–5 → fixo, aceito como está;
 *  - qualquer outro tamanho/prefixo → inválido.
 *
 * Fora do Brasil (`+DDI` já explícito), aceita 8–15 dígitos: não temos plano de
 * numeração de outros países aqui e recusar seria pior do que deixar a Vapi
 * responder "número inválido".
 *
 * `alterado` = o E.164 devolvido é diferente do que estava gravado (só acontece
 * na formatação ou no 9 acrescentado) — quem chama decide se persiste.
 */
export function telefoneParaLigacao(bruto: string | null | undefined): ResultadoTelefoneLigacao {
  const original = (bruto ?? "").trim();
  if (original.length === 0) return { valido: false, motivo: "vazio" };

  const e164 = normalizarTelefoneE164(original);
  if (!e164) return { valido: false, motivo: "formato_desconhecido" };

  if (!e164.startsWith("+55")) {
    return { valido: true, e164, alterado: e164 !== original };
  }

  const nacional = e164.slice(3);
  if (nacional.length < 10 || nacional.length > 11) return { valido: false, motivo: "formato_desconhecido" };

  const ddd = Number(nacional.slice(0, 2));
  if (!DDDS_BRASIL.has(ddd)) return { valido: false, motivo: "ddd_inexistente" };

  const assinante = nacional.slice(2);
  let finalAssinante: string;
  if (assinante.length === 9) {
    if (assinante[0] !== "9") return { valido: false, motivo: "assinante_invalido" };
    finalAssinante = assinante;
  } else if (/^[6-9]/.test(assinante)) {
    finalAssinante = `9${assinante}`; // móvel de 8 dígitos: o nono dígito é obrigatório desde 2016
  } else if (/^[2-5]/.test(assinante)) {
    finalAssinante = assinante; // fixo
  } else {
    return { valido: false, motivo: "assinante_invalido" };
  }

  const normalizado = `+55${nacional.slice(0, 2)}${finalAssinante}`;
  return { valido: true, e164: normalizado, alterado: normalizado !== original };
}

/**
 * Variantes que podem estar gravadas em `pessoas.telefone` para o mesmo número.
 * Usado só para BUSCAR, nunca para gravar.
 *
 * Fase 9 (CONFLITO C1, D3): até 07/09/2026 só gerava as formas `+55…`, e o
 * MEDIDO no banco é que a única pessoa `origem_dado='real'` está gravada como
 * `11988887777` — 11 dígitos, sem `+`. Ou seja: o casamento por telefone
 * falhava justamente para quem é real e acertava as quatro famílias de
 * demonstração. Agora cada forma sai em quatro grafias:
 *
 *   +55DDD9XXXXXXXX  ·  55DDD9XXXXXXXX  ·  DDD9XXXXXXXX  ·  (as três sem o 9)
 *
 * O `.in()` sobre `uniq_pessoas_telefone` (0003:24) continua usando índice —
 * é uma busca por igualdade em lista curta, não um `like`.
 *
 * Isto NÃO normaliza o cadastro: quem está fora do padrão continua fora, e a
 * correção é ato humano (pendência `telefone_fora_do_padrao`, 0089). Backfill
 * que reclassifica gente em silêncio é proibido nesta casa.
 */
export function variantesTelefone(e164: string): string[] {
  const comMais = new Set<string>([e164]);
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (m) {
    const [, ddd, numero] = m;
    if (numero.length === 9 && numero.startsWith("9")) comMais.add(`+55${ddd}${numero.slice(1)}`);
    if (numero.length === 8) comMais.add(`+55${ddd}9${numero}`);
  }

  const todas = new Set<string>();
  for (const forma of comMais) {
    todas.add(forma);
    const digitos = forma.replace(/^\+/, "");
    todas.add(digitos); // 55DDD…
    if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
      todas.add(digitos.slice(2)); // DDD… (o formato que o cadastro real tem hoje)
    }
  }
  return [...todas];
}
