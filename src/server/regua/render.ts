/**
 * Renderização mínima de template ("mustache" de chave dupla, o mesmo
 * vocabulário de `app.enfileirar_mensagem`, 0013): `{{chave}}` → valor.
 *
 * Nunca deixa placeholder literal para trás: chave sem valor vira string
 * vazia — quem chama decide antes se o dado ausente vira frase honesta
 * (ex.: "te mando o link em seguida") ou pendência rotulada.
 */
export function renderizarTemplate(corpo: string, valores: Record<string, string | null | undefined>): string {
  return corpo.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, chave: string) => valores[chave] ?? "");
}

/** Placeholders ainda presentes num corpo (para hold/pendência antes de enviar). */
export function placeholdersRestantes(corpo: string): string[] {
  const achados = new Set<string>();
  for (const m of corpo.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) achados.add(m[1]);
  return [...achados];
}

export function formatarBrl(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(valor);
}

/** "terça-feira, 10 de setembro, às 15h" em America/Sao_Paulo — para mensagem ao cliente. */
export function formatarDataHumana(iso: string): string {
  const data = new Date(iso);
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(data);
  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const minuto = pegar("minute");
  const hora = minuto === "00" ? `${pegar("hour")}h` : `${pegar("hour")}h${minuto}`;
  return `${pegar("weekday")}, ${pegar("day")} de ${pegar("month")}, às ${hora}`;
}
