/**
 * Datas por extenso para o cliente ("Terça, 14 de setembro às 10:00") —
 * nunca "14/09 10:00". Sempre no fuso de São Paulo, que é o da equipe e o que
 * a mensagem enviada ao cliente usa. Compartilhado por `/p/a` e `/p/c`.
 */
const FUSO = "America/Sao_Paulo";

export function formatarDiaPorExtenso(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const texto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" }).format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatarHoraSimples(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(data);
}

/** "14/09 às 10:07" — para carimbos curtos ("você confirmou em…"). */
export function formatarCarimboCurto(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(data);
  return `${dia} às ${formatarHoraSimples(iso)}`;
}

/** Chave estável de agrupamento por dia (fuso SP). */
export function chaveDoDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
