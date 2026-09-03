/** `dia_semana` é `smallint 0-6`, `0 = domingo` (igual `extract(dow)` do Postgres). */
export const ROTULO_DIA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export function formatarHoraSql(hora: string): string {
  // Postgres devolve "HH:MM:SS" para `time`; a tela só precisa de "HH:MM".
  return hora.slice(0, 5);
}
