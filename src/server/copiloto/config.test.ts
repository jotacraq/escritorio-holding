import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { copilotoEstaAtivo, lerConfigPollingCopiloto } from "./config";

/**
 * `copiloto_sessao.ativo` (kill-switch, Fatia 1) e `copiloto_sessao.
 * polling_ms` (Fatia 3 — CORREÇÃO de achado do coordenador: a chave existia
 * desde a 0091 com descrição prometendo controlar o polling, mas nenhuma
 * rota a lia; o front hardcodava 3000ms). Mesma regra dura nas duas:
 * ausência/falha de leitura cai no lado SEGURO — desligado para o
 * kill-switch, o default gravado pela 0091 para o polling.
 */

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

function cliente(resultado: Resultado): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    maybeSingle: async () => resultado,
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("copilotoEstaAtivo", () => {
  it("valor true no banco → true", async () => {
    expect(await copilotoEstaAtivo(cliente({ data: { valor: true }, error: null }))).toBe(true);
  });

  it("valor false no banco → false", async () => {
    expect(await copilotoEstaAtivo(cliente({ data: { valor: false }, error: null }))).toBe(false);
  });

  it("chave ausente → false (nunca liga por ausência)", async () => {
    expect(await copilotoEstaAtivo(cliente({ data: null, error: null }))).toBe(false);
  });

  it("erro de leitura → false (nunca liga por falha)", async () => {
    expect(await copilotoEstaAtivo(cliente({ data: null, error: { code: "08006" } }))).toBe(false);
  });
});

describe("lerConfigPollingCopiloto — CORREÇÃO: a chave agora é lida de verdade", () => {
  it("valor gravado no banco IGUAL ao default (3000) → em_foco_ms=3000, sem_foco_ms=10000 (a mesma conta do fallback)", async () => {
    const r = await lerConfigPollingCopiloto(cliente({ data: { valor: 3000 }, error: null }));
    expect(r).toEqual({ em_foco_ms: 3000, sem_foco_ms: 10_000 });
  });

  it("valor customizado no banco (5000) → sem_foco_ms acompanha proporcionalmente — mudar a config MUDA a tela", async () => {
    const r = await lerConfigPollingCopiloto(cliente({ data: { valor: 5000 }, error: null }));
    expect(r).toEqual({ em_foco_ms: 5000, sem_foco_ms: 16_667 });
  });

  it("chave ausente → default 3000/10000 (os mesmos valores que a 0091 grava)", async () => {
    const r = await lerConfigPollingCopiloto(cliente({ data: null, error: null }));
    expect(r).toEqual({ em_foco_ms: 3000, sem_foco_ms: 10_000 });
  });

  it("valor inválido (0 ou negativo) → cai no default, nunca produz polling_ms<=0", async () => {
    const r = await lerConfigPollingCopiloto(cliente({ data: { valor: 0 }, error: null }));
    expect(r).toEqual({ em_foco_ms: 3000, sem_foco_ms: 10_000 });
  });

  it("erro de leitura → default, nunca lança (fail-safe)", async () => {
    const r = await lerConfigPollingCopiloto(cliente({ data: null, error: { code: "08006" } }));
    expect(r).toEqual({ em_foco_ms: 3000, sem_foco_ms: 10_000 });
  });
});
