import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `dispararWarmupCopiloto` (0099) — orquestração testada com os módulos que
 * chama MOCKADOS (cada um já tem teste próprio: gate.test.ts,
 * orcamento.test.ts, executar-ia.test.ts). O que ESTE arquivo prova:
 *   1. Interruptor (`warmup_ativo=false`) barra ANTES da claim.
 *   2. Claim (`count=0`, já aqueceu/corrida perdida) barra ANTES do gate.
 *   3. Gate fechado barra ANTES do orçamento — mesma ordem do ciclo real.
 *   4. Orçamento estourado barra ANTES de montar contexto/chamar IA.
 *   5. Sucesso: chama IA, resultado é DESCARTADO — nunca grava
 *      `copiloto_sugestoes` (nem sequer importa o módulo que grava).
 *   6. Nunca lança — qualquer exceção interna vira `registrarErro`, a
 *      Promise sempre resolve.
 */

const warmupAtivoMock = vi.fn();
const conferirGateMock = vi.fn();
const conferirOrcamentoMock = vi.fn();
const montarContextoMock = vi.fn();
const executarIaMock = vi.fn();
const registrarErroMock = vi.fn();

vi.mock("@/server/ia/configuracao", () => ({ lerConfiguracaoBool: (...a: unknown[]) => warmupAtivoMock(...a) }));
vi.mock("./gate", () => ({ conferirGateCopiloto: (...a: unknown[]) => conferirGateMock(...a) }));
vi.mock("./orcamento", () => ({ conferirOrcamentoCopiloto: (...a: unknown[]) => conferirOrcamentoMock(...a) }));
vi.mock("./contexto", () => ({ montarContextoCopiloto: (...a: unknown[]) => montarContextoMock(...a) }));
vi.mock("./executar-ia", () => ({ executarIaCopiloto: (...a: unknown[]) => executarIaMock(...a) }));
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const { dispararWarmupCopiloto } = await import("./warmup");

afterEach(() => {
  vi.clearAllMocks();
});

const PARAMS = {
  sessaoId: "sessao-1",
  jornadaId: "jornada-1",
  pessoaId: "pessoa-1",
  inicioSessaoIso: "2026-09-14T13:00:00.000Z",
};

interface ResultadoClaim {
  error?: { message?: string } | null;
  count?: number | null;
}

function adminComClaim(resultadoClaim: ResultadoClaim) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    update: () => builder,
    eq: () => builder,
    is: () => builder,
    then: (ok: (v: unknown) => unknown) =>
      Promise.resolve({ error: resultadoClaim.error ?? null, count: resultadoClaim.count ?? 0 }).then(ok),
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("dispararWarmupCopiloto — ordem e efeito de cada trava", () => {
  it("warmup_ativo=false: NÃO tenta a claim, ZERO chamada de gate/orçamento/IA", async () => {
    warmupAtivoMock.mockResolvedValue(false);
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(conferirGateMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("claim PERDIDA (count=0 — já aqueceu ou outra aba ganhou): NÃO chama gate/orçamento/IA", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    const admin = adminComClaim({ count: 0 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(conferirGateMock).not.toHaveBeenCalled();
    expect(conferirOrcamentoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("claim GANHA (count=1) mas GATE fechado: NÃO confere orçamento, NÃO chama IA", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    conferirGateMock.mockResolvedValue({ liberado: false, motivo: "sem_consentimento_titular" });
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(conferirGateMock).toHaveBeenCalledWith(admin, { sessaoId: "sessao-1", pessoaId: "pessoa-1" });
    expect(conferirOrcamentoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("gate liberado mas ORÇAMENTO estourado: NÃO chama IA", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: false, naSessao: 30, noDia: 10, motivo: "teto_ia_sessao" });
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(conferirOrcamentoMock).toHaveBeenCalledWith(admin, {
      jornadaId: "jornada-1",
      inicioSessaoIso: "2026-09-14T13:00:00.000Z",
    });
    expect(montarContextoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("todas as travas passam: monta contexto e chama a IA — resultado é DESCARTADO (função não retorna nada usável como sugestão)", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 0, noDia: 0, motivo: null });
    const contextoFalso = { roteiro_fonte: "carimbado", bloco_atual: null };
    montarContextoMock.mockResolvedValue({ contexto: contextoFalso, camposBlocoAtual: [] });
    executarIaMock.mockResolvedValue({ situacao: "ok", saida: {}, execucaoId: "exec-1", custoUsd: 0.013 });
    const admin = adminComClaim({ count: 1 });

    const resultado = await dispararWarmupCopiloto(admin, PARAMS);

    expect(montarContextoMock).toHaveBeenCalledWith(admin, "sessao-1", 0);
    expect(executarIaMock).toHaveBeenCalledWith(admin, {
      jornadaId: "jornada-1",
      contexto: contextoFalso,
      abortarNoTimeout: false,
    });
    expect(resultado).toBeUndefined(); // nunca devolve a sugestão — a rota não tem como expor por engano
  });

  it("🔴🔴 O WARM-UP NÃO ABORTA (Fase 11): chama executarIaCopiloto com abortarNoTimeout=false — sem isso o cache do provedor nunca é escrito (warmup.ts:145-151), e o sintoma só aparece semanas depois", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 0, noDia: 0, motivo: null });
    montarContextoMock.mockResolvedValue({ contexto: {}, camposBlocoAtual: [] });
    executarIaMock.mockResolvedValue({ situacao: "timeout" });
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(executarIaMock).toHaveBeenCalledTimes(1);
    const paramsPassados = executarIaMock.mock.calls[0]?.[1] as { abortarNoTimeout?: boolean };
    expect(paramsPassados.abortarNoTimeout).toBe(false);
  });

  it("IA estoura timeout: mesmo tratamento de sucesso — descarta, não lança, não registra erro", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 0, noDia: 0, motivo: null });
    montarContextoMock.mockResolvedValue({ contexto: {}, camposBlocoAtual: [] });
    executarIaMock.mockResolvedValue({ situacao: "timeout" });
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(registrarErroMock).not.toHaveBeenCalled();
  });

  it("🔴 exceção inesperada em qualquer etapa: NUNCA lança — vira registrarErro, a Promise resolve", async () => {
    warmupAtivoMock.mockResolvedValue(true);
    const adminQueLanca = {
      from: () => {
        throw new Error("falha de rede simulada");
      },
    } as unknown as SupabaseClient;

    await expect(dispararWarmupCopiloto(adminQueLanca, PARAMS)).resolves.toBeUndefined();
    expect(registrarErroMock).toHaveBeenCalledTimes(1);
    expect(registrarErroMock).toHaveBeenCalledWith(
      "copiloto/warmup.dispararWarmupCopiloto",
      expect.any(Error),
      { sessao_id: "sessao-1" },
    );
  });

  it("falha de leitura do interruptor: cai no padrão TRUE (nasce ligado) — não bloqueia por 'não saber'", async () => {
    warmupAtivoMock.mockRejectedValue(new Error("timeout de leitura"));
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 0, noDia: 0, motivo: null });
    montarContextoMock.mockResolvedValue({ contexto: {}, camposBlocoAtual: [] });
    executarIaMock.mockResolvedValue({ situacao: "ok", saida: {}, execucaoId: "e", custoUsd: null });
    const admin = adminComClaim({ count: 1 });

    await dispararWarmupCopiloto(admin, PARAMS);

    expect(executarIaMock).toHaveBeenCalledTimes(1);
  });
});
