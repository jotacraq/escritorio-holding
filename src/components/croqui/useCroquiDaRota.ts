"use client";

import { useCallback } from "react";
import { buscarCroquiPorId, type Croqui } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";

/**
 * `/croquis/[croquiId]` é uma rota de CROQUI; o cálculo é por JORNADA
 * (`/api/jornadas/[id]/croqui-calculo`). Este hook faz a ponte com uma leitura
 * só, e as três telas (tabelas, simular, apresentar) compartilham o mesmo
 * caminho — sem duplicar tratamento de 404 em cada página.
 */
export interface CroquiDaRota {
  croqui: Croqui | null;
  jornadaId: string | null;
  carregando: boolean;
  erro: unknown;
  recarregar: () => void;
}

export function useCroquiDaRota(croquiId: string): CroquiDaRota {
  const buscar = useCallback(() => buscarCroquiPorId(croquiId), [croquiId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [croquiId]);
  const croqui = dados?.croqui ?? null;

  return {
    croqui,
    jornadaId: croqui?.jornada_id ?? null,
    carregando,
    erro,
    recarregar,
  };
}
