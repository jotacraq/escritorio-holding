import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `iniciarSessaoImediata` — miolo de "Iniciar sessão agora" (17/09/2026,
 * Fatia 1), reusado por `POST /api/jornadas/[id]/agendamentos` (`modo:
 * "imediato"`) e por `POST /api/jornadas/[id]/sessao/iniciar`.
 *
 * 🔴 Prova o achado que motivou a fatia: chamar duas vezes seguidas para a
 * MESMA sessão NÃO cria dois `agendamentos` — a segunda chamada encontra o
 * agendamento vivo agora e devolve `reaproveitado: true`, sem INSERT.
 */

const lerConfiguracaoIntMock = vi.fn();
vi.mock("./config", () => ({
  CHAVE_DURACAO_PADRAO_MINUTOS: "agenda.duracao_padrao_minutos",
  lerConfiguracaoInt: (...a: unknown[]) => lerConfiguracaoIntMock(...a),
}));

const { iniciarSessaoImediata, SQLSTATE_EXCLUSION_VIOLATION } = await import("./iniciar-sessao");

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    in: encadeavel,
    lte: encadeavel,
    gt: encadeavel,
    insert: encadeavel,
    maybeSingle: terminal,
    single: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const SESSAO_EXISTENTE = { id: "sessao-1", jornada_id: "j1", advogada_id: null, link_sala: null };
const AGENDAMENTO_VIVO = { id: "ag-1", sessao_id: "sessao-1", status: "agendado", inicio_em: "2026-09-17T12:00:00Z", fim_em: "2026-09-17T13:00:00Z" };

afterEach(() => {
  lerConfiguracaoIntMock.mockReset();
});

describe("iniciarSessaoImediata", () => {
  it("sessão já existe, SEM agendamento vivo agora → cria sessão? não; cria agendamento novo (reaproveitado=false)", async () => {
    lerConfiguracaoIntMock.mockResolvedValue(60);
    const supabase = {
      from: vi.fn((tabela: string) => {
        if (tabela === "sessoes_viabilidade") return consultaEncadeavel({ data: SESSAO_EXISTENTE, error: null });
        if (tabela === "agendamentos") {
          // 1ª chamada: busca de vivo agora (nenhum); 2ª chamada: INSERT.
          const chamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "agendamentos").length;
          if (chamadas === 1) return consultaEncadeavel({ data: null, error: null });
          return consultaEncadeavel({ data: { ...AGENDAMENTO_VIVO, id: "ag-novo" }, error: null });
        }
        throw new Error(`tabela não mockada: ${tabela}`);
      }),
    } as unknown as SupabaseClient;

    const resultado = await iniciarSessaoImediata(supabase, { jornadaId: "j1" });

    expect(resultado.reaproveitado).toBe(false);
    expect(resultado.agendamento.id).toBe("ag-novo");
    expect(resultado.sessao.id).toBe("sessao-1");
  });

  it("chamar DUAS VEZES seguidas para a mesma sessão: 2ª chamada acha o agendamento vivo agora e devolve reaproveitado=true, SEM inserir de novo", async () => {
    lerConfiguracaoIntMock.mockResolvedValue(60);
    const insertSpy = vi.fn();
    const supabase = {
      from: vi.fn((tabela: string) => {
        if (tabela === "sessoes_viabilidade") return consultaEncadeavel({ data: SESSAO_EXISTENTE, error: null });
        if (tabela === "agendamentos") {
          // Simula o estado do banco DEPOIS da 1ª chamada: já existe um
          // agendamento vivo agora — a rota nunca deveria tentar inserir.
          const builder = consultaEncadeavel({ data: AGENDAMENTO_VIVO, error: null });
          builder.insert = (...args: unknown[]) => {
            insertSpy(...args);
            return builder;
          };
          return builder;
        }
        throw new Error(`tabela não mockada: ${tabela}`);
      }),
    } as unknown as SupabaseClient;

    const resultado = await iniciarSessaoImediata(supabase, { jornadaId: "j1" });

    expect(resultado.reaproveitado).toBe(true);
    expect(resultado.agendamento.id).toBe("ag-1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("jornada sem sessão ainda: cria sessoes_viabilidade, depois segue o fluxo normal (sem vivo agora → insere)", async () => {
    lerConfiguracaoIntMock.mockResolvedValue(60);
    const supabase = {
      from: vi.fn((tabela: string) => {
        if (tabela === "sessoes_viabilidade") {
          const chamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "sessoes_viabilidade").length;
          if (chamadas === 1) return consultaEncadeavel({ data: null, error: null }); // SELECT: não existe
          return consultaEncadeavel({ data: SESSAO_EXISTENTE, error: null }); // INSERT: criada
        }
        if (tabela === "agendamentos") {
          const chamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "agendamentos").length;
          if (chamadas === 1) return consultaEncadeavel({ data: null, error: null });
          return consultaEncadeavel({ data: AGENDAMENTO_VIVO, error: null });
        }
        throw new Error(`tabela não mockada: ${tabela}`);
      }),
    } as unknown as SupabaseClient;

    const resultado = await iniciarSessaoImediata(supabase, { jornadaId: "j1" });

    expect(resultado.sessao.id).toBe("sessao-1");
    expect(resultado.reaproveitado).toBe(false);
  });

  it("EXCLUDE constraint (23P01) no INSERT propaga o erro com o código, para a rota traduzir", async () => {
    lerConfiguracaoIntMock.mockResolvedValue(60);
    const supabase = {
      from: vi.fn((tabela: string) => {
        if (tabela === "sessoes_viabilidade") return consultaEncadeavel({ data: SESSAO_EXISTENTE, error: null });
        if (tabela === "agendamentos") {
          const chamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "agendamentos").length;
          if (chamadas === 1) return consultaEncadeavel({ data: null, error: null });
          return consultaEncadeavel({ data: null, error: { code: SQLSTATE_EXCLUSION_VIOLATION, message: "conflito" } });
        }
        throw new Error(`tabela não mockada: ${tabela}`);
      }),
    } as unknown as SupabaseClient;

    await expect(iniciarSessaoImediata(supabase, { jornadaId: "j1" })).rejects.toMatchObject({ code: SQLSTATE_EXCLUSION_VIOLATION });
  });
});
