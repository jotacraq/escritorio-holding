/** `dia_semana` é `smallint 0-6`, `0 = domingo` (igual `extract(dow)` do Postgres). */
export const ROTULO_DIA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export function formatarHoraSql(hora: string): string {
  // Postgres devolve "HH:MM:SS" para `time`; a tela só precisa de "HH:MM".
  return hora.slice(0, 5);
}

/**
 * `vale_de`/`vale_ate` são `date` puro ("YYYY-MM-DD"), sem hora e sem fuso.
 * NÃO usar `formatarData` de `src/lib/formatar.ts` aqui: aquela função faz
 * `new Date(iso)` (interpreta a string como meia-noite UTC) e depois formata
 * em `America/Sao_Paulo`, o que empurra a data um dia para trás (meia-noite
 * UTC é 21h do dia anterior em UTC-3) — correto para timestamps, errado para
 * uma data de calendário pura. Reformatar a string direto evita o bug sem
 * mexer num arquivo compartilhado por outras telas.
 */
export function formatarDataCalendario(data: string | null): string {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}
