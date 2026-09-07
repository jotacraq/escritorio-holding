/** `dia_semana` é `smallint 0-6`, `0 = domingo` (igual `extract(dow)` do Postgres). */
export const ROTULO_DIA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export function formatarHoraSql(hora: string): string {
  // Postgres devolve "HH:MM:SS" para `time`; a tela só precisa de "HH:MM".
  return hora.slice(0, 5);
}

/**
 * `vale_de`/`vale_ate` são `date` puro ("YYYY-MM-DD"), sem hora e sem fuso.
 *
 * A correção mora em `lib/formatar.ts` desde a rodada FIX da Fase 8 (era esta
 * função, mais uma igual em `admin/comum.tsx`, mais o tratamento interno de
 * `ui/Prazo` — três cópias). O nome local fica: a Agenda chama de "data de
 * calendário", e trocar as chamadas seria mexer em tela por causa de um
 * import.
 */
export { formatarDataPura as formatarDataCalendario } from "@/lib/formatar";
