"use client";

import { useCallback, useEffect, useState } from "react";
import { buscarEtapasOrdem, listarEquipe, listarJornadas, type FiltrosJornadas, type JornadaKanban, type MembroEquipe } from "@/lib/api";
import { useRecurso } from "./useRecurso";

export function useEtapasOrdem() {
  const buscar = useCallback(() => buscarEtapasOrdem().then((dados) => dados ?? []), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  return { etapas: dados ?? null, carregando, erro, recarregar };
}

export function useEquipe() {
  const [equipe, setEquipe] = useState<MembroEquipe[] | null>(null);
  useEffect(() => {
    listarEquipe().then((dados) => setEquipe(dados?.itens ?? []));
  }, []);
  return equipe;
}

export function useJornadas(filtros: FiltrosJornadas) {
  const chaveFiltros = JSON.stringify(filtros);
  const buscar = useCallback(() => listarJornadas(JSON.parse(chaveFiltros)), [chaveFiltros]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [chaveFiltros]);

  const setItens = useCallback(
    (atualizador: (atual: JornadaKanban[]) => JornadaKanban[]) => {
      setDados((atual) => (atual ? { ...atual, itens: atualizador(atual.itens) } : atual));
    },
    [setDados],
  );

  return { itens: dados?.itens ?? [], total: dados?.total ?? 0, carregando, erro, recarregar, setItens };
}
