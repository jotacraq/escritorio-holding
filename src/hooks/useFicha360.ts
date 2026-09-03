"use client";

import { useCallback } from "react";
import { buscarFicha360 } from "@/lib/api";
import { useRecurso } from "./useRecurso";

export function useFicha360(jornadaId: string) {
  const buscar = useCallback(() => buscarFicha360(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  return { ficha: dados ?? null, carregando, erro, recarregar };
}
