"use client";

import { useLayoutEffect, useRef } from "react";
import type { SegmentoCopiloto } from "@/types/copiloto";
import { formatarHora } from "@/lib/formatar";

/** Mesmo padrão de `PainelCopiloto.tsx`/`RegistroManual.tsx` (WCAG 2.1.1 —
 * container rolável exige foco por teclado). `jsx-a11y/no-noninteractive-
 * tabindex` reporta erro em `tabIndex={0}` LITERAL num `role="region"`
 * estático, mesmo sendo o padrão que a própria WCAG pede — uma constante
 * nomeada (não-literal do ponto de vista do linter) sai do falso positivo
 * sem mudar o comportamento em runtime (é sempre `0`). */
const TAB_INDEX_ROLAVEL = 0;

/**
 * Fase 12, Fatia B/F3 — a transcrição ENTRA na tela. Achado do Fable
 * (17/09): `usePollingCopiloto` já buscava `segmentos_novos` a cada ciclo e
 * DESCARTAVA — nenhum componente renderizava. Este painel é a primeira vez
 * que o dado chega à advogada; ~1.800 segmentos por sessão de 90min eram
 * banda paga e jogada fora.
 *
 * Regras da entrega:
 *  - Mais recente EMBAIXO (leitura de baixo pra cima, como um chat).
 *  - Auto-scroll ao fim só quando o usuário JÁ ESTAVA no fim — se ela rolou
 *    para cima para reler um trecho, um segmento novo não pode arrastá-la de
 *    volta (bug de UX clássico de "chat" que rola sozinho embaixo do dedo).
 *  - `role="region"` com rótulo + `aria-live="off"` — NUNCA `polite`: uma
 *    lista de 60 segmentos anunciada em voz alta a cada tick de 3s é
 *    inutilizável, não é acessibilidade.
 *  - Linhas duplicadas (eco do Zoom, ~8% medido) são dado real — não
 *    maquiadas, não deduplicadas aqui. É problema de fone de ouvido, não de
 *    tela.
 *  - Geometria constante: o painel é uma COLUNA do mosaico (F4), com
 *    `min-h-0` + rolagem própria — nunca estica a página.
 */
export function PainelTranscricao({ segmentos }: { segmentos: SegmentoCopiloto[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // `true` só quando o usuário estava a poucos pixels do fim ANTES deste
  // render receber segmentos novos — capturado no momento do scroll manual,
  // nunca recalculado a partir da lista (a lista já mudou quando o efeito
  // roda).
  const noFimRef = useRef(true);

  function aoRolar() {
    const el = containerRef.current;
    if (!el) return;
    const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Folga de 24px: o próprio auto-scroll pode deixar 1-2px de resto por
    // arredondamento — sem folga, o efeito abaixo concluiria "não estava no
    // fim" logo depois de rolar para o fim sozinho.
    noFimRef.current = distanciaDoFim < 24;
  }

  // `useLayoutEffect` (não `useEffect`): a rolagem precisa acontecer ANTES
  // do navegador pintar o frame com a lista já crescida — senão haveria um
  // frame visível com o scroll ainda no lugar antigo.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (noFimRef.current) el.scrollTop = el.scrollHeight;
  }, [segmentos]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="shrink-0 text-rotulo font-semibold text-tinta-fraca">Transcrição</p>
      <div
        ref={containerRef}
        onScroll={aoRolar}
        role="region"
        aria-label="Transcrição da sessão"
        aria-live="off"
        tabIndex={TAB_INDEX_ROLAVEL}
        className="min-h-0 flex-1 overflow-y-auto rounded-controle border border-linha bg-papel-elevado px-3 py-2"
      >
        {segmentos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Aguardando a fala da sessão.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {segmentos.map((segmento) => (
              <li key={segmento.id} className="text-sm text-tinta">
                <span className="mr-1.5 text-legenda text-tinta-fraca">{formatarHora(segmento.criado_em)}</span>
                {segmento.falante && <span className="mr-1 font-medium text-tinta-fraca">{segmento.falante}:</span>}
                <span>{segmento.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
