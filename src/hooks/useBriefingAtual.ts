"use client";

import { useCallback } from "react";
import { buscarBriefing } from "@/lib/api";
import { useRecurso } from "./useRecurso";

/**
 * Busca o Briefing completo atual da jornada UMA vez e distribui por prop —
 * antes, `CabecalhoFicha.tsx` (faixa vital: DISC/objeção) e `BriefingAba.tsx`
 * (conteúdo completo) buscavam o MESMO `briefingAtual.id` cada um por conta
 * própria (Tarefa 5, coalescer buscas duplicadas — medido antes/depois no
 * relatório da mudança).
 */
export function useBriefingAtual(briefingAtualId: string | null) {
  const buscar = useCallback(() => (briefingAtualId ? buscarBriefing(briefingAtualId) : Promise.resolve(null)), [briefingAtualId]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [briefingAtualId]);
  return { briefing: dados ?? null, carregando, erro, recarregar, setBriefing: setDados };
}
