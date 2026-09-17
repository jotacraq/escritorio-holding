// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealceUmaVez } from "./useRealceUmaVez";

/**
 * Fable, 17/09 — prova o CONTRATO do hook isolado (usado por `CardPlacar`,
 * `CardRecente` e `ItemAindaNaoPerguntou` em `PainelCopiloto.tsx`,
 * `TurnoTranscricao` em `PainelTranscricao.tsx` — coberto lá — e
 * `PontoStatusBot`/o pulso do contador em `ConduzirSessaoApp.tsx`/
 * `PainelCopiloto.tsx`, ambos com `duracaoMs=320`).
 *
 * 🔴 CONTRAPROVA obrigatória (pedido do Fable): revertendo o hook para o
 * antigo `requestAnimationFrame` de 1 frame, o teste
 * "permanece true além de um frame" abaixo CAI — é a prova de que este
 * arquivo prende o comportamento real (persistência pela duração), não o
 * falso-verde que o `rAF` produzia em jsdom (que nunca dispara antes de uma
 * asserção síncrona).
 */
describe("useRealceUmaVez", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("liga ao montar com ativo=true e permanece true além de um frame (16ms) — não é um toggle de 1 frame", () => {
    const { result } = renderHook(() => useRealceUmaVez(true, "chave-1", 5000));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(result.current).toBe(true);
  });

  it("desliga sozinho exatamente depois da duração informada", () => {
    const { result } = renderHook(() => useRealceUmaVez(true, "chave-1", 320));

    act(() => {
      vi.advanceTimersByTime(319);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("nova chave reacende; mesma chave (re-render) não repete", () => {
    const { result, rerender } = renderHook(({ chave }) => useRealceUmaVez(true, chave, 5000), {
      initialProps: { chave: "a" },
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(result.current).toBe(false);

    // Mesma chave — não reacende.
    rerender({ chave: "a" });
    expect(result.current).toBe(false);

    // Chave nova — reacende.
    rerender({ chave: "b" });
    expect(result.current).toBe(true);
  });

  it("ativo=false nunca liga", () => {
    const { result } = renderHook(() => useRealceUmaVez(false, "chave-1", 5000));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(result.current).toBe(false);
  });
});
