"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Anotação rápida por bloco do roteiro, digitada durante a condução.
 *
 * NÃO existe hoje uma rota de escrita para "resposta livre por bloco de
 * roteiro" (a 0030 só grava `sims` e os campos fixos de `relatorios_sessao`
 * pertencem a outra tela/agente — F-3A). Inventar uma gravação no servidor
 * aqui seria dado fantasma. Em vez disso: guarda no `localStorage` deste
 * navegador, rotulado sem ambiguidade na tela como "não salva no prontuário",
 * para não fingir ser registro oficial. Sobrevive a F5 no meio da sessão.
 */
function chave(sessaoId: string, blocoId: string) {
  return `sic-hf:sessao:${sessaoId}:nota:${blocoId}`;
}

export function useNotaLocal(sessaoId: string, blocoId: string) {
  const [valor, setValor] = useState("");

  useEffect(() => {
    // Leitura de um sistema externo (localStorage) depois de montar — o
    // servidor renderiza "" e o cliente corrige uma vez, sem mismatch de
    // hidratação (mesmo padrão de `hooks/useTema.ts`). Não é fetch.
    let lido = "";
    try {
      lido = window.localStorage.getItem(chave(sessaoId, blocoId)) ?? "";
    } catch {
      lido = "";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValor(lido);
  }, [sessaoId, blocoId]);

  const salvar = useCallback(
    (novoValor: string) => {
      setValor(novoValor);
      try {
        if (novoValor.trim()) {
          window.localStorage.setItem(chave(sessaoId, blocoId), novoValor);
        } else {
          window.localStorage.removeItem(chave(sessaoId, blocoId));
        }
      } catch {
        /* localStorage indisponível (modo privado/quota) — nota some ao recarregar, sem quebrar a tela */
      }
    },
    [sessaoId, blocoId],
  );

  return { valor, salvar };
}
