import type { SegmentoCopiloto } from "@/types/copiloto";

/** Acrescenta o segmento recém-criado à resposta cacheada por `useRecurso`,
 * sem esperar a próxima leitura — mesma técnica de `setDados` usada por
 * `PainelSims`/`PainelBriefingSessao` (estado de servidor, não duplicado). */
export function adicionarSegmento(
  atual: { itens: SegmentoCopiloto[]; proximo_cursor: number } | undefined,
  novo: SegmentoCopiloto,
): { itens: SegmentoCopiloto[]; proximo_cursor: number } {
  const itens = [...(atual?.itens ?? []), novo];
  return { itens, proximo_cursor: novo.ordem };
}
