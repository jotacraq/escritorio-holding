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

/**
 * `not(coluna, "is", null)` aqui PRECISA filtrar de verdade — não um
 * passthrough. Achado do Fable (defeito 1, agravante): um mock que ignora o
 * predicado deu verde para `estado.ts` mesmo na rodada em que o filtro real
 * (`conteudo->bloco_inferido`, sem `->>`) deixava passar o JSON `null`
 * explícito que `validar.ts` grava para o "não sei" honesto da IA. Só
 * suporta o único caminho de coluna usado nesta base
 * (`conteudo->bloco_inferido->>bloco_id`), lendo o valor exatamente como o
 * Postgres leria: `->` entra no objeto (jsonb `null` inclusive), `->>` sai
 * como texto (jsonb `null` vira SQL `NULL`).
 */
function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  let linhaFiltrada = resultado;
  const encadeavel = () => builder;
  const not = (coluna: string, operador: string, valor: unknown) => {
    if (coluna === "conteudo->bloco_inferido->>bloco_id" && operador === "is" && valor === null) {
      const linha = (linhaFiltrada as { data?: { conteudo?: { bloco_inferido?: { bloco_id?: string | null } | null } } } | null)?.data;
      const blocoId = linha?.conteudo?.bloco_inferido?.bloco_id ?? null;
      if (blocoId === null) {
        linhaFiltrada = { data: null, error: (linhaFiltrada as { error?: unknown } | null)?.error ?? null };
      }
      return builder;
    }
    throw new Error(`predicado 'not' não suportado pelo mock: ${coluna} ${operador} ${String(valor)}`);
  };
  const terminal = async () => linhaFiltrada;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    not,
    order: encadeavel,
    limit: encadeavel,
    maybeSingle: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(linhaFiltrada).then(ok),
  });
  return builder;
}

const ROTEIRO_VAZIO = { definicao: { blocos: [] } };

/**
 * `dados.copilotoSugestoes` — Fase 12, Fatia 1 (defeito 1 do Fable): permite
 * simular a leitura de `resolverBlocoAtual` sobre `copiloto_sugestoes`, para
 * provar que o filtro exige a MARCA `conteudo->bloco_inferido` (não basta
 * `bloco_id` não nulo — ver comentário de `estado.ts::resolverBlocoAtual`).
 * `undefined` preserva o comportamento antigo (mock devolve `null`, "sem
 * inferência").
 */
function montarSupabase(
  sessaoData: unknown,
  selectSpy?: ReturnType<typeof vi.fn>,
  dados?: { copilotoSugestoes?: unknown; inferenciaAtiva?: boolean },
) {
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
    // Fase 12, Fatia 1 — `resolverBlocoAtual` (estado.ts) lê
    // `copiloto_sessao.inferencia_bloco_ativa` (configuracoes) e, quando
    // ligada e sem fixação manual, a última inferência em
    // `copiloto_sugestoes`. É a ÚNICA leitura extra que esta fatia
    // acrescenta ao contrato "1 select coalescido + 1 de consentimento"
    // documentado no topo deste arquivo — aceite revisado deliberadamente
    // pelo arquiteto: o custo é 1 leitura pequena (`limit 1` sobre índice já
    // existente), só quando NÃO há fixação manual vigente, para corrigir o
    // defeito-raiz. Mock devolve "sem inferência" por padrão — os testes
    // deste arquivo não dependem de `bloco_atual_resolvido`.
    if (tabela === "configuracoes") {
      // `inferenciaAtiva` só é lida por `lerConfiguracaoBool` — este mock
      // devolve `data: null` sempre (o default do leitor, `true`, é quem
      // decide); passar `inferenciaAtiva: false` aqui não muda o mock (fora
      // do escopo do teste do defeito 1), mantido só para leitura clara do
      // parâmetro caso um teste futuro precise.
      return consultaEncadeavel({ data: null, error: null });
    }
    if (tabela === "copiloto_sugestoes") {
      return consultaEncadeavel({ data: dados?.copilotoSugestoes ?? null, error: null });
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

    // `from` só é chamado para 'sessoes_viabilidade', as 2 leituras da
    // inferência de bloco (Fase 12, Fatia 1: `configuracoes` +
    // `copiloto_sugestoes`, ver comentário de `montarSupabase`) e
    // 'consentimentos' — se algum código chamasse `.from('briefings')`
    // separadamente, o mock lançaria "tabela não mockada: briefings" e este
    // teste falharia.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "sessoes_viabilidade",
      "configuracoes",
      "copiloto_sugestoes",
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

  it("🔴 mesma query coalescida de sempre para o carimbo de expurgo — nenhum select A MAIS além do que a Fatia 1 já acrescenta", async () => {
    // Aceite ORIGINAL desta fatia (Fase 10, Fatia 5): "sessoes_viabilidade" +
    // "consentimentos", sem nada a mais para ler o expurgo. Fase 12, Fatia 1
    // ACRESCENTA deliberadamente 2 chamadas (configuracoes + copiloto_sugestoes)
    // à lista — é o custo aceito da inferência do bloco atual
    // (resolverBlocoAtual), documentado no comentário de `montarSupabase`
    // acima. Este teste prova que o EXPURGO em si não soma nada ALÉM disso —
    // não que a fatia inteira ficou com zero leitura extra (ela não fica, por
    // desenho).
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
      "configuracoes",
      "copiloto_sugestoes",
      "consentimentos",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fase 12, Fatia 1 — DEFEITO 1 do `fable-orchestrator` (reprovação):
// "o botão 'Me ajuda agora' rebobina o ponteiro e carimba como inferência da
// IA". `resolverBlocoAtual` filtrava por `bloco_id is not null`, que casa
// com QUALQUER linha gravada por QUALQUER caminho — inclusive as que vêm de
// `desvio_sugerido`/do índice de contexto (nunca de uma inferência real).
// Estes testes provam o filtro NOVO: exige `conteudo->bloco_inferido` não
// nulo, a MARCA que só existe quando a IA de fato inferiu.
// ---------------------------------------------------------------------------

function roteiroComNBlocos(n: number) {
  return {
    definicao: {
      blocos: Array.from({ length: n }, (_, i) => ({ id: `bloco-${i}`, titulo: `Parte ${i + 1}` })),
    },
  };
}

describe("montarEstadoCopiloto — bloco_atual_resolvido (Fase 12, Fatia 1, defeito 1 do Fable)", () => {
  it("🔴 TESTE DE ACEITE: sessão com inferência gravada no bloco 8 mantém o índice 8 mesmo sem fixação manual (o chamador não manda mais `bloco` cru)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }),
      undefined,
      {
        copilotoSugestoes: {
          bloco_id: "bloco-8",
          conteudo: { bloco_inferido: { bloco_id: "bloco-8", confianca: 0.82, evidencia: "citação real" } },
          criado_em: "2026-09-16T12:00:00.000Z",
        },
      },
    );
    // `indiceBlocoAtual=null, fixacaoManual=null` — mesmo caminho que
    // `POST .../sugestao` agora usa (não recebe mais `bloco` do corpo).
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido).toEqual({
      bloco_id: "bloco-8",
      indice: 8,
      titulo: "Parte 9",
      origem: "inferido",
      confianca: 0.82,
      decidido_em: "2026-09-16T12:00:00.000Z",
      fixacao_expira_em: null,
    });
  });

  it("🔴 AGRAVANTE 1: linha histórica com bloco_id gravado mas SEM bloco_inferido no conteudo (fallback antigo, ou sessão anterior à 0106) NÃO é promovida a 'inferido'", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }),
      undefined,
      {
        // Linha histórica de verdade: chave `bloco_inferido` AUSENTE do
        // jsonb (nunca escrita — sessão anterior à 0106, ou fallback antigo
        // que só gravava `bloco_id` solto). O mock de `not(...)` (acima)
        // aplica o MESMO predicado do Postgres (`->>bloco_id is not null`)
        // sobre este objeto — chave ausente também dá `undefined ?? null`,
        // então esta linha é excluída pelo filtro tal como a real seria.
        copilotoSugestoes: { conteudo: {}, criado_em: "2026-09-16T12:00:00.000Z" },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido).toEqual({
      bloco_id: null,
      indice: null,
      titulo: null,
      origem: "indisponivel",
      confianca: null,
      decidido_em: null,
      fixacao_expira_em: null,
    });
  });

  it("🔴 DEFEITO 1 (Fable, 2ª rodada): linha com `bloco_inferido: null` EXPLÍCITO — o 'não sei' honesto que `validar.ts` grava quando a IA não infere — também NÃO é promovida a 'inferido'; a última inferência REAL anterior continua valendo (aqui simulada como ausência de linha após o filtro, mesmo efeito de `indisponivel` quando não há nenhuma outra linha no histórico)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }),
      undefined,
      {
        // `'{"bloco_inferido": null}'::jsonb -> 'bloco_inferido' is not null`
        // → TRUE no Postgres (é o defeito medido em produção): um filtro que
        // usasse `->` (sem `>`) deixaria esta linha passar. Com `->>`, jsonb
        // `null` vira SQL NULL de verdade e a linha é excluída — igual à
        // linha sem a chave.
        copilotoSugestoes: { conteudo: { bloco_inferido: null }, criado_em: "2026-09-16T12:10:00.000Z" },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido).toEqual({
      bloco_id: null,
      indice: null,
      titulo: null,
      origem: "indisponivel",
      confianca: null,
      decidido_em: null,
      fixacao_expira_em: null,
    });
  });

  it("🔴 AGRAVANTE 2: a confiança exposta é a de `bloco_inferido.confianca`, NUNCA a coluna `confianca` (que é confianca_geral da sugestão inteira)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }),
      undefined,
      {
        copilotoSugestoes: {
          // `confianca_geral` da sugestão (coluna) DIFERENTE da confiança da
          // inferência de bloco (dentro do conteudo) — valores propositalmente
          // distintos para o teste denunciar se algum código voltar a ler a
          // coluna errada.
          confianca: 0.4,
          conteudo: { bloco_inferido: { bloco_id: "bloco-1", confianca: 0.91, evidencia: "citação real" } },
          criado_em: "2026-09-16T12:05:00.000Z",
        },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.confianca).toBe(0.91);
  });

  it("bloco_id inferido que não casa mais com o roteiro ativo (roteiro trocou no meio da sessão) cai para indisponível, nunca um título inventado", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(2) }),
      undefined,
      {
        copilotoSugestoes: {
          conteudo: { bloco_inferido: { bloco_id: "bloco-inexistente", confianca: 0.7, evidencia: "x" } },
          criado_em: "2026-09-16T12:00:00.000Z",
        },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.origem).toBe("indisponivel");
    expect(resultado.bloco_atual_resolvido?.titulo).toBeNull();
  });
});
