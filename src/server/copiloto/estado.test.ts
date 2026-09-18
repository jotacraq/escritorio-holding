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
 *
 * `terminal` aqui SEMPRE devolve `{ data: <array> }` (nunca `maybeSingle`) —
 * Fase 12, Fatia 1 (histerese, 0117): `resolverBlocoAtual` passou a ler
 * `.limit(n + 1)` como LISTA (não mais `.limit(1).maybeSingle()`), porque a
 * histerese precisa enxergar várias candidatas de uma vez, não só a última.
 */
function consultaEncadeavelLista(linhas: unknown[]) {
  const builder: Record<string, unknown> = {};
  let filtradas = linhas;
  const encadeavel = () => builder;
  const not = (coluna: string, operador: string, valor: unknown) => {
    if (coluna === "conteudo->bloco_inferido->>bloco_id" && operador === "is" && valor === null) {
      filtradas = filtradas.filter((linha) => {
        const blocoId = (linha as { conteudo?: { bloco_inferido?: { bloco_id?: string | null } | null } })?.conteudo
          ?.bloco_inferido?.bloco_id;
        return (blocoId ?? null) !== null;
      });
      return builder;
    }
    throw new Error(`predicado 'not' não suportado pelo mock: ${coluna} ${operador} ${String(valor)}`);
  };
  let limite = Infinity;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    not,
    order: encadeavel,
    limit: (n: number) => {
      limite = n;
      return builder;
    },
    returns: async () => ({ data: filtradas.slice(0, limite), error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filtradas.slice(0, limite), error: null }).then(ok),
  });
  return builder;
}

/** Mock de `sessoes_viabilidade`/`consentimentos` — devolve sempre a mesma
 * linha, `.maybeSingle()`. */
function consultaEncadeavelUnica(resultado: unknown) {
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

/**
 * `dados.copilotoSugestoes` — Fase 12, Fatia 1 (defeito 1 do Fable, e a
 * correção de histerese da 0117): array de linhas cronológico MAIS RECENTE
 * PRIMEIRO (mesma ordem de `order("ordem_evento", { ascending: false })`).
 * `undefined`/`[]` preserva "sem inferência nenhuma".
 *
 * `dados.configuracoes` sobrescreve os padrões de piso/histerese_n/retrocesso
 * lidos por `lerConfiguracaoJson`/`Int`/`Bool` — chave ausente do mapa cai no
 * default do próprio leitor (mesmo comportamento de produção).
 */
function montarSupabase(
  sessaoData: unknown,
  selectSpy?: ReturnType<typeof vi.fn>,
  dados?: {
    copilotoSugestoes?: unknown[];
    configuracoes?: Record<string, unknown>;
    /** Fallback de roteiro ativo (18/09/2026) — `definicao` da versão ATIVA
     * de `sessao_viabilidade`, lida só quando a sessão não tem roteiro
     * carimbado. `undefined` = nenhuma versão ativa (o padrão desta suíte,
     * que preserva `blocos: []` como antes da correção). */
    roteiroAtivo?: unknown;
  },
) {
  const from = vi.fn((tabela: string) => {
    if (tabela === "sessoes_viabilidade") {
      if (selectSpy) {
        const builder = consultaEncadeavelUnica({ data: sessaoData, error: null }) as Record<string, unknown>;
        const selectOriginal = builder.select as (...a: unknown[]) => unknown;
        builder.select = (...args: unknown[]) => {
          selectSpy(...args);
          return selectOriginal(...args);
        };
        return builder;
      }
      return consultaEncadeavelUnica({ data: sessaoData, error: null });
    }
    if (tabela === "consentimentos") {
      return consultaEncadeavelUnica({ data: null, error: null });
    }
    // Fase 12, Fatia 1 — `resolverBlocoAtual` (estado.ts) lê
    // `copiloto_sessao.inferencia_bloco_ativa` + as 3 chaves de histerese
    // (piso/histerese_n/permite_retrocesso) via `configuracoes`, e quando a
    // inferência está ligada, a série de `copiloto_sugestoes` (últimas
    // `n + 1`). É a leitura extra que esta fatia acrescenta ao contrato "1
    // select coalescido + 1 de consentimento" documentado no topo deste
    // arquivo — aceite revisado deliberadamente pelo arquiteto.
    if (tabela === "configuracoes") {
      const builder: Record<string, unknown> = {};
      let chaveAtual: string | undefined;
      Object.assign(builder, {
        select: () => builder,
        eq: (_coluna: string, valor: string) => {
          chaveAtual = valor;
          return builder;
        },
        maybeSingle: async () => {
          const valor = chaveAtual !== undefined ? dados?.configuracoes?.[chaveAtual] : undefined;
          return valor === undefined ? { data: null, error: null } : { data: { valor }, error: null };
        },
        // Leitura em LOTE (`lerConfiguracoesBool`, 18/09/2026): troca N
        // requisições por uma `in('chave', [...])`. O mock devolve só as
        // chaves que existem em `dados.configuracoes` — as ausentes não vêm
        // na resposta, exatamente como o PostgREST faz, e é por isso que o
        // leitor precisa cair no padrão informado por chave.
        in: (_coluna: string, chaves: string[]) => {
          const linhas = chaves
            .map((chave) => ({ chave, valor: dados?.configuracoes?.[chave] }))
            .filter((l) => l.valor !== undefined);
          return {
            returns: async () => ({ data: linhas, error: null }),
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
          };
        },
      });
      return builder;
    }
    if (tabela === "copiloto_sugestoes") {
      return consultaEncadeavelLista(dados?.copilotoSugestoes ?? []);
    }
    // Fallback de roteiro ativo (18/09/2026): `montarEstadoCopiloto` só chega
    // aqui quando a sessão NÃO tem roteiro carimbado (`roteiro_versao_id`
    // nulo, o estado de toda sessão antes do 1º SIM). Sem `roteiroAtivo` nos
    // dados, devolve vazio — `blocos` continua `[]` e o comportamento dos
    // casos desta suíte é o mesmo de antes da correção.
    if (tabela === "roteiros_versoes") {
      return consultaEncadeavelUnica({ data: dados?.roteiroAtivo ?? null, error: null });
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

    // `from` só é chamado para 'sessoes_viabilidade', as leituras de config
    // (Fase 12, Fatia 1: `configuracoes` ×4 — `inferencia_bloco_ativa` + as 3
    // chaves de histerese da 0117 — mais 1× `configuracoes` do LOTE ÚNICO
    // que resolve bool+json+int (18/09/2026, 3ª rodada, achado do Fable),
    // todas lidas em paralelo pelo MESMO `Promise.all`), `copiloto_sugestoes`
    // e 'consentimentos' — se algum código chamasse `.from('briefings')`
    // separadamente, o mock lançaria "tabela não mockada: briefings" e este
    // teste falharia.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "sessoes_viabilidade",
      // Fallback de roteiro ativo (18/09/2026): esta sessão mockada não tem
      // `roteiro_versao_id` carimbado (estado de toda sessão antes do 1º
      // SIM), então `montarEstadoCopiloto` busca a versão ATIVA. Medido em
      // produção: Index Scan em `uniq_roteiro_ativo`, 0,074 ms / 2 buffers,
      // e some assim que o 1º SIM carimba a FK. Sessão COM roteiro carimbado
      // não faz esta chamada — ver o teste dedicado abaixo.
      "roteiros_versoes",
      // 5 `configuracoes` no total (correção da 3ª rodada, achado do Fable:
      // a 2ª rodada tinha deixado 7, 2 A MAIS que o HEAD anterior). As 4
      // leituras de `resolverBlocoAtual` (histerese, unitárias) + 1 ÚNICA
      // chamada de `lerConfiguracoesEmLote` — que resolve as 5 flags
      // booleanas (inclui `rodape_transcricao`/`realce_insight_novo`),
      // `ficha_teto_fixos` (json) e as 2 chaves de silêncio (int) na MESMA
      // `select ... in(...)` — TODAS no MESMO `Promise.all`, nenhuma
      // sequencial em relação às outras. Se este teste subir para 6+
      // `configuracoes`, alguma leitura saiu do lote único.
      "configuracoes",
      "configuracoes",
      "configuracoes",
      "configuracoes",
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
    // "consentimentos", sem nada a mais para ler o expurgo. Fase 12
    // ACRESCENTA deliberadamente 5 chamadas (4× configuracoes da histerese —
    // interruptor de inferência + 3 da 0117 — + 1× o LOTE ÚNICO que resolve
    // os kill-switches de inventário/memória/ficha/rodapé/realce/silêncio,
    // 18/09/2026, 3ª rodada, achado do Fable — + copiloto_sugestoes) à
    // lista — é o custo aceito da inferência do bloco atual + do inventário
    // + da memória no painel
    // (resolverBlocoAtual/montarInventarioParaPainel/`falta_no_bloco.campos`),
    // documentado no comentário de `montarSupabase` acima. Este teste prova
    // que o EXPURGO em si não soma nada ALÉM disso — não que a fatia inteira
    // ficou com zero leitura extra (ela não fica, por desenho).
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
      // Fallback de roteiro ativo (18/09/2026): esta sessão mockada não tem
      // `roteiro_versao_id` carimbado (estado de toda sessão antes do 1º
      // SIM), então `montarEstadoCopiloto` busca a versão ATIVA. Medido em
      // produção: Index Scan em `uniq_roteiro_ativo`, 0,074 ms / 2 buffers,
      // e some assim que o 1º SIM carimba a FK. Sessão COM roteiro carimbado
      // não faz esta chamada — ver o teste dedicado abaixo.
      "roteiros_versoes",
      // 5 `configuracoes` no total (correção da 3ª rodada, achado do Fable).
      // As 4 leituras de `resolverBlocoAtual` (histerese, unitárias) + 1
      // ÚNICA chamada de `lerConfiguracoesEmLote` (bool + json + int juntos)
      // — TODAS no MESMO `Promise.all`, nenhuma sequencial em relação às
      // outras. Se este teste subir para 6+ `configuracoes`, alguma leitura
      // saiu do lote único.
      "configuracoes",
      "configuracoes",
      "configuracoes",
      "configuracoes",
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

/** Uma linha de `copiloto_sugestoes` como o mock de lista espera —
 * `bloco_inferido` com `bloco_id`/`confianca`, ou `null`/ausente para
 * simular "não sei" honesto / linha histórica sem a marca. */
function linhaInferida(blocoId: string | null, confianca: number, criadoEm: string) {
  return {
    conteudo: blocoId ? { bloco_inferido: { bloco_id: blocoId, confianca, evidencia: "citação real" } } : { bloco_inferido: null },
    criado_em: criadoEm,
  };
}

describe("montarEstadoCopiloto — bloco_atual_resolvido (Fase 12, Fatia 1, defeito 1 do Fable)", () => {
  it("🔴 TESTE DE ACEITE: sessão com inferência gravada no bloco 8 mantém o índice 8 mesmo sem fixação manual (o chamador não manda mais `bloco` cru)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }),
      undefined,
      {
        // n=2 (padrão): precisa de pelo menos 2 candidatas concordando para
        // decidir algo além de "mantém o vigente" — 2 leituras concordando
        // no bloco 8, confiança alta o bastante para passar o piso (0,70).
        copilotoSugestoes: [linhaInferida("bloco-8", 0.82, "2026-09-16T12:00:01.000Z"), linhaInferida("bloco-8", 0.80, "2026-09-16T12:00:00.000Z")],
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
      decidido_em: "2026-09-16T12:00:01.000Z",
      fixacao_expira_em: null,
    });
  });

  it("🔴 AGRAVANTE 1: linha histórica com bloco_id gravado mas SEM bloco_inferido no conteudo (fallback antigo, ou sessão anterior à 0106) NÃO é promovida a 'inferido'", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }), undefined, {
      // Linha histórica de verdade: chave `bloco_inferido` AUSENTE do jsonb
      // (nunca escrita). O mock de `not(...)` aplica o MESMO predicado do
      // Postgres (`->>bloco_id is not null`) — chave ausente também dá
      // `undefined ?? null`, então esta linha é excluída pelo filtro tal
      // como a real seria; sem NENHUMA candidata sobrando, cai em
      // indisponível.
      copilotoSugestoes: [{ conteudo: {}, criado_em: "2026-09-16T12:00:00.000Z" }],
    });
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

  it("🔴 DEFEITO 1 (Fable, 2ª rodada): linha com `bloco_inferido: null` EXPLÍCITO — o 'não sei' honesto que `validar.ts` grava quando a IA não infere — também NÃO é promovida a 'inferido'", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(11) }), undefined, {
      // `'{"bloco_inferido": null}'::jsonb -> 'bloco_inferido' is not null`
      // → TRUE no Postgres (é o defeito medido em produção): um filtro que
      // usasse `->` (sem `>`) deixaria esta linha passar. Com `->>`, jsonb
      // `null` vira SQL NULL de verdade e a linha é excluída — igual à linha
      // sem a chave. Sem nenhuma outra candidata, cai em indisponível.
      copilotoSugestoes: [linhaInferida(null, 0, "2026-09-16T12:10:00.000Z")],
    });
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
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        // `confianca_geral` da sugestão (coluna, ausente do mock — não é
        // lida) DIFERENTE da confiança da inferência de bloco (dentro do
        // conteudo) — 2 leituras concordando no mesmo bloco para satisfazer
        // n=2, ambas acima do piso.
        linhaInferida("bloco-1", 0.91, "2026-09-16T12:05:01.000Z"),
        linhaInferida("bloco-1", 0.88, "2026-09-16T12:05:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.confianca).toBe(0.91);
  });

  it("bloco_id inferido que não casa mais com o roteiro ativo (roteiro trocou no meio da sessão) cai para indisponível, nunca um título inventado", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(2) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-inexistente", 0.7, "2026-09-16T12:00:01.000Z"),
        linhaInferida("bloco-inexistente", 0.75, "2026-09-16T12:00:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.origem).toBe("indisponivel");
    expect(resultado.bloco_atual_resolvido?.titulo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fase 12, Fatia 1 (0117) — HISTERESE DO BLOCO. Bug medido na sessão real
// `ebbf08d4-9ed3-4d0d-a5c9-a780225726ce`: 0,85/parte_11 (fim da sessão)
// sobrescrito por uma leitura fraca (0,65/parte_00) mais recente. Estes
// testes provam a máquina de estado nova: piso, concordância de N,
// avanço/retrocesso — TROCANDO os papéis de "mais recente"/"mais antiga" da
// série real para caber no `roteiroComNBlocos` (índices em vez de nomes de
// parte, mesma lógica).
// ---------------------------------------------------------------------------
describe("montarEstadoCopiloto — histerese do bloco (0117)", () => {
  it("🔴 TESTE DE ACEITE (o bug do dono): oscilação 0,85/bloco-11 → 0,65/bloco-0 MANTÉM bloco-11 — piso (0,70) descarta a leitura fraca antes mesmo de formar a janela", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }), undefined, {
      copilotoSugestoes: [
        // Mais recente primeiro (ordem_evento desc) — reprodução da série
        // medida: 15:48 e 15:44 são leituras fracas de bloco-0 (0,65,
        // abaixo do piso 0,70); 15:40 é bloco-3 (0,75); 15:39 é bloco-11
        // (0,85, a inferência forte e mais antiga).
        linhaInferida("bloco-0", 0.65, "2026-09-17T15:48:00.000Z"),
        linhaInferida("bloco-0", 0.65, "2026-09-17T15:44:00.000Z"),
        linhaInferida("bloco-3", 0.75, "2026-09-17T15:40:00.000Z"),
        linhaInferida("bloco-11", 0.85, "2026-09-17T15:39:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    // Piso descarta as duas leituras de bloco-0 (0,65 < 0,70) — sobra
    // [bloco-3 0,75, bloco-11 0,85]. Janela (n=2) = essas duas, que NÃO
    // concordam entre si → mantém o vigente, que (sem 3ª candidata válida
    // sobrando) é a mais antiga da própria janela: bloco-11.
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-11");
    expect(resultado.bloco_atual_resolvido?.indice).toBe(11);
  });

  it("avanço legítimo: as 2 mais recentes concordam num bloco de índice MAIOR que o vigente → aceita", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-8", 0.8, "2026-09-17T16:00:02.000Z"),
        linhaInferida("bloco-8", 0.78, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-3", 0.75, "2026-09-17T15:40:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-8");
    expect(resultado.bloco_atual_resolvido?.indice).toBe(8);
    expect(resultado.bloco_atual_resolvido?.confianca).toBe(0.8);
  });

  it("retrocesso forte (confiança >= 0,90) é aceito mesmo com bloco_permite_retrocesso=false (padrão)", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.95, "2026-09-17T16:10:02.000Z"),
        linhaInferida("bloco-1", 0.92, "2026-09-17T16:10:01.000Z"),
        linhaInferida("bloco-8", 0.8, "2026-09-17T15:40:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
    expect(resultado.bloco_atual_resolvido?.indice).toBe(1);
  });

  it("retrocesso fraco (confiança < 0,90) é RECUSADO com bloco_permite_retrocesso=false (padrão) — mantém o vigente", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:10:02.000Z"),
        linhaInferida("bloco-1", 0.75, "2026-09-17T16:10:01.000Z"),
        linhaInferida("bloco-8", 0.8, "2026-09-17T15:40:00.000Z"),
      ],
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-8");
    expect(resultado.bloco_atual_resolvido?.indice).toBe(8);
  });

  it("retrocesso fraco é ACEITO quando copiloto_sessao.bloco_permite_retrocesso=true (reversão sem deploy)", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }),
      undefined,
      {
        copilotoSugestoes: [
          linhaInferida("bloco-1", 0.8, "2026-09-17T16:10:02.000Z"),
          linhaInferida("bloco-1", 0.75, "2026-09-17T16:10:01.000Z"),
          linhaInferida("bloco-8", 0.8, "2026-09-17T15:40:00.000Z"),
        ],
        configuracoes: { "copiloto_sessao.bloco_permite_retrocesso": true },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  it("piso de confiança configurável: piso_confianca_bloco=0.95 descarta até a leitura de 0,91 — mantém indisponível sem nenhuma candidata válida", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }),
      undefined,
      {
        copilotoSugestoes: [linhaInferida("bloco-1", 0.91, "2026-09-17T16:00:00.000Z")],
        configuracoes: { "copiloto_sessao.piso_confianca_bloco": 0.95 },
      },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.origem).toBe("indisponivel");
  });

  it("chave de configuração ausente (piso/histerese_n/permite_retrocesso) cai no fallback do código, nunca lança", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-1", 0.78, "2026-09-17T16:00:00.000Z"),
      ],
      configuracoes: {}, // nenhuma chave de histerese configurada — tudo cai no padrão (0,70 / 2 / false)
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  /* 🔴 ACHADO DO SECURITY-PENTESTER (17/09/2026): os testes acima cobriam
   * chave AUSENTE, mas não chave PRESENTE COM VALOR CORROMPIDO — e é esse o
   * caso real (a tela de Admin grava qualquer jsonb; basta digitar errado).
   * Com `histerese_n = 0` a janela virava `[]`, a guarda `length < n` não
   * pegava (`0 < 0` é falso), `every` sobre vazio dava `true` e
   * `janela[0].indice` lançava TypeError — 500 a cada 3 s na tela da sessão
   * AO VIVO. Não é hipótese: o pentester reproduziu em Node. */

  it("histerese_n = 0 (digitado errado no Admin) NÃO derruba o polling — cai no padrão", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-1", 0.78, "2026-09-17T16:00:00.000Z"),
      ],
      configuracoes: { "copiloto_sessao.histerese_n": 0 },
    });
    // O que importa aqui é NÃO LANÇAR — antes da correção, isto estourava
    // TypeError e o GET devolvia 500.
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  it("histerese_n negativo também cai no padrão, sem lançar", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-1", 0.78, "2026-09-17T16:00:00.000Z"),
      ],
      configuracoes: { "copiloto_sessao.histerese_n": -3 },
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  it("piso de confiança com tipo inválido (string) cai no padrão 0,70 — não trava tudo em falso", async () => {
    // Sem saneamento, `data.valor as number` deixava uma STRING passar e
    // `confianca >= "alta"` era sempre falso: nenhuma candidata passava nunca
    // do piso, e o bloco congelava para sempre — falha silenciosa, sem erro.
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-1", 0.78, "2026-09-17T16:00:00.000Z"),
      ],
      configuracoes: { "copiloto_sessao.piso_confianca_bloco": "alta" },
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    // 0,80 e 0,78 passam do padrão 0,70 → o bloco É resolvido.
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  it("piso fora do intervalo [0,1] cai no padrão", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(3) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-1", 0.8, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-1", 0.78, "2026-09-17T16:00:00.000Z"),
      ],
      configuracoes: { "copiloto_sessao.piso_confianca_bloco": 42 },
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null, null);
    expect(resultado.bloco_atual_resolvido?.bloco_id).toBe("bloco-1");
  });

  it("fixação manual continua vencendo TUDO, antes da histerese — mesmo com inferência forte e discordante disponível", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiros_versoes: roteiroComNBlocos(12) }), undefined, {
      copilotoSugestoes: [
        linhaInferida("bloco-11", 0.9, "2026-09-17T16:00:01.000Z"),
        linhaInferida("bloco-11", 0.88, "2026-09-17T16:00:00.000Z"),
      ],
    });
    const agora = new Date().toISOString();
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 2, { indice: 2, fixadoEm: agora });
    expect(resultado.bloco_atual_resolvido?.origem).toBe("fixado_manualmente");
    expect(resultado.bloco_atual_resolvido?.indice).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 🔴 CONTRAPROVA EXECUTADA (regra da casa: "depois REMOVA a correção e prove
// que os testes falham" — já fomos pegos 2× por teste que só concorda com o
// código, `retention` e a feature morta com 308 testes verdes). As 3
// regressões abaixo foram DE FATO injetadas em `estado.ts` (não só descritas)
// e a suite rodada de novo a cada uma, depois revertida:
//
//   1. `.filter((c) => c.confianca >= config.pisoConfianca)` trocado por
//      `.filter(() => true)` (piso desligado) → FALHOU, como previsto:
//        "🔴 TESTE DE ACEITE (o bug do dono)" (esperava bloco-11, recebeu
//          bloco-3 — a leitura fraca de bloco-0 já não filtrada mudou qual
//          linha sobra como "vigente" fora da janela)
//        "piso de confiança configurável" (esperava indisponivel, recebeu
//          inferido — 0,91 passou mesmo com piso_confianca_bloco=0.95)
//      25/27 continuaram verdes (as 2 falhas foram exatamente as que
//      testam piso, nenhuma falsa quebra em teste não relacionado).
//
//   2. `const retrocessoAceito = config.permiteRetrocesso || candidataNova.
//      confianca >= CONFIANCA_MINIMA_RETROCESSO_FORCADO;` trocado por
//      `const retrocessoAceito = true;` (barra de retrocesso removida) →
//      FALHOU, como previsto: "retrocesso fraco (confiança < 0,90) é
//      RECUSADO" (esperava bloco-8, recebeu bloco-1 — o retrocesso fraco que
//      deveria ser bloqueado passou a ser aceito). 26/27 continuaram verdes.
//
// As duas regressões foram revertidas (`git diff` limpo) antes deste commit
// — o comando `npx vitest run src/server/copiloto/estado.test.ts` com o
// código correto volta a dar 27/27.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fase 12, Fatia 5a (0117) — INVENTÁRIO NO PAYLOAD. Achado: 18 itens com
// evidência literal em `sessoes_copiloto.inventario_acumulado` na sessão
// real, ZERO visíveis no polling (só chegavam ao contexto de IA). Estes
// testes provam: zero query nova (mesmo embed), resumo por categoria via
// `resumirInventario` (reuso, não duplicação), teto de 5 recentes, kill-switch,
// e "vazio nunca é zero" (null, não objeto com contagens zeradas).
// ---------------------------------------------------------------------------
function itemInventario(overrides: Record<string, unknown> = {}) {
  return {
    categoria: "imovel",
    descricao: "sala comercial no centro",
    titularidade: "Terezinha",
    posse: "propria",
    valor_mencionado: "uns 800 mil",
    evidencia: "a sala comercial no centro é minha, comprei há 8 anos",
    chave: "imovel:sala comercial no centro",
    primeira_mencao_em: "2026-09-17T15:00:00.000Z",
    ultima_mencao_em: "2026-09-17T15:00:00.000Z",
    ...overrides,
  };
}

describe("montarEstadoCopiloto — inventario no payload (Fase 12, Fatia 5a)", () => {
  it("sem sessoes_copiloto (sessão nova): inventario é null, não um objeto com contagens zeradas", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario).toBeNull();
  });

  it("sessoes_copiloto existe mas inventario_acumulado é null (nenhum item ainda): inventario é null", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], inventario_acumulado: null },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario).toBeNull();
  });

  it("inventario_acumulado é array vazio ([]): inventario é null (mesmo tratamento de 'nenhum item ainda')", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], inventario_acumulado: [] },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario).toBeNull();
  });

  it("🔴 kill-switch copiloto_sessao.inventario_mencionado DESLIGADO: inventario null MESMO com itens já acumulados — não apaga a coluna, só para de EXIBIR", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          inventario_acumulado: [itemInventario()],
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.inventario_mencionado": false } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario).toBeNull();
  });

  it("com itens acumulados e kill-switch ligado (padrão): resumo reflete as contagens por categoria (posse própria)", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          inventario_acumulado: [
            itemInventario({ categoria: "imovel", descricao: "sala comercial", chave: "imovel:sala comercial" }),
            itemInventario({ categoria: "imovel", descricao: "apartamento na praia", chave: "imovel:apartamento na praia" }),
            itemInventario({ categoria: "empresa", descricao: "empresa X", chave: "empresa:empresa x", posse: "terceiro" }),
          ],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario).not.toBeNull();
    // `posse:"terceiro"` nunca soma em NENHUM total (regra do pedido do
    // dono) — resumirInventario já cobre isso em inventario.test.ts; aqui
    // só provamos que a FUNÇÃO REAL foi chamada (não uma reimplementação).
    expect(resultado.inventario!.resumo.por_categoria).toEqual([{ categoria: "imovel", contagem_propria: 2, contagem_incerta: 0, sem_titularidade: 0 }]);
    expect(resultado.inventario!.resumo.total_itens_proprios).toBe(2);
  });

  it("🔴 recentes: no máximo 5 itens, mais recentes primeiro por ultima_mencao_em, MESMO com mais de 5 acumulados (banda paga, nunca a lista inteira)", async () => {
    const itens = Array.from({ length: 8 }, (_, i) =>
      itemInventario({
        descricao: `imóvel ${i}`,
        chave: `imovel:imovel ${i}`,
        ultima_mencao_em: `2026-09-17T15:0${i}:00.000Z`,
      }),
    );
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], inventario_acumulado: itens },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario!.recentes).toHaveLength(5);
    // Mais recentes primeiro: imóvel 7 (15:07) é o último mencionado.
    expect(resultado.inventario!.recentes[0]!.descricao).toBe("imóvel 7");
    expect(resultado.inventario!.recentes[4]!.descricao).toBe("imóvel 3");
  });

  it("recentes carregam evidência (a citação literal) — é o que diferencia do resumo que vai para a IA", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          inventario_acumulado: [itemInventario({ evidencia: "citação real do decisor" })],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario!.recentes[0]!.evidencia).toBe("citação real do decisor");
  });

  it("`chave` (dedupe interno) NÃO vaza para o payload do painel — é detalhe de inventario.ts, nunca da tela", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          inventario_acumulado: [itemInventario()],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.inventario!.recentes[0]).not.toHaveProperty("chave");
  });

  it("🔴 ZERO query nova: inventario_acumulado chega pelo MESMO embed de sessoes_viabilidade — nenhuma chamada extra a supabase.from() além das já documentadas nesta suíte", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          inventario_acumulado: [itemInventario()],
        },
      }),
    );
    await montarEstadoCopiloto(supabase, "sessao-1", 0);
    // Mesma lista de sempre (sessoes_viabilidade + 4x configuracoes da
    // histerese + 1x o LOTE ÚNICO que resolve os kill-switches de
    // inventário/memória/ficha/rodapé/realce/silêncio (18/09/2026, 3ª
    // rodada, achado do Fable) + copiloto_sugestoes + consentimentos) —
    // nenhuma tabela nova chamada só para o inventário, porque ele já veio
    // no embed principal.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "sessoes_viabilidade",
      // Fallback de roteiro ativo (18/09/2026): esta sessão mockada não tem
      // `roteiro_versao_id` carimbado (estado de toda sessão antes do 1º
      // SIM), então `montarEstadoCopiloto` busca a versão ATIVA. Medido em
      // produção: Index Scan em `uniq_roteiro_ativo`, 0,074 ms / 2 buffers,
      // e some assim que o 1º SIM carimba a FK. Sessão COM roteiro carimbado
      // não faz esta chamada — ver o teste dedicado abaixo.
      "roteiros_versoes",
      // 5 `configuracoes` no total (correção da 3ª rodada, achado do Fable).
      // As 4 leituras de `resolverBlocoAtual` (histerese, unitárias) + 1
      // ÚNICA chamada de `lerConfiguracoesEmLote` — TODAS no MESMO
      // `Promise.all`, nenhuma sequencial em relação às outras. Se este
      // teste subir para 6+ `configuracoes`, alguma leitura saiu do lote
      // único.
      "configuracoes",
      "configuracoes",
      "configuracoes",
      "configuracoes",
      "configuracoes",
      "copiloto_sugestoes",
      "consentimentos",
    ]);
  });
});

// ---------------------------------------------------------------------------
// FICHA DO CLIENTE (18/09/2026, migration 0122) — combina `ficha_acumulada`
// com o inventário próprio já resolvido acima, numa lista só e ordenada.
// Kill-switch `copiloto_sessao.ficha_cliente` nasce `false` (padrão de
// fábrica): estes testes provam o comportamento nos dois estados.
// ---------------------------------------------------------------------------
function itemFichaAcumulada(overrides: Record<string, unknown> = {}) {
  return {
    categoria: "objecao",
    texto: "imposto de renda é 30 por 100",
    evidencia: "imposto de renda é 30 por 100",
    chave: "objecao:imposto de renda e 30 por 100",
    primeira_mencao_em: "2026-09-18T15:00:00.000Z",
    ultima_mencao_em: "2026-09-18T15:00:00.000Z",
    n: 1,
    ...overrides,
  };
}

describe("montarEstadoCopiloto — ficha do cliente no payload (migration 0122)", () => {
  it("kill-switch DESLIGADO (padrão de fábrica): ficha é null MESMO com itens já acumulados", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          ficha_acumulada: [itemFichaAcumulada()],
        },
      }),
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha).toBeNull();
  });

  it("kill-switch LIGADO mas sem nenhum item (ficha vazia, sem inventário): ficha é objeto com lista vazia, NUNCA null (null é reservado ao kill-switch desligado — achado do Fable, rodada B4: geometria constante da tela)", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], ficha_acumulada: [] },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.ficha_cliente": true } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha).not.toBeNull();
    expect(resultado.ficha).toEqual({ itens: [], teto_fixos: null });
  });

  it("kill-switch LIGADO com itens: ficha combina ficha_acumulada + inventário próprio, ordenados por rank_categoria", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          ficha_acumulada: [
            itemFichaAcumulada({ categoria: "dor", texto: "vai perder qualidade de vida", chave: "dor:vai perder qualidade de vida" }),
            itemFichaAcumulada({ categoria: "objecao" }),
          ],
          inventario_acumulado: [itemInventario()],
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.ficha_cliente": true } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha).not.toBeNull();
    // objecao > dor > patrimonio (rank_categoria, decisão do dono).
    expect(resultado.ficha!.itens.map((i) => i.categoria)).toEqual(["objecao", "dor", "patrimonio"]);
  });

  it("ficha combinada reusa o MESMO corte de 5 recentes que a célula de inventário já expõe (nenhuma 2ª derivação do array bruto)", async () => {
    const itensInventario = Array.from({ length: 8 }, (_, i) =>
      itemInventario({ descricao: `imóvel ${i}`, chave: `imovel:imovel ${i}`, ultima_mencao_em: `2026-09-17T15:0${i}:00.000Z` }),
    );
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          ficha_acumulada: [],
          inventario_acumulado: itensInventario,
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.ficha_cliente": true } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha!.itens).toHaveLength(5);
  });

  it("teto_fixos vem null quando copiloto_sessao.ficha_teto_fixos não está configurado (a tela deriva do viewport)", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], ficha_acumulada: [itemFichaAcumulada()] },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.ficha_cliente": true } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha!.teto_fixos).toBeNull();
  });

  it("teto_fixos VENCE quando copiloto_sessao.ficha_teto_fixos está configurado com um número", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        sessoes_copiloto: { estado: "ativo", gravacao_externa_id: null, participantes: [], ficha_acumulada: [itemFichaAcumulada()] },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.ficha_cliente": true, "copiloto_sessao.ficha_teto_fixos": 3 } },
    );
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.ficha!.teto_fixos).toBe(3);
  });

  it("kill-switch DESLIGADO: LÊ copiloto_sessao.ficha_teto_fixos no MESMO lote único, mas DESCARTA o valor (correção da 3ª rodada: a leitura acontece sempre, dentro da 1 única chamada de configuracoes, nunca como ida extra)", async () => {
    const configuracoesSpy = vi.fn();
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const fromOriginal = supabase.from as unknown as (t: string) => unknown;
    (supabase.from as unknown) = vi.fn((t: string) => {
      if (t === "configuracoes") configuracoesSpy();
      return fromOriginal(t);
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    // 5 chamadas a `configuracoes` no caminho de sempre (correção da 3ª
    // rodada, achado do Fable) — histerese ×4 (unitárias) + 1 ÚNICA chamada
    // de `lerConfiguracoesEmLote`, que resolve bool + `ficha_teto_fixos`
    // (json) + silêncio (int) na MESMA `select ... in(...)` — dentro do
    // mesmo `Promise.all` (nenhuma delas espera outra terminar).
    // `ficha.teto_fixos` continua `null` porque `ficha` inteiro é `null`
    // (kill-switch desligado) — a leitura aconteceu, só o USO é descartado.
    expect(configuracoesSpy).toHaveBeenCalledTimes(5);
    expect(resultado.ficha).toBeNull();
  });

  it("realce_insight_novo/rodape_transcricao vêm no payload (achado do Fable: o front já lia estas 2 chaves, o servidor nunca as enviava)", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }), undefined, {
      configuracoes: {
        "copiloto_sessao.realce_insight_novo": false,
        "copiloto_sessao.rodape_transcricao": false,
      },
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.realce_insight_novo).toBe(false);
    expect(resultado.rodape_transcricao).toBe(false);
  });

  it("realce_insight_novo/rodape_transcricao caem no padrão de fábrica (true) quando a chave não está configurada", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.realce_insight_novo).toBe(true);
    expect(resultado.rodape_transcricao).toBe(true);
  });

  it("silencio_atencao_s/silencio_alerta_s vêm no payload com os valores configurados", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }), undefined, {
      configuracoes: {
        "copiloto_sessao.silencio_atencao_s": 20,
        "copiloto_sessao.silencio_alerta_s": 40,
      },
    });
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.silencio_atencao_s).toBe(20);
    expect(resultado.silencio_alerta_s).toBe(40);
  });

  it("silencio_atencao_s/silencio_alerta_s caem no padrão de fábrica (12/25) quando a chave não está configurada", async () => {
    const supabase = montarSupabase(sessaoBase({ sessoes_copiloto: null }));
    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.silencio_atencao_s).toBe(12);
    expect(resultado.silencio_alerta_s).toBe(25);
  });
});

/**
 * 🔴 REGRESSÃO MEDIDA AO VIVO — sessão de 18/09/2026 (Carlos Alberto,
 * `b3eca233`), 1h10 de conversa real.
 *
 * O fallback de roteiro ativo existia em `contexto.ts` desde 14/09 (achado do
 * coordenador) e NÃO foi propagado para `estado.ts`. Como `roteiro_versao_id`
 * só é carimbado por `registrar_sim_sessao` no 1º SIM, `blocos` ficava `[]`
 * aqui, o `blocos.findIndex` de `aplicarHisterese` devolvia -1 para TODA
 * candidata, e as inferências corretas da IA eram descartadas: bloco resolvia
 * `indisponivel` → `route.ts` convertia em índice 0 → a IA comparava
 * partilha patrimonial contra o bloco de Check-in.
 *
 * Medido na sessão real: `bloco_indice = 0` em 100% das 215 janelas e 98 de
 * 113 sugestões (87%) dizendo "desvie do bloco atual", com 16 inferências
 * válidas (≥ piso 0,7) sendo jogadas fora — a maioria apontando `parte_03`
 * (Radiografia Familiar e Patrimonial), que era de fato onde a conversa
 * estava.
 */
describe("montarEstadoCopiloto — fallback de roteiro ativo (18/09/2026)", () => {
  const BLOCOS_V5 = [
    { id: "parte_00", titulo: "Check-in e Profissionalismo" },
    { id: "parte_01", titulo: "Assumir o Controle" },
    { id: "parte_02", titulo: "A Motivação do Cliente" },
    { id: "parte_03", titulo: "Radiografia Familiar e Patrimonial" },
  ];

  function sugestaoInferindo(ordem: number, blocoId: string, confianca: number) {
    return {
      bloco_id: null,
      conteudo: { bloco_inferido: { bloco_id: blocoId, confianca } },
      criado_em: `2026-09-18T13:0${ordem}:00.000Z`,
    };
  }

  it("🔴 sessão SEM roteiro carimbado (antes do 1º SIM): a inferência da IA resolve o bloco em vez de cair no índice 0", async () => {
    const supabase = montarSupabase(
      sessaoBase({ roteiro_versao_id: null, roteiros_versoes: null }),
      undefined,
      {
        // Duas leituras concordantes acima do piso — a janela de histerese
        // (n=2) que a sessão real tinha e que era descartada.
        copilotoSugestoes: [sugestaoInferindo(2, "parte_03", 0.85), sugestaoInferindo(1, "parte_03", 0.8)],
        roteiroAtivo: { definicao: { blocos: BLOCOS_V5 } },
      },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null);

    expect(resultado.bloco_atual_resolvido.origem).toBe("inferido");
    expect(resultado.bloco_atual_resolvido.bloco_id).toBe("parte_03");
    // O ponto do defeito: 3, não 0. `route.ts` usa `indice ?? 0`, então
    // `indisponivel` viraria silenciosamente o bloco de Check-in.
    expect(resultado.bloco_atual_resolvido.indice).toBe(3);
  });

  it("sem versão ativa no banco (nem carimbo, nem fallback): continua `indisponivel` — nunca um índice inventado", async () => {
    const supabase = montarSupabase(sessaoBase({ roteiro_versao_id: null, roteiros_versoes: null }), undefined, {
      copilotoSugestoes: [sugestaoInferindo(2, "parte_03", 0.85), sugestaoInferindo(1, "parte_03", 0.8)],
      roteiroAtivo: undefined,
    });

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null);

    expect(resultado.bloco_atual_resolvido.origem).toBe("indisponivel");
    expect(resultado.bloco_atual_resolvido.indice).toBeNull();
  });

  it("sessão COM roteiro carimbado: usa o carimbo e NÃO consulta `roteiros_versoes` (zero query extra no caminho comum)", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: { definicao: { blocos: BLOCOS_V5 } },
      }),
      undefined,
      { copilotoSugestoes: [sugestaoInferindo(2, "parte_03", 0.85), sugestaoInferindo(1, "parte_03", 0.8)] },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", null);

    expect(resultado.bloco_atual_resolvido.indice).toBe(3);
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).not.toContain("roteiros_versoes");
  });
});

/**
 * 🔴 CORREÇÃO DO FABLE (18/09/2026) — `falta_no_bloco` nunca esvaziava.
 * `montarEstadoCopiloto` montava `camposPendentes` a partir de `campos[]` do
 * bloco INTEIRO, sem subtrair o que `resumo_acumulado.perguntado` (a memória
 * do copiloto) já cobriu — `blocoAtualCoberto` (front) exige
 * `campos.length===0`, e isso nunca acontecia. Estes testes usam o PAYLOAD
 * REAL de `montarEstadoCopiloto` (não uma fixture literal de
 * `EstadoCopiloto`) — provam a subtração de ponta a ponta, com o roteiro e o
 * `resumo_acumulado` entrando exatamente pelo mesmo embed que a produção usa.
 */
describe("montarEstadoCopiloto — falta_no_bloco.campos subtrai resumo_acumulado.perguntado (18/09/2026)", () => {
  const BLOCO_COM_CAMPOS = {
    id: "parte_03",
    titulo: "Radiografia Familiar e Patrimonial",
    campos: [
      { id: "filhos_maiores_menores", rotulo: "Filhos (maiores ou menores)", tipo: "texto" },
      { id: "ocupacoes_idades", rotulo: "Ocupações e idades", tipo: "texto" },
      { id: "lista_bens", rotulo: "Lista de bens", tipo: "texto" },
    ],
    observar: ["Hesitação ao falar do imóvel da praia"],
  };
  const ROTEIRO_COM_CAMPOS = { definicao: { blocos: [BLOCO_COM_CAMPOS] } };

  it("kill-switch LIGADO + 2 dos 3 campos já perguntados: falta_no_bloco.campos devolve só o que falta", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: ROTEIRO_COM_CAMPOS,
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: null,
          inventario_acumulado: null,
          resumo_acumulado: {
            v: 1,
            perguntado: [
              { t: "filhos_maiores_menores", em: "2026-09-18T14:00:00Z", n: 1 },
              { t: "ocupacoes_idades", em: "2026-09-18T14:05:00Z", n: 2 },
            ],
            pendente: ["lista_bens"],
            cortado_em: null,
          },
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.resumo_acumulado": true } },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(resultado.falta_no_bloco.campos).toEqual([{ id: "lista_bens", rotulo: "Lista de bens", tipo: "texto" }]);
    // `observar` nunca é filtrado pela memória (é texto livre, a memória não categoriza) — continua exibido por inteiro.
    expect(resultado.falta_no_bloco.observar).toEqual(["Hesitação ao falar do imóvel da praia"]);
  });

  it("kill-switch LIGADO + TODOS os campos já perguntados: falta_no_bloco.campos fica VAZIO — a tela de bloco coberto passa a ser alcançável", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: ROTEIRO_COM_CAMPOS,
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: null,
          inventario_acumulado: null,
          resumo_acumulado: {
            v: 1,
            perguntado: [
              { t: "filhos_maiores_menores", em: "t", n: 1 },
              { t: "ocupacoes_idades", em: "t", n: 1 },
              { t: "lista_bens", em: "t", n: 1 },
            ],
            pendente: [],
            cortado_em: null,
          },
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.resumo_acumulado": true } },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(resultado.falta_no_bloco.campos).toEqual([]);
  });

  it("kill-switch DESLIGADO (padrão de fábrica): falta_no_bloco.campos devolve TODOS os campos do bloco — idêntico ao comportamento de antes desta correção", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: ROTEIRO_COM_CAMPOS,
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: null,
          inventario_acumulado: null,
          resumo_acumulado: {
            v: 1,
            perguntado: [{ t: "filhos_maiores_menores", em: "t", n: 1 }, { t: "ocupacoes_idades", em: "t", n: 1 }, { t: "lista_bens", em: "t", n: 1 }],
            pendente: [],
            cortado_em: null,
          },
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.resumo_acumulado": false } },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    // Mesmo com `perguntado` cobrindo os 3 campos, o kill-switch desligado
    // (fail-CLOSED, B76) faz a memória NÃO SER LIDA para este fim — os 3
    // campos continuam aparecendo, exatamente como antes da memória existir.
    expect(resultado.falta_no_bloco.campos).toEqual([
      { id: "filhos_maiores_menores", rotulo: "Filhos (maiores ou menores)", tipo: "texto" },
      { id: "ocupacoes_idades", rotulo: "Ocupações e idades", tipo: "texto" },
      { id: "lista_bens", rotulo: "Lista de bens", tipo: "texto" },
    ]);
  });

  it("chave AUSENTE de `configuracoes` (nunca configurada): cai no padrão `false` — fail-CLOSED sem exigir gravação prévia", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: ROTEIRO_COM_CAMPOS,
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: null,
          inventario_acumulado: null,
          resumo_acumulado: { v: 1, perguntado: [{ t: "lista_bens", em: "t", n: 1 }], pendente: [], cortado_em: null },
        },
      }),
      undefined,
      { configuracoes: {} },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);

    expect(resultado.falta_no_bloco.campos.map((c) => c.id)).toEqual(["filhos_maiores_menores", "ocupacoes_idades", "lista_bens"]);
  });

  it("resumo_acumulado '{}' legado (default da 0091, sessão pré-existente): normaliza para vazio, nunca lança — todos os campos continuam pendentes", async () => {
    const supabase = montarSupabase(
      sessaoBase({
        roteiro_versao_id: "roteiro-v5",
        roteiros_versoes: ROTEIRO_COM_CAMPOS,
        sessoes_copiloto: {
          estado: "ativo",
          gravacao_externa_id: null,
          participantes: [],
          expurgo_segmentos_em: null,
          inventario_acumulado: null,
          resumo_acumulado: {},
        },
      }),
      undefined,
      { configuracoes: { "copiloto_sessao.resumo_acumulado": true } },
    );

    const resultado = await montarEstadoCopiloto(supabase, "sessao-1", 0);
    expect(resultado.falta_no_bloco.campos.map((c) => c.id)).toEqual(["filhos_maiores_menores", "ocupacoes_idades", "lista_bens"]);
  });
});
