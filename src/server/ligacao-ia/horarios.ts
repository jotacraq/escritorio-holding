import type { HorarioOfertadoIa } from "@/types/integracoes";

const FUSO = "America/Sao_Paulo";

const fmtDiaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, month: "long" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * "terça-feira, 10 de setembro, às 15h" (ou "às 15h30"). É o que a assistente
 * de voz lê em voz alta — por extenso, sem número de ano, no fuso da advogada.
 */
export function rotuloHorario(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const [hora, minuto] = fmtHora.format(data).split(":");
  const horaFalada = minuto === "00" ? `${Number(hora)}h` : `${Number(hora)}h${minuto}`;
  return `${fmtDiaSemana.format(data)}, ${fmtDia.format(data)} de ${fmtMes.format(data)}, às ${horaFalada}`;
}

export function paraHorarioOfertado(item: { inicio_em: string; fim_em: string }): HorarioOfertadoIa {
  return { inicio_em: item.inicio_em, fim_em: item.fim_em, rotulo: rotuloHorario(item.inicio_em) };
}
