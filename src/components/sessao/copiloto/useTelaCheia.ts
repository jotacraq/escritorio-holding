"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Fase 12, Fatia C — "tela cheia para acompanhar num segundo monitor durante
 * a reunião" (pedido do Marcio, 16/09). Fullscreen API pura, sem biblioteca:
 *
 *  - `requestFullscreen`/`exitFullscreen` retornam PROMISE e REJEITAM se o
 *    navegador recusar (política de permissão, iframe sem `allow`, gesto do
 *    usuário ausente) — `try/catch` silencioso é o pedido explícito do
 *    plano: falha aqui não pode quebrar a condução da sessão.
 *  - O ESTADO do botão nunca é otimista: ele só muda quando o navegador
 *    CONFIRMA por `fullscreenchange` — é assim que sair pela tecla `Esc`
 *    (que não passa por este hook) também deixa o botão coerente.
 *  - `document.fullscreenElement` é a fonte, lida no próprio listener —
 *    nunca inferida do lado de quem chamou `entrar()`.
 */
export function useTelaCheia() {
  const [ativa, setAtiva] = useState(false);

  useEffect(() => {
    function aoMudar() {
      setAtiva(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  const alternar = useCallback(async (elemento: HTMLElement | null) => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await (elemento ?? document.documentElement).requestFullscreen();
      }
    } catch {
      // Fallback silencioso (pedido do plano) — o navegador recusou (sem
      // gesto do usuário, política bloqueada etc.). `fullscreenchange` não
      // dispara, `ativa` continua refletindo a verdade.
    }
  }, []);

  return { ativa, alternar };
}
