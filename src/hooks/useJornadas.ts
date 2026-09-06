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
    // `.catch` obrigatório: sem ele, um 500 em `/api/equipe` virava PROMISE
    // REJEITADA SEM DONO — medido na Fase 7 r2 forçando 500 em `**/api/**`:
    // a tela de Clientes mostrava o erro certinho E cuspia
    // `Uncaught (in promise) ApiError` no console (2×, com o remonte do
    // StrictMode). Cair para lista vazia é a verdade da tela: o seletor
    // "Responsável" fica só com "Todos", que é o que se sabe. Mesmo padrão do
    // `opcoesEdicoes` em `KanbanEsteira.tsx:70`.
    listarEquipe()
      .then((dados) => setEquipe(dados?.itens ?? []))
      .catch(() => setEquipe([]));
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
