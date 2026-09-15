import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextoCopiloto } from "@/types/copiloto";

/**
 * Timeout próprio de 8s do copiloto (§4.3 do plano, CONFLITO C3) — a IA
 * global (`IA_TIMEOUT_MS`) é 300s, calibrada para o Briefing; aqui a rota
 * NUNCA pode esperar além de `TIMEOUT_COPILOTO_MS`. `executarComAuditoria` é
 * mockado para nunca resolver dentro do teste — é exatamente o cenário que
 * prova que a corrida (`Promise.race`) funciona sem depender de rede real.
 */

const executarComAuditoriaMock = vi.fn();
vi.mock("@/server/ia/executar", () => ({ executarComAuditoria: (...args: unknown[]) => executarComAuditoriaMock(...args) }));

const { executarIaCopiloto, TIMEOUT_COPILOTO_MS } = await import("./executar-ia");

afterEach(() => {
  executarComAuditoriaMock.mockReset();
  vi.useRealTimers();
});

const contextoVazio: ContextoCopiloto = {
  roteiro_fonte: "nenhum",
  bloco_atual: null,
  bloco_anterior_titulo: null,
  bloco_seguinte_titulo: null,
  briefing_recorte: null,
  estado_factual: {
    sims_registrados: [],
    blocos_percorridos: [],
    campos_pendentes_no_bloco: [],
    decisores_esperados: null,
    decisores_presentes: null,
  },
  janela_transcricao: [],
  resumo_acumulado: {},
  roteiro_ativo_blocos_ids: [],
};

function clienteFalso(): SupabaseClient {
  return {} as SupabaseClient;
}

describe("executarIaCopiloto — timeout de 8s (nunca o IA_TIMEOUT_MS global de 300s)", () => {
  it("estourou 8s sem resposta do provedor → situacao 'timeout', nunca pendura a requisição", async () => {
    vi.useFakeTimers();
    // A chamada real nunca resolve dentro do teste (simula o provedor lento).
    executarComAuditoriaMock.mockReturnValue(new Promise(() => {}));

    const promessa = executarIaCopiloto(clienteFalso(), { jornadaId: "j1", contexto: contextoVazio });
    await vi.advanceTimersByTimeAsync(TIMEOUT_COPILOTO_MS + 1);

    await expect(promessa).resolves.toEqual({ situacao: "timeout" });
  });

  it("🔴 Fase 11: estourou 8s → passa um AbortSignal ABORTADO para executarComAuditoria (a chamada real é interrompida, não só ignorada)", async () => {
    vi.useFakeTimers();
    let signalCapturado: AbortSignal | undefined;
    executarComAuditoriaMock.mockImplementation((_admin: unknown, params: { signal?: AbortSignal }) => {
      signalCapturado = params.signal;
      return new Promise(() => {}); // nunca resolve — simula provedor lento
    });

    const promessa = executarIaCopiloto(clienteFalso(), { jornadaId: "j1", contexto: contextoVazio });
    expect(signalCapturado?.aborted).toBe(false); // ainda não estourou

    await vi.advanceTimersByTimeAsync(TIMEOUT_COPILOTO_MS + 1);
    await promessa;

    expect(signalCapturado?.aborted).toBe(true); // Fase 11: o abort de verdade aconteceu
  });

  it("respondeu ANTES dos 8s → situacao 'ok', com a saída da IA", async () => {
    executarComAuditoriaMock.mockResolvedValue({
      execucaoId: "exec-1",
      saida: { proxima_pergunta: null, falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.8 },
      custoUsd: 0.01,
      promptVersao: 1,
    });

    const resultado = await executarIaCopiloto(clienteFalso(), { jornadaId: "j1", contexto: contextoVazio });
    expect(resultado).toMatchObject({ situacao: "ok", execucaoId: "exec-1" });
  });

  it("🔴🔴 abortarNoTimeout=false (warm-up): estourou 8s → RETORNA 'timeout' mas NÃO passa signal nenhum para executarComAuditoria — a chamada real segue em voo para escrever o cache", async () => {
    vi.useFakeTimers();
    let paramsCapturados: { signal?: AbortSignal } | undefined;
    executarComAuditoriaMock.mockImplementation((_admin: unknown, params: { signal?: AbortSignal }) => {
      paramsCapturados = params;
      return new Promise(() => {}); // nunca resolve — simula provedor lento
    });

    const promessa = executarIaCopiloto(clienteFalso(), {
      jornadaId: "j1",
      contexto: contextoVazio,
      abortarNoTimeout: false,
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_COPILOTO_MS + 1);

    await expect(promessa).resolves.toEqual({ situacao: "timeout" });
    expect(paramsCapturados?.signal).toBeUndefined(); // NUNCA propaga signal — o voo não pode ser abortado
  });

  it("prompt inativo (0094 ativo=false) vira 'indisponivel', NUNCA 'timeout'", async () => {
    executarComAuditoriaMock.mockRejectedValue(new Error("prompt_ativo_nao_encontrado: copiloto_sessao"));

    const resultado = await executarIaCopiloto(clienteFalso(), { jornadaId: "j1", contexto: contextoVazio });
    expect(resultado).toMatchObject({ situacao: "indisponivel" });
    if (resultado.situacao === "indisponivel") {
      expect(resultado.motivo).toContain("prompt_ativo_nao_encontrado");
    }
  });
});
