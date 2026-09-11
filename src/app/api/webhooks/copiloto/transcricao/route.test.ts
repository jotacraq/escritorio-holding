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
});
