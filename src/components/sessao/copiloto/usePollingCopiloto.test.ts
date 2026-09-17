// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoCopilotoComPolling, SegmentoCopiloto } from "@/types/copiloto";

/**
 * F3 — 🔴 achado do Fable (17/09): `usePollingCopiloto.ts` pedia
 * `resposta.segmentos_novos` a cada ciclo e NUNCA guardava em estado nenhum
 * — nenhum componente renderizava a transcrição, ~1.800 objetos por sessão
 * de 90min eram banda paga e descartada. Este arquivo trava:
 *
 *  1. `segmentos` acumula como `sugestoes` já fazia.
 *  2. Teto de 60 (`TETO_SEGMENTOS_EM_ESTADO`): sessão longa não empilha
 *     milhares de objetos reconciliados a cada tick (medido: 2.058 segmentos
 *     numa sessão real).
 *  3. Resposta vazia (`segmentos_novos: []`) não substitui a lista por uma
 *     vazia — mesma regra de `sugestoes`.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    respostas: [] as EstadoCopilotoComPolling[],
  },
}));

vi.mock("@/components/sessao/api", async () => {
  const real = await vi.importActual<typeof import("@/components/sessao/api")>("@/components/sessao/api");
  return {
    ...real,
    buscarPollingCopiloto: (_sessaoId: string, parametros: { desdeSegmento: number; desdeSugestao: number }) => {
      const proxima = estado.respostas.shift();
      if (proxima) return Promise.resolve(proxima);
      return Promise.resolve(RESPOSTA_VAZIA(parametros));
    },
  };
});

const { usePollingCopiloto } = await import("./usePollingCopiloto");

function RESPOSTA_VAZIA(parametros: { desdeSegmento: number; desdeSugestao: number }): EstadoCopilotoComPolling {
  return {
    sessao_id: "s1",
    bloco_atual_id: null,
    falta_no_bloco: { campos: [], observar: [] },
    sims_pendentes: [],
    blocos_nao_percorridos: [],
    estado_copiloto: "aguardando",
    segmentos_novos: [],
    proximo_cursor_segmento: parametros.desdeSegmento,
    sugestoes_novas: [],
    proximo_cursor_sugestao: parametros.desdeSugestao,
    ciclo: { avaliado: true, resultado: null, motivo_bloqueio: null },
    polling: { em_foco_ms: 3000, sem_foco_ms: 10000 },
    bot: null,
    comparacao_decisores: null,
  };
}

function segmentosDe(quantidade: number, offset: number): SegmentoCopiloto[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `seg-${offset + i}`,
    sessao_id: "s1",
    ordem: offset + i,
    falante: null,
    falante_confianca: null,
    texto: `trecho ${offset + i}`,
    iniciado_ms: null,
    origem: "bot" as const,
    criado_em: new Date().toISOString(),
  }));
}

beforeEach(() => {
  estado.respostas = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePollingCopiloto — F3, acumulação de segmentos com teto", () => {
  it("acumula `segmentos_novos` em estado — o bug confirmado era NUNCA guardar nada", async () => {
    estado.respostas = [
      { ...RESPOSTA_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 }), segmentos_novos: segmentosDe(2, 1), proximo_cursor_segmento: 2 },
    ];
    const { result } = renderHook(() => usePollingCopiloto("s1", 0, false));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => expect(result.current.segmentos).toHaveLength(2));
    expect(result.current.segmentos.map((s) => s.texto)).toEqual(["trecho 1", "trecho 2"]);
  });

  it("resposta vazia NÃO apaga os segmentos já acumulados", async () => {
    estado.respostas = [
      { ...RESPOSTA_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 }), segmentos_novos: segmentosDe(1, 1), proximo_cursor_segmento: 1 },
    ];
    const { result } = renderHook(() => usePollingCopiloto("s1", 0, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(result.current.segmentos).toHaveLength(1));

    // Próximo ciclo: resposta vazia (silêncio normal).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.segmentos).toHaveLength(1);
  });

  it("teto de 60: sessão longa nunca acumula mais que os 60 mais recentes", async () => {
    // 4 ciclos de 20 segmentos cada = 80 no total, além do teto.
    estado.respostas = [
      { ...RESPOSTA_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 }), segmentos_novos: segmentosDe(20, 1), proximo_cursor_segmento: 20 },
      { ...RESPOSTA_VAZIA({ desdeSegmento: 20, desdeSugestao: 0 }), segmentos_novos: segmentosDe(20, 21), proximo_cursor_segmento: 40 },
      { ...RESPOSTA_VAZIA({ desdeSegmento: 40, desdeSugestao: 0 }), segmentos_novos: segmentosDe(20, 41), proximo_cursor_segmento: 60 },
      { ...RESPOSTA_VAZIA({ desdeSegmento: 60, desdeSugestao: 0 }), segmentos_novos: segmentosDe(20, 61), proximo_cursor_segmento: 80 },
    ];
    const { result } = renderHook(() => usePollingCopiloto("s1", 0, false));

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    await waitFor(() => expect(result.current.segmentos).toHaveLength(60));
    // Mantém os MAIS RECENTES (últimos 60 de 80 = do 21 ao 80) — nunca os
    // mais antigos, que é o que a advogada perderia se o teto cortasse do
    // jeito errado.
    expect(result.current.segmentos[0].texto).toBe("trecho 21");
    expect(result.current.segmentos[59].texto).toBe("trecho 80");
  });

  it("sessão nova (troca de `sessaoId`) zera os segmentos acumulados", async () => {
    estado.respostas = [
      { ...RESPOSTA_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 }), segmentos_novos: segmentosDe(1, 1), proximo_cursor_segmento: 1 },
    ];
    const { result, rerender } = renderHook(({ sessaoId }) => usePollingCopiloto(sessaoId, 0, false), { initialProps: { sessaoId: "s1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(result.current.segmentos).toHaveLength(1));

    rerender({ sessaoId: "s2" });
    expect(result.current.segmentos).toHaveLength(0);
  });
});
