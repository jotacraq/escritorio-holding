"use client";

import { useTema } from "@/hooks/useTema";
import { useCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { AnaliseSessaoPainel } from "@/components/croqui/AnaliseSessaoPainel";
import type { EventoTimeline, Ficha360 } from "@/lib/api";

/**
 * Aba de topo "Análise da Sessão", no grupo "Sessão" (U3/U4,
 * ARQUITETURA-FASE-3.md §5.3). Antes era sub-aba de `CroquiAba` — a dívida
 * documentada pedia exatamente este movimento quando `page.tsx` fosse tocado
 * de novo. Consome o mesmo estado que `CroquiAba` via `useCroquiDaJornada`
 * (não duplica `useRecurso`). O link "Ver no Editor do Croqui" para `#croqui`
 * vive dentro do próprio `AnaliseSessaoPainel`, condicionado a ter aplicado
 * a análise ao croqui — o componente `Abas` já reage a `hashchange`
 * (`Abas.tsx:71-80`).
 */
export function AnaliseSessaoAba({ jornadaId, ficha, timeline }: { jornadaId: string; ficha: Ficha360; timeline: EventoTimeline[] }) {
  const { tema } = useTema();
  const { sessaoId, dadosGraficos, ultimaAnaliseSalva, aoAnaliseGerada, aoAplicarAoCroqui } = useCroquiDaJornada({ jornadaId, ficha, timeline });

  return (
    <AnaliseSessaoPainel
      jornadaId={jornadaId}
      sessaoId={sessaoId}
      briefingAtualId={ficha.briefingAtual?.id ?? null}
      ultimaAnaliseSalva={ultimaAnaliseSalva}
      dadosGraficos={dadosGraficos}
      tema={tema}
      aoAnaliseGerada={aoAnaliseGerada}
      aoAplicarAoCroqui={aoAplicarAoCroqui}
    />
  );
}
