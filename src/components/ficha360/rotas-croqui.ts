/**
 * Onde mora o Croqui — um lugar só.
 *
 * A Onda 2 moveu as telas do croqui de `/jornadas/[id]/croqui/[croquiId]/*`
 * (Fase 3/4) para `/croquis/[croquiId]/*` (M4: a tela das 19 tabelas, a
 * apresentação e o simulador ao vivo). O interruptor `CROQUI_EM_ROTA_PROPRIA`
 * existiu enquanto as duas árvores conviviam — apontar antes de as telas
 * existirem trocaria um link que funciona por um 404, que é o "build verde não
 * prova que a tela abre" que já custou caro aqui.
 *
 * Em 05/09 (costura) as rotas antigas foram **apagadas**: as três telas novas
 * abriram no navegador, e uma rota que ninguém alcança é rota que envelhece
 * sem ninguém perceber. O interruptor saiu junto — um `if` cujo ramo `false`
 * aponta para uma página que não existe mais é pior que não ter `if`.
 *
 * Com a árvore antiga fora, o `jornadaId` deixou de ser insumo de rota: as
 * três funções passam a receber só o `croquiId` (a rota resolve a jornada por
 * `GET /api/croquis/[id]`).
 */

export function rotaCroquiVer(croquiId: string): string {
  return `/croquis/${croquiId}`;
}

export function rotaCroquiApresentar(croquiId: string): string {
  return `/croquis/${croquiId}/apresentar`;
}

/** Simulador ao vivo (§7) — a terceira tela do croqui. */
export function rotaCroquiSimular(croquiId: string): string {
  return `/croquis/${croquiId}/simular`;
}
