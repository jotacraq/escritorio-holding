import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `montarEstadoCopiloto` — Fase 10, Fatias 1 e 4 (§5, §8, §12 do plano).
 * Achado do coordenador na revisão: "`compararComDecisores` não tem
 * chamador... a 4c está escrita e inerte". Este arquivo prova que a query
 * COALESCIDA de sempre (1 select principal + 1 de consentimento, contrato
 * da Fatia 1 inalterado) agora também resolve `bot`/`comparacao_decisores`
 * — SEM select adicional de `briefings` (aceite: "nenhuma leitura extra por
 * ciclo").
 */

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    maybeSingle: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const ROTEIRO_VAZIO = { definicao: { blocos: [] } };

function montarSupabase(sessaoData: unknown, selectSpy?: ReturnType<typeof vi.fn>) {
  const from = vi.fn((tabela: string) => {
    if (tabela === "sessoes_viabilidade") {
      if (selectSpy) {
        const builder = consultaEncadeavel({ data: sessaoData, error: null }) as Record<string, unknown>;
        const selectOriginal = builder.select as (...a: unknown[]) => unknown;
        builder.select = (...args: unknown[]) => {
          selectSpy(...args);
          return selectOriginal(...args);
        };
        return builder;
      }
      return consultaEncadeavel({ data: sessaoData, error: null });
    }
    if (tabela === "consentimentos") {
      return consultaEncadeavel({ data: null, error: null });
    }
    throw new Error(`tabela não mockada: ${tabela}`);
  });
  return { from } as unknown as SupabaseClient;
}

function sessaoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "sessao-1",
    roteiro_versao_id: null,
    sims: {},
    jornadas: { pessoa_id: "pessoa-1", briefings: [] },
    roteiros_versoes: ROTEIRO_VAZIO,
    sessoes_copiloto: null,
    ...overrides,
  };
}

const { montarEstadoCopiloto } = await import("./estado");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("montarEstadoCopiloto — bot (Fatia 4)", () => {
  it("sem sessoes_copiloto (nunca digitou nem pediu bot): bot é null, não um objeto com estado inventado", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.bot).toBeNull();
  });

  it("com sessoes_copiloto: bot reflete o estado persistido, erro_provedor/retencao vêm vazios (sem coluna para persistir ainda)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ sessoes_copiloto: { estado: "ativo", gravacao_externa_id: "bot_123", participantes: [] } }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.bot).toEqual({ estado: "ativo", erro_provedor: null, retencao_infinita_detectada: false });
  });
});

describe("montarEstadoCopiloto — comparacao_decisores (Fatia 4, §5, camada 1)", () => {
  it("🔴 sem participantes presentes: comparacao_decisores é null, NÃO um objeto com arrays vazios", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha", "Cleison"] } } }],
        },
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: "bot_123", participantes: [] },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.comparacao_decisores).toBeNull();
  });

  it("sem processo_decisorio.decisores no briefing: comparacao_decisores é null", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: { pessoa_id: "pessoa-1", briefings: [{ atual: true, conteudo: {} }] },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.comparacao_decisores).toBeNull();
  });

  it("sem briefing nenhum (jornada nova): comparacao_decisores é null, nunca lança", async () => {
    const supabase = montarSupabase(sessaoBase({ jornadas: { pessoa_id: "pessoa-1", briefings: [] } }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.comparacao_decisores).toBeNull();
  });

  it("caso do plano (§5): 2 decisores esperados, só 1 presente — Cleison em ausentes, NUNCA em ambiguos", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha", "Cleison"] } } }],
        },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(resultado.comparacao_decisores).not.toBeNull();
    expect(resultado.comparacao_decisores!.ausentes).toEqual(["Cleison"]);
    expect(resultado.comparacao_decisores!.ambiguos).toEqual([]);
    expect(resultado.comparacao_decisores!.presentes).toEqual([{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }]);
  });

  // 🔴 Aceite explícito do coordenador: "ambiguos não vira ausentes".
  it("nome do decisor casa com DOIS participantes presentes: entra em ambiguos, NUNCA em ausentes nem em presentes", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["João Silva"] } } }],
        },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [
            { nome: "João Silva", entrou_em: "10:00", saiu_em: null },
            { nome: "joão silva", entrou_em: "10:01", saiu_em: null },
          ],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(resultado.comparacao_decisores).not.toBeNull();
    expect(resultado.comparacao_decisores!.ambiguos).toEqual(["João Silva"]);
    expect(resultado.comparacao_decisores!.ausentes).toEqual([]);
    expect(resultado.comparacao_decisores!.presentes).toEqual([]);
  });

  it("briefing atual escolhido corretamente mesmo com histórico de versões antigas no embed", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [
            { atual: false, conteudo: { processo_decisorio: { decisores: ["Nome Antigo"] } } },
            { atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha"] } } },
          ],
        },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.comparacao_decisores!.decisores_esperados).toEqual(["Terezinha"]);
  });
});

describe("montarEstadoCopiloto — zero leitura extra por ciclo (aceite explícito)", () => {
  it("select() de sessoes_viabilidade é chamado 1 VEZ só, com jornadas(...briefings(...)) já embutido — não há 2ª ida ao banco por briefing", async () => {
    const selectSpy = vi.fn();
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha"] } } }],
        },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }],
        },
      }),
      selectSpy,
    );

    await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(selectSpy).toHaveBeenCalledTimes(1);
    const colunasSelecionadas = selectSpy.mock.calls[0][0] as string;
    expect(colunasSelecionadas).toContain("briefings");
    expect(colunasSelecionadas).toContain("participantes");
  });

  it("nenhuma chamada a supabase.from('briefings') acontece — a leitura é só via embed de sessoes_viabilidade", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        jornadas: {
          pessoa_id: "pessoa-1",
          briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha"] } } }],
        },
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: "bot_123",
          participantes: [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }],
        },
      }),
    );

    await montarEstadoCopiloto(supabase, "sessao-1", 0);

    // `from` só é chamado para 'sessoes_viabilidade' e 'consentimentos' —
    // se algum código chamasse `.from('briefings')` separadamente, o mock
    // lançaria "tabela não mockada: briefings" e este teste falharia.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "sessoes_viabilidade",
      "consentimentos",
    ]);
  });
});

describe("montarEstadoCopiloto — expurgo_segmentos_em (Fatia 5, B69/B19)", () => {
  it("sem sessoes_copiloto (nunca digitou nem pediu bot): expurgo_segmentos_em é null, não inventado", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.expurgo_segmentos_em).toBeNull();
  });

  it("sessoes_copiloto existe mas nunca foi expurgada: expurgo_segmentos_em é null (default de fábrica)", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "encerrado", gravacao_externa_id: null, participantes: [], expurgo_segmentos_em: null },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.expurgo_segmentos_em).toBeNull();
  });

  it("sessão com segmentos expurgados: o campo REFLETE o carimbo persistido, sem transformação", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "encerrado",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: "2026-09-20T03:00:00.000Z",
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.expurgo_segmentos_em).toBe("2026-09-20T03:00:00.000Z");
  });

  it("🔴 mesma query coalescida de sempre — nenhum select adicional só para ler o carimbo de expurgo", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "encerrado",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: "2026-09-20T03:00:00.000Z",
        },
      }),
    );
    await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "sessoes_viabilidade",
      "consentimentos",
    ]);
  });
});
