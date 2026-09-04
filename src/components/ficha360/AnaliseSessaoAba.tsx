"use client";

import { useTema } from "@/hooks/useTema";
import type { EstadoCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { AnaliseSessaoPainel } from "@/components/croqui/AnaliseSessaoPainel";
import type { Ficha360 } from "@/lib/api";

/**
 * Aba de topo "Análise da Sessão", no grupo "Sessão" (U3/U4,
 * ARQUITETURA-FASE-3.md §5.3). Antes era sub-aba de `CroquiAba` — a dívida
 * documentada pedia exatamente este movimento quando `page.tsx` fosse tocado
 * de novo. Consome o mesmo estado que `CroquiAba`, agora recebido por prop
 * (mesma cirurgia de `BriefingAba`): o pai chama `useCroquiDaJornada` UMA vez
 * e compartilha, em vez de cada aba buscar o croqui por conta própria. O
 * link "Ver no Editor do Croqui" para `#croqui` vive dentro do próprio
 * `AnaliseSessaoPainel`, condicionado a ter aplicado a análise ao croqui — o
 * componente `Abas` já reage a `hashchange` (`Abas.tsx:71-80`).
 */
export function AnaliseSessaoAba({ jornadaId, ficha, estadoCroqui }: { jornadaId: string; ficha: Ficha360; estadoCroqui: EstadoCroquiDaJornada }) {
  const { tema } = useTema();
  const { sessaoId, dadosGraficos, ultimaAnaliseSalva, aoAnaliseGerada, aoAplicarAoCroqui } = estadoCroqui;

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
