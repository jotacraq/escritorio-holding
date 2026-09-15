import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Teste do HANDLER do webhook do Recall.ai — Fase 10, Fatia 4b
 * (docs/ARQUITETURA-FASE-10.md §4.2, §6.2, §8, §12). Fornecedor SEMPRE
 * mockado — nada aqui chama a Recall real. O EFEITO de cada evento
 * (`registrarSegmentoDoBot`/`registrarEventoParticipante`) já tem teste
 * próprio via `entrada-bot`/`participantes`; este arquivo prova o CONTRATO
 * HTTP: fail-closed, segredo em tempo constante, idempotência, roteamento
 * por `type`, e — o aceite mais específico desta fatia — tipo desconhecido
 * NUNCA vira 500.
 */

const registrarErroMock = vi.fn();
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const registrarTentativaInvalidaMock = vi.fn();
const reservarEventoWebhookMock = vi.fn();
vi.mock("@/server/integracoes/livro-razao", () => ({
  registrarTentativaInvalida: (...a: unknown[]) => registrarTentativaInvalidaMock(...a),
  reservarEventoWebhook: (...a: unknown[]) => reservarEventoWebhookMock(...a),
}));

const registrarSegmentoDoBotMock = vi.fn();
const registrarEventoParticipanteMock = vi.fn();
const logarTipoDesconhecidoMock = vi.fn();
vi.mock("@/server/copiloto/entrada-bot", () => ({
  registrarSegmentoDoBot: (...a: unknown[]) => registrarSegmentoDoBotMock(...a),
  registrarEventoParticipante: (...a: unknown[]) => registrarEventoParticipanteMock(...a),
  logarTipoDesconhecido: (...a: unknown[]) => logarTipoDesconhecidoMock(...a),
}));

const { POST } = await import("./route");

const SEGREDO = "segredo-de-teste-123";
const URL_BASE = "https://exemplo.com/api/webhooks/copiloto/transcricao";

function montarRequisicao(corpo: unknown, params?: { chave?: string; querystring?: string }): NextRequest {
  const qs = params?.querystring ?? `?k=${encodeURIComponent(params?.chave ?? SEGREDO)}`;
  const corpoTexto = JSON.stringify(corpo);
  return new NextRequest(`${URL_BASE}${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corpoTexto,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.COPILOTO_WEBHOOK_SECRET;
});

const CORPO_TRANSCRIPT = {
  event: "transcript.data",
  data: { bot: { id: "bot_123" }, data: { transcript: "isso é uma fala de teste", words: [{ text: "isso", start_timestamp: 1.5 }] } },
};

describe("POST /api/webhooks/copiloto/transcricao — fail-closed", () => {
  it("sem COPILOTO_WEBHOOK_SECRET devolve 503, nunca aceita", async () => {
    delete process.env.COPILOTO_WEBHOOK_SECRET;
    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT));
    expect(resposta.status).toBe(503);
    expect(reservarEventoWebhookMock).not.toHaveBeenCalled();
  });

  it("chave da querystring errada devolve 401 e registra tentativa inválida", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT, { chave: "chave-errada" }));
    expect(resposta.status).toBe(401);
    expect(registrarTentativaInvalidaMock).toHaveBeenCalledTimes(1);
    expect(reservarEventoWebhookMock).not.toHaveBeenCalled();
  });

  it("sem a query string k= devolve 401", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT, { querystring: "" }));
    expect(resposta.status).toBe(401);
  });
});

describe("POST /api/webhooks/copiloto/transcricao — payload inválido", () => {
  it("JSON quebrado devolve 400, sem tocar no livro-razão", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    const requisicao = new NextRequest(`${URL_BASE}?k=${SEGREDO}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ nao eh json",
    });
    const resposta = await POST(requisicao);
    expect(resposta.status).toBe(400);
    expect(reservarEventoWebhookMock).not.toHaveBeenCalled();
  });

  it("corpo sem data.bot.id devolve 400", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    const resposta = await POST(montarRequisicao({ event: "transcript.data", data: {} }));
    expect(resposta.status).toBe(400);
  });
});

describe("POST /api/webhooks/copiloto/transcricao — tipo desconhecido NUNCA 500", () => {
  it("evento de tipo não mapeado devolve 200 sem efeito, chama logarTipoDesconhecido, NUNCA registrarErro", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-1", reentrega: false });
    supabaseAdminMock.from.mockReturnValue({
      update: () => ({ eq: async () => ({ error: null }) }),
    });

    const resposta = await POST(
      montarRequisicao({ event: "recording.some_new_event_type", data: { bot: { id: "bot_novo" } } }),
    );

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.evento_desconhecido).toBe(true);
    expect(logarTipoDesconhecidoMock).toHaveBeenCalledWith("recording.some_new_event_type", "bot_novo");
    expect(registrarSegmentoDoBotMock).not.toHaveBeenCalled();
    expect(registrarEventoParticipanteMock).not.toHaveBeenCalled();
    // 500 nunca viria daqui, mas o ponto central do aceite é este: nenhuma
    // linha nova em erros_servidor por um tipo de evento desconhecido.
    expect(registrarErroMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/copiloto/transcricao — idempotência", () => {
  it("evento já processado devolve 200 reentrega=true, sem chamar o efeito de novo", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "ja_processado" });

    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT));

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.reentrega).toBe(true);
    expect(registrarSegmentoDoBotMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/copiloto/transcricao — roteamento transcript.data", () => {
  it("chama registrarSegmentoDoBot com o botId do CORPO — nunca um sessao_id", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-2", reentrega: false });
    registrarSegmentoDoBotMock.mockResolvedValue({ situacao: "gravado", segmentoId: "seg-1" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    // Corpo malicioso hipotético: um sessao_id extra não deveria ter efeito
    // nenhum — o handler só lê data.bot.id.
    const resposta = await POST(
      montarRequisicao({ ...CORPO_TRANSCRIPT, sessao_id: "11111111-1111-1111-1111-111111111111" }),
    );

    expect(resposta.status).toBe(200);
    expect(registrarSegmentoDoBotMock).toHaveBeenCalledTimes(1);
    const chamada = registrarSegmentoDoBotMock.mock.calls[0][1] as { botId: string };
    expect(chamada.botId).toBe("bot_123");
  });

  it("sessao_nao_encontrada (bot sem vínculo) devolve 200 com pendência, não 500", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-3", reentrega: false });
    registrarSegmentoDoBotMock.mockResolvedValue({ situacao: "sessao_nao_encontrada" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT));

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.sessao_nao_encontrada).toBe(true);
  });

  // 🔴 Achado do coordenador — "o webhook do bot continua entrando: a porta
  // dos fundos". Cenário NORMAL (última fala em trânsito entre
  // marcarEncerrada e o bot sair da sala): a rota devolve 200 + registro
  // leve, NUNCA 500 (o Recall reentregaria em laço por algo que nunca vira
  // sucesso nem erro de verdade).
  it("🔴 sessao_ja_consolidada (webhook tardio, sessão já teve a transcrição consolidada) devolve 200, NUNCA 500", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-4", reentrega: false });
    registrarSegmentoDoBotMock.mockResolvedValue({ situacao: "sessao_ja_consolidada" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(montarRequisicao(CORPO_TRANSCRIPT));

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.sessao_ja_consolidada).toBe(true);
  });
});

describe("POST /api/webhooks/copiloto/transcricao — roteamento participant_events", () => {
  it("participant_events.join chama registrarEventoParticipante com tipo join", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-4", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.join",
        data: { bot: { id: "bot_123" }, data: { participant: { name: "Terezinha" }, timestamp: "2026-09-11T10:00:00Z" } },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({ botId: "bot_123", tipo: "join", nomeParticipante: "Terezinha" }),
    );
  });

  it("participant_events.leave chama registrarEventoParticipante com tipo leave", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-5", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.leave",
        data: { bot: { id: "bot_123" }, data: { participant: { name: "Terezinha" }, timestamp: "2026-09-11T10:30:00Z" } },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({ botId: "bot_123", tipo: "leave", nomeParticipante: "Terezinha" }),
    );
  });

  // 🔴 CORREÇÃO (15/09/2026) — payload REAL copiado de `webhooks_eventos.bruto`,
  // sessão de 14/09/2026 em produção. Antes desta correção, `timestamp` como
  // OBJETO derrubava o Zod inteiro: 10 join + 5 leave recebidos, 15 com
  // `payload_participant_event_fora_do_formato_esperado`, ZERO sessão com
  // `participantes` preenchido. Este é o teste que faltava.
  const PAYLOAD_REAL_JOIN = {
    event: "participant_events.join",
    data: {
      bot: {
        id: "7e47e544-36fa-4f0e-aee8-6a737e3204ad",
        metadata: { origem: "validacao_2", sessao_id: "755d87d7-0000-0000-0000-000000000000" },
      },
      data: {
        data: null,
        action: "join",
        timestamp: { absolute: "2026-09-14T13:35:02.998220Z", relative: 0.004220018163323402 },
        participant: {
          id: 100,
          name: "João CSM",
          is_host: true,
          platform: "desktop",
          extra_data: { google_meet: { static_participant_id: "xQEPR8rhYr8kXThoPndZqndR9d4a9M_0ZbRVvgV3NRA=" } },
        },
      },
      recording: { id: "rec-1", metadata: {} },
      realtime_endpoint: { id: "rt-1", metadata: {} },
      participant_events: { id: "5893bf01-b7cb-4851-b723-8155c0e7d7a6", metadata: {} },
    },
  };

  it("🔴 payload REAL de produção (timestamp OBJETO, participant.id numérico, is_host, metadata.sessao_id no corpo) é aceito e resolve a sessão SÓ pelo bot.id", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-real-1", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(montarRequisicao(PAYLOAD_REAL_JOIN));

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.payload_invalido).toBeUndefined(); // antes desta correção, isto vinha `true`
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({
        botId: "7e47e544-36fa-4f0e-aee8-6a737e3204ad", // NUNCA metadata.sessao_id do corpo
        tipo: "join",
        nomeParticipante: "João CSM",
        idParticipante: "100",
        isHost: true,
        quando: "2026-09-14T13:35:02.998220Z", // extraído de timestamp.absolute
      }),
    );
  });

  it("🔴 payload REAL de leave (mesmo formato de timestamp/participant)", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-real-2", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const payloadLeave = {
      ...PAYLOAD_REAL_JOIN,
      event: "participant_events.leave",
      data: {
        ...PAYLOAD_REAL_JOIN.data,
        data: {
          ...PAYLOAD_REAL_JOIN.data.data,
          action: "leave",
          timestamp: { absolute: "2026-09-14T13:40:00.000000Z", relative: 297.2 },
        },
      },
    };

    const resposta = await POST(montarRequisicao(payloadLeave));

    expect(resposta.status).toBe(200);
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({ tipo: "leave", quando: "2026-09-14T13:40:00.000000Z" }),
    );
  });

  it("timestamp objeto SÓ com 'relative' (sem 'absolute'): cai no fallback new Date().toISOString(), NUNCA inventa data a partir de 'relative'", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-relative", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const antes = Date.now();
    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.join",
        data: { bot: { id: "bot_123" }, data: { participant: { name: "Terezinha" }, timestamp: { relative: 12.5 } } },
      }),
    );
    const depois = Date.now();

    expect(resposta.status).toBe(200);
    const chamada = registrarEventoParticipanteMock.mock.calls.at(-1)![1] as { quando: string };
    const quandoMs = new Date(chamada.quando).getTime();
    expect(quandoMs).toBeGreaterThanOrEqual(antes);
    expect(quandoMs).toBeLessThanOrEqual(depois);
  });

  it("payload LEGADO (timestamp string/número, sem id/is_host) continua funcionando", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-legado", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.join",
        data: { bot: { id: "bot_123" }, data: { participant: { name: "Terezinha" }, timestamp: 1_757_600_000 } },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({ nomeParticipante: "Terezinha", idParticipante: null, isHost: false }),
    );
  });

  it("name AUSENTE com id PRESENTE: registra o evento (não vira acompanhante decisor — a regra fica em resolverPapelNoJoin)", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-so-id", reentrega: false });
    registrarEventoParticipanteMock.mockResolvedValue({ situacao: "gravado" });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.join",
        data: { bot: { id: "bot_123" }, data: { participant: { id: 42 }, timestamp: "2026-09-15T10:00:00Z" } },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(registrarEventoParticipanteMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({ nomeParticipante: null, idParticipante: "42" }),
    );
  });

  it("🔴 name AUSENTE e id AUSENTE: evento ignorado (200, sem efeito), NUNCA inventa identificação", async () => {
    process.env.COPILOTO_WEBHOOK_SECRET = SEGREDO;
    reservarEventoWebhookMock.mockResolvedValue({ tipo: "processar", id: "evt-sem-nada", reentrega: false });
    supabaseAdminMock.from.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });

    const resposta = await POST(
      montarRequisicao({
        event: "participant_events.join",
        data: { bot: { id: "bot_123" }, data: { participant: {}, timestamp: "2026-09-15T10:00:00Z" } },
      }),
    );

    expect(resposta.status).toBe(200);
    const json = await resposta.json();
    expect(json.sem_identificacao).toBe(true);
    expect(registrarEventoParticipanteMock).not.toHaveBeenCalled();
  });
});
