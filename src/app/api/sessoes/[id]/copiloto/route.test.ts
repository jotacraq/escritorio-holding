import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/sessoes/[id]/copiloto — Fase 10, Fatia 3 (§2.4/§4.1/§6.2.2 do
 * plano): a MESMA rota da Fatia 1, agora com polling coalescido (segmentos
 * novos + sugestões novas) e o CICLO AUTOMÁTICO embutido.
 *
 * O QUE ESTE ARQUIVO PROVA:
 *   1. Kill-switch (`copiloto_sessao.ativo=false`) continua fail-closed —
 *      mesmo contrato da Fatia 1, não regrediu.
 *   2. O payload tem os 4 campos novos do contrato (`segmentos_novos`,
 *      `sugestoes_novas`, os dois `proximo_cursor_*`, `ciclo`).
 *   3. 🔴 CONTRATO CENTRAL DA FATIA: quando o ciclo automático é bloqueado
 *      pelo gate (decisão/consentimento ausente), a rota devolve
 *      `ciclo.resultado='bloqueado_pelo_gate'` com `motivo_bloqueio` — é
 *      COMO A TELA SABE que o gate fechou no meio da sessão (não por
 *      inferência de "sumiu sugestão nova").
 *   4. O ciclo NUNCA derruba o polling: se `executarCicloCopiloto` lançar,
 *      a resposta ainda é 200 com o estado/segmentos/sugestões já existentes.
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...a: unknown[]) => exigirVePatrimonioMock(...a) }));

const supabaseServidorMock = { from: vi.fn() };
const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const executarCicloCopilotoMock = vi.fn();
vi.mock("@/server/copiloto/ciclo", () => ({
  executarCicloCopiloto: (...a: unknown[]) => executarCicloCopilotoMock(...a),
}));

const { GET } = await import("./route");

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    is: encadeavel,
    not: encadeavel,
    gt: encadeavel,
    gte: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    in: encadeavel,
    returns: terminal, // encerra a cadeia como array (usado por buscarSegmentosNovos/buscarSugestoesNovas)
    maybeSingle: terminal,
    single: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const SESSAO_BASE = {
  id: "sessao-1",
  roteiro_versao_id: null,
  sims: {},
  jornadas: { pessoa_id: "pessoa-1" },
  roteiros_versoes: null,
  sessoes_copiloto: { estado: "ativo" },
};

/** `configuracoes` é lida 3x nesta rota, com CHAVES diferentes (`ativo`,
 * `confianca_minima`, `polling_ms`) — um mock só por TABELA confundiria as
 * três (achado ao corrigir o campo `polling`: `eq("chave", X)` precisa
 * diferenciar, senão o teste "passa" sem provar nada sobre `polling_ms`). */
function configuracoesPorChave(valores: Record<string, unknown>) {
  const builder: Record<string, unknown> = {};
  let chaveAtual: string | undefined;
  Object.assign(builder, {
    select: () => builder,
    eq: (_coluna: string, valor: string) => {
      chaveAtual = valor;
      return builder;
    },
    maybeSingle: async () => {
      const valor = chaveAtual !== undefined ? valores[chaveAtual] : undefined;
      return valor === undefined ? { data: null, error: null } : { data: { valor }, error: null };
    },
    then: (ok: (v: unknown) => unknown) => {
      const valor = chaveAtual !== undefined ? valores[chaveAtual] : undefined;
      const resultado = valor === undefined ? { data: null, error: null } : { data: { valor }, error: null };
      return Promise.resolve(resultado).then(ok);
    },
  });
  return builder;
}

function montarCenario(opts: {
  copilotoAtivo: boolean;
  pollingMs?: number;
  segmentosNovos?: unknown[];
  sugestoesNovas?: unknown[];
}) {
  supabaseServidorMock.from.mockImplementation((tabela: string) => {
    if (tabela === "configuracoes") {
      return configuracoesPorChave({
        "copiloto_sessao.ativo": opts.copilotoAtivo,
        "copiloto_sessao.confianca_minima": 0.6,
        "copiloto_sessao.polling_ms": opts.pollingMs,
      });
    }
    if (tabela === "sessoes_viabilidade") {
      return consultaEncadeavel({ data: SESSAO_BASE, error: null });
    }
    if (tabela === "sessoes_copiloto_segmentos") {
      return consultaEncadeavel({ data: opts.segmentosNovos ?? [], error: null });
    }
    if (tabela === "copiloto_sugestoes") {
      return consultaEncadeavel({ data: opts.sugestoesNovas ?? [], error: null });
    }
    if (tabela === "consentimentos") {
      return consultaEncadeavel({ data: null, error: null });
    }
    throw new Error(`tabela não mockada em supabaseServidorMock: ${tabela}`);
  });
}

function requisicao(query = "") {
  return new Request(`http://localhost/api/sessoes/11111111-1111-4111-8111-111111111111/copiloto${query}`, {
    method: "GET",
  }) as never;
}

const PARAMS = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  supabaseAdminMock.from.mockReset();
  executarCicloCopilotoMock.mockReset();
});

describe("GET /api/sessoes/[id]/copiloto — polling coalescido (Fatia 3)", () => {
  it("copiloto_sessao.ativo=false → 409 copiloto_desligado, kill-switch não regrediu", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: false });

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("copiloto_desligado");
    expect(executarCicloCopilotoMock).not.toHaveBeenCalled();
  });

  it("🔴 gate fechou no meio da sessão: ciclo.resultado='bloqueado_pelo_gate' com motivo — contrato explícito para a tela", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "bloqueado_pelo_gate", motivo: "sem_consentimento_titular" });

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.ciclo).toEqual({ avaliado: true, resultado: "bloqueado_pelo_gate", motivo_bloqueio: "sem_consentimento_titular" });
  });

  it("silêncio normal: ciclo avaliado, sem gatilho → resultado null, motivo_bloqueio null (não é erro, é estado normal)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();
    expect(corpo.ciclo).toEqual({ avaliado: true, resultado: null, motivo_bloqueio: null });
  });

  it("o ciclo NUNCA derruba o polling: executarCicloCopiloto lança → resposta ainda é 200 com ciclo.avaliado=false", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true });
    executarCicloCopilotoMock.mockRejectedValue(new Error("falha inesperada de rede"));

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.ciclo).toEqual({ avaliado: false, resultado: null, motivo_bloqueio: null });
    // segmentos/sugestões continuam presentes mesmo com o ciclo falhando
    expect(corpo.segmentos_novos).toEqual([]);
    expect(corpo.sugestoes_novas).toEqual([]);
  });

  it("🔴 CORREÇÃO (achado do coordenador): payload expõe polling.em_foco_ms lido de copiloto_sessao.polling_ms — mudar a config muda a tela", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true, pollingMs: 5000 });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.polling).toEqual({ em_foco_ms: 5000, sem_foco_ms: 16_667 });
  });

  it("polling_ms ausente no banco → cai no fail-safe 3000/10000, nunca quebra a rota", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true }); // pollingMs não informado
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.polling).toEqual({ em_foco_ms: 3000, sem_foco_ms: 10_000 });
  });

  it("🔴 Fase 11 — Tarefa 7: sugestão gravada NESTA MESMA chamada já aparece em sugestoes_novas, sem esperar o tick seguinte", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true, sugestoesNovas: [] }); // buscarSugestoesNovas não viu nada ainda
    executarCicloCopilotoMock.mockResolvedValue({
      situacao: "sugestao_gravada",
      sugestaoId: "sugestao-nova-1",
      ordemEvento: 9,
      criadoEm: "2026-09-15T14:00:09.000Z",
      gatilho: "intervalo",
      visivel: true,
      sugestao: { proxima_pergunta: "Quem decide?", falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.8 },
      confiancaGeral: 0.8,
    });

    const resposta = await GET(requisicao("?desde_sugestao=5"), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.sugestoes_novas).toHaveLength(1);
    expect(corpo.sugestoes_novas[0]).toMatchObject({
      sugestao_id: "sugestao-nova-1",
      ordem_evento: 9,
      visivel: true,
      confianca_geral: 0.8,
    });
    // 🔴 o cursor precisa avançar JUNTO — senão o tick seguinte (desde_sugestao=9)
    // não existe e a mesma linha volta duplicada (o front concatena sem deduplicar).
    expect(corpo.proximo_cursor_sugestao).toBe(9);
  });

  it("🔴 Fase 11 — Tarefa 7: sem duplicata — se buscarSugestoesNovas JÁ trouxe a linha que o ciclo acabou de gravar (corrida rara), o cursor bloqueia a re-inclusão", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    // A query paralela já pegou ordem_evento=9 (ex.: corrida entre SELECT e INSERT).
    montarCenario({
      copilotoAtivo: true,
      sugestoesNovas: [
        {
          id: "sugestao-nova-1",
          ordem_evento: 9,
          gatilho: "intervalo",
          conteudo: { proxima_pergunta: "Quem decide?", falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.8 },
          confianca: 0.8,
          desfecho: null,
          criado_em: "2026-09-15T14:00:09.000Z",
        },
      ],
    });
    executarCicloCopilotoMock.mockResolvedValue({
      situacao: "sugestao_gravada",
      sugestaoId: "sugestao-nova-1",
      ordemEvento: 9,
      criadoEm: "2026-09-15T14:00:09.000Z",
      gatilho: "intervalo",
      visivel: true,
      sugestao: { proxima_pergunta: "Quem decide?", falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.8 },
      confiancaGeral: 0.8,
    });

    const resposta = await GET(requisicao("?desde_sugestao=5"), PARAMS);
    const corpo = await resposta.json();

    // Exatamente 1 entrada — nunca 2 (o cursor já estava em 9, `9 > 9` é falso).
    expect(corpo.sugestoes_novas).toHaveLength(1);
    expect(corpo.proximo_cursor_sugestao).toBe(9);
  });

  it("payload inclui os cursores incrementais e o estado determinístico (contrato da Fatia 1 preservado)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: true });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao("?bloco=1&desde_segmento=5&desde_sugestao=2"), PARAMS);
    const corpo = await resposta.json();

    expect(corpo).toHaveProperty("sessao_id");
    expect(corpo).toHaveProperty("estado_copiloto");
    expect(corpo).toHaveProperty("proximo_cursor_segmento");
    expect(corpo).toHaveProperty("proximo_cursor_sugestao");
    // Sem novidade, o cursor devolvido é o mesmo que veio na query.
    expect(corpo.proximo_cursor_segmento).toBe(5);
    expect(corpo.proximo_cursor_sugestao).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fatia 4, §5 — achado do coordenador: "compararComDecisores não tem
// chamador... a 4c está escrita e inerte". Este bloco prova que o payload
// HTTP REAL do polling (não só a função interna, testada em
// `server/copiloto/estado.test.ts`) carrega `bot`/`comparacao_decisores`.
// ---------------------------------------------------------------------------
describe("GET /api/sessoes/[id]/copiloto — bot e comparação de decisores no payload (Fatia 4, §5)", () => {
  function montarCenarioComDecisores(opts: {
    sessoesCopiloto: unknown;
    briefings: unknown[];
  }) {
    supabaseServidorMock.from.mockImplementation((tabela: string) => {
      if (tabela === "configuracoes") {
        return configuracoesPorChave({
          "copiloto_sessao.ativo": true,
          "copiloto_sessao.confianca_minima": 0.6,
          "copiloto_sessao.polling_ms": undefined,
        });
      }
      if (tabela === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: {
            id: "sessao-1",
            roteiro_versao_id: null,
            sims: {},
            jornadas: { pessoa_id: "pessoa-1", briefings: opts.briefings },
            roteiros_versoes: null,
            sessoes_copiloto: opts.sessoesCopiloto,
          },
          error: null,
        });
      }
      if (tabela === "sessoes_copiloto_segmentos") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "copiloto_sugestoes") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "consentimentos") return consultaEncadeavel({ data: null, error: null });
      throw new Error(`tabela não mockada em supabaseServidorMock: ${tabela}`);
    });
  }

  it("🔴 sem participantes: payload.comparacao_decisores é null, NÃO um objeto com arrays vazios", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenarioComDecisores({
      sessoesCopiloto: { estado: "ativo", gravacao_externa_id: "bot_1", participantes: [] },
      briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha", "Cleison"] } } }],
    });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.comparacao_decisores).toBeNull();
    expect(corpo.bot).toEqual({ estado: "ativo", erro_provedor: null, retencao_infinita_detectada: false });
  });

  it("com participantes e decisores: payload.comparacao_decisores aparece com ausentes/ambiguos DISTINTOS", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenarioComDecisores({
      sessoesCopiloto: {
        estado: "ativo",
        gravacao_externa_id: "bot_1",
        participantes: [
          { nome: "Terezinha", entrou_em: "10:00", saiu_em: null },
          { nome: "João Silva", entrou_em: "10:01", saiu_em: null },
          { nome: "joão silva", entrou_em: "10:02", saiu_em: null },
        ],
      },
      briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha", "Cleison", "João Silva"] } } }],
    });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "nenhum_gatilho" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.comparacao_decisores).not.toBeNull();
    expect(corpo.comparacao_decisores.presentes).toEqual([{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }]);
    expect(corpo.comparacao_decisores.ausentes).toEqual(["Cleison"]);
    // 🔴 ambiguos != ausentes — Cleison (ausente de verdade) nunca aparece
    // aqui, e João Silva (ambíguo, 2 participantes casando) nunca aparece em ausentes.
    expect(corpo.comparacao_decisores.ambiguos).toEqual(["João Silva"]);
    expect(corpo.comparacao_decisores.ausentes).not.toContain("João Silva");
    expect(corpo.comparacao_decisores.ambiguos).not.toContain("Cleison");
  });

  it("sem sessoes_copiloto (nunca digitou/pediu bot): payload.bot é null", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenarioComDecisores({ sessoesCopiloto: null, briefings: [] });
    executarCicloCopilotoMock.mockResolvedValue({ situacao: "sessao_nao_ativa_para_ciclo" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.bot).toBeNull();
    expect(corpo.comparacao_decisores).toBeNull();
  });
});
