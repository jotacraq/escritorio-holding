import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do adaptador Recall.ai — Fase 10, Fatia 4a (§8/§12 do plano:
 * aceite exige retention explícito, bot_detection.matches explícito, 400
 * bot_command_error NÃO virando erros_servidor, e sub_code de sala
 * inexistente chegando ao chamador). Fornecedor SEMPRE mockado — nenhuma
 * chamada real à API do Recall.
 */

const registrarErroMock = vi.fn();
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const { pedirBot, encerrarBot, encerrarBotComRetentativa, recallConfigurado, copilotoWebhookConfigurado, montarWebhookUrlComSegredo } =
  await import("./recall");

const PARAMS_BASE = {
  sessaoId: "11111111-1111-1111-1111-111111111111",
  linkSala: "https://zoom.us/j/123",
  nomeBot: "Assistente — Escritório Elaine Montenegro",
  webhookUrl: "https://exemplo.com/api/webhooks/copiloto/transcricao?k=segredo",
  retention: { type: "timed", hours: 24 } as const,
  automaticLeave: { waitingRoomTimeoutS: 300, noOneJoinedTimeoutS: 300, silenceDetectionS: 600 },
  botDetectionMatches: ["Notetaker", "Outro Assistente"],
};

function mockFetchOk(corpo: unknown, status = 201) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  registrarErroMock.mockReset();
  delete process.env.RECALL_API_KEY;
  delete process.env.COPILOTO_WEBHOOK_SECRET;
});

describe("montarWebhookUrlComSegredo", () => {
  it("null sem COPILOTO_WEBHOOK_SECRET configurado", () => {
    delete process.env.COPILOTO_WEBHOOK_SECRET;
    expect(copilotoWebhookConfigurado()).toBe(false);
    expect(montarWebhookUrlComSegredo()).toBeNull();
  });

  it("com o secret, devolve a URL do webhook com ?k=<segredo>", () => {
    process.env.COPILOTO_WEBHOOK_SECRET = "segredo-abc";
    expect(copilotoWebhookConfigurado()).toBe(true);
    const url = montarWebhookUrlComSegredo();
    expect(url).not.toBeNull();
    expect(url).toContain("/api/webhooks/copiloto/transcricao?k=segredo-abc");
  });
});

describe("recallConfigurado", () => {
  it("falso sem RECALL_API_KEY", () => {
    delete process.env.RECALL_API_KEY;
    expect(recallConfigurado()).toBe(false);
  });

  it("verdadeiro com a chave presente", () => {
    process.env.RECALL_API_KEY = "chave-teste";
    expect(recallConfigurado()).toBe(true);
  });
});

describe("pedirBot — corpo enviado ao fornecedor", () => {
  it("nao_configurado sem RECALL_API_KEY, sem chamar fetch", async () => {
    delete process.env.RECALL_API_KEY;
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado).toEqual({ situacao: "nao_configurado" });
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("usa header Authorization: Token <chave>, NÃO Bearer", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Token chave-teste");
    expect(headers.Authorization).not.toMatch(/^Bearer/);
  });

  it("chama a URL base us-east-1 com POST /bot/", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [url, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us-east-1.recall.ai/api/v1/bot/");
    expect(init.method).toBe("POST");
  });

  // Aceite do plano (§8/§12): "teste provando que o corpo enviado ao Recall
  // contém retention explícito".
  it("o corpo enviado contém retention EXPLÍCITO, igual ao parâmetro recebido", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot({ ...PARAMS_BASE, retention: { type: "timed", hours: 72 } });

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    // 🔴 17/09: DENTRO de `recording_config`, com `timed`/`hours`. O formato
    // antigo (`retention` na raiz, `type:"days"`) era recusado com 400 pela
    // API viva — e este teste passava mesmo assim, porque afirmava contra o
    // mock o mesmo formato errado que o código enviava. Teste que copia a
    // implementação não prova contrato: prova que os dois concordam.
    expect(corpo.recording_config.retention).toEqual({ type: "timed", hours: 72 });
    expect(corpo.retention).toBeUndefined();
  });

  // Aceite do plano: "teste provando bot_detection.matches explícito".
  it("o corpo enviado contém bot_detection.matches EXPLÍCITO, sem o nome do nosso bot", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    expect(corpo.bot_detection.using_participant_events.matches).toEqual(["Notetaker", "Outro Assistente"]);
    expect(corpo.bot_detection.using_participant_events.matches).not.toContain(PARAMS_BASE.nomeBot);
  });

  // Bot autenticado no Zoom (17/09/2026, docs.recall.ai/docs/zoom-signed-in-bots).
  it("com zakUrl, o corpo enviado contém zoom.zak_url EXATAMENTE o valor recebido", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot({ ...PARAMS_BASE, zakUrl: "https://exemplo.com/api/integracoes/zoom/zak?k=segredo" });

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    expect(corpo.zoom).toEqual({ zak_url: "https://exemplo.com/api/integracoes/zoom/zak?k=segredo" });
  });

  it("sem zakUrl (bot de Meet), o corpo enviado NÃO tem a chave zoom", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    expect(Object.prototype.hasOwnProperty.call(corpo, "zoom")).toBe(false);
  });

  it("o corpo enviado contém automatic_leave com valores NOSSOS, não os defaults do fornecedor", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    expect(corpo.automatic_leave).toEqual({
      waiting_room_timeout: 300,
      noone_joined_timeout: 300,
      silence_detection: { timeout: 600 },
    });
  });

  it("o corpo pede transcrição pt-BR do fornecedor (NÃO a legenda da plataforma) e nunca audio_url", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "bot_1", status_changes: [], recordings: [], retention: { type: "timed", hours: 24 } }),
    });
    vi.stubGlobal("fetch", fetchEspiao);

    await pedirBot(PARAMS_BASE);

    const [, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    // 🔴 MEDIDO em produção 14/09: `meeting_captions` depende do CC estar ligado
    // na reunião — o bot grava sem gerar texto, e o sintoma é SILÊNCIO. E
    // `assembly_ai_v3_streaming` só aceita `en`/`multi`, o que devolveu
    // "natural de trabalho da tijuca" onde o Deepgram pt-BR devolveu
    // "sou natural da Tijuca". Português dedicado não é preferência: a IA cita
    // evidência LITERAL, e isto vira o insumo do Agente do Croqui.
    expect(corpo.recording_config.transcript.provider).toEqual({
      deepgram_streaming: { model: "nova-2", language: "pt-BR", punctuate: true, smart_format: true },
    });
    expect(corpo.recording_config.transcript.provider.meeting_captions).toBeUndefined();
    expect(corpo.audio_url).toBeUndefined();
    expect(corpo.recording_config.realtime_endpoints).toEqual([
      { type: "webhook", url: PARAMS_BASE.webhookUrl, events: ["transcript.data", "participant_events.join", "participant_events.leave"] },
    ]);
  });
});

describe("pedirBot — retenção infinita detectada (§4.2.1)", () => {
  // 🔴 17/09: o caso REAL. A API devolve a retenção dentro de
  // `recording_config`, não na raiz — e a trava do §4.2.1 lia só a raiz,
  // então via `undefined`, concluía "não é forever" e deixava passar um bot
  // com retenção indefinida gravando uma sessão de família. O teste antigo
  // (abaixo, com o campo na raiz) passava e não provava nada sobre a
  // resposta de verdade.
  it("forever DENTRO de recording_config tambem dispara o encerramento", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchEspiao = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: "bot_aninhado",
          status_changes: [],
          recordings: [],
          recording_config: { retention: { type: "forever" } },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado).toEqual({
      situacao: "retencao_infinita_detectada",
      botId: "bot_aninhado",
      encerramentoConfirmado: true,
    });
  });

  it("retention.type==='forever' na resposta encerra o bot com SUCESSO e devolve encerramentoConfirmado:true", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchMock = vi
      .fn()
      // 1ª chamada: POST /bot/ — devolve forever apesar do pedido.
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "bot_forever", status_changes: [], recordings: [], retention: { type: "forever" } }),
      })
      // 2ª chamada: encerrarBotComRetentativa, 1ª tentativa, sucesso.
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado).toEqual({ situacao: "retencao_infinita_detectada", botId: "bot_forever", encerramentoConfirmado: true });
    // 2 chamadas: criação + encerramento automático (sucesso na 1ª tentativa).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [urlEncerrar, initEncerrar] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(urlEncerrar).toBe("https://us-east-1.recall.ai/api/v1/bot/bot_forever/leave_call/");
    expect(initEncerrar.method).toBe("POST");
  });

  // 🔴 Aceite do achado 4 (Fable, B76): quando o encerramento FALHA de
  // verdade (mesmo com retentativa), o chamador tem de saber — nunca
  // assumir sucesso silenciosamente.
  it("retention.type==='forever' MAS encerrarBot falha 2x: encerramentoConfirmado:false, nunca finge sucesso", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "bot_forever_preso", status_changes: [], recordings: [], retention: { type: "forever" } }),
      })
      // 1ª tentativa de encerrar: falha de rede/HTTP real.
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      // 2ª tentativa (retentativa): falha de novo.
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado).toEqual({ situacao: "retencao_infinita_detectada", botId: "bot_forever_preso", encerramentoConfirmado: false });
    // 3 chamadas: criação + 2 tentativas de encerrar.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("encerrarBotComRetentativa — achado 4 do Fable (B76)", () => {
  it("1ª tentativa tem sucesso: devolve sucesso:true SEM tentar de novo", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await encerrarBotComRetentativa("bot_1");

    expect(resultado).toEqual({ sucesso: true, situacao: "encerrado" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("1ª tentativa falha, 2ª (retentativa) tem sucesso: sucesso:true, 2 chamadas", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await encerrarBotComRetentativa("bot_2");

    expect(resultado).toEqual({ sucesso: true, situacao: "encerrado" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("AS DUAS tentativas falham: sucesso:false com detalhe, e registra erro (falha definitiva não é silenciosa)", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

    const resultado = await encerrarBotComRetentativa("bot_3");

    expect(resultado.sucesso).toBe(false);
    if (!resultado.sucesso) expect(resultado.detalhe).toContain("recall_503");
    expect(registrarErroMock).toHaveBeenCalledWith(
      "copiloto/recall.encerrarBotComRetentativa#falha_definitiva",
      expect.any(Error),
      expect.objectContaining({ bot_id: "bot_3" }),
    );
  });

  it("400 bot_command_error na 1ª tentativa já É sucesso (já tinha saído) — nunca tenta de novo", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: "bot_command_error" }) });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await encerrarBotComRetentativa("bot_4");

    expect(resultado).toEqual({ sucesso: true, situacao: "ja_tinha_saido" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pedirBot — sala inexistente chega com sub_code (§4.2.2)", () => {
  it("status_changes com code=fatal devolve sala_invalida com o sub_code do fornecedor, não erro genérico", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    mockFetchOk({
      id: "bot_2",
      status_changes: [
        { code: "joining_call", sub_code: null, created_at: "2026-09-11T10:00:00Z" },
        { code: "fatal", sub_code: "meeting_not_found", created_at: "2026-09-11T10:00:00.2Z" },
      ],
      recordings: [],
      retention: { type: "timed", hours: 24 },
    });

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado).toEqual({ situacao: "sala_invalida", subCodigo: "meeting_not_found", codigo: "fatal" });
  });
});

describe("pedirBot — criado com sucesso", () => {
  it("devolve o id do bot e os status_changes/recordings da resposta", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    mockFetchOk({
      id: "bot_ok",
      status_changes: [{ code: "in_call_recording", sub_code: null, created_at: "2026-09-11T10:00:01Z" }],
      recordings: [{ id: "rec_1" }],
      retention: { type: "timed", hours: 24 },
    });

    const resultado = await pedirBot(PARAMS_BASE);

    expect(resultado.situacao).toBe("criado");
    if (resultado.situacao === "criado") {
      expect(resultado.botId).toBe("bot_ok");
      expect(resultado.recordings).toEqual([{ id: "rec_1" }]);
    }
  });
});

describe("encerrarBot — 400 bot_command_error é estado esperado (§4.2.2)", () => {
  it("bot já saiu: devolve ja_tinha_saido e NUNCA chama registrarErro", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: "bot_command_error" }) }),
    );

    const resultado = await encerrarBot("bot_ja_saiu");

    expect(resultado).toEqual({ situacao: "ja_tinha_saido" });
    expect(registrarErroMock).not.toHaveBeenCalled();
  });

  it("outro 400 (não bot_command_error) É falha real e registra erro", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: "outro_erro_qualquer" }) }),
    );

    const resultado = await encerrarBot("bot_x");

    expect(resultado.situacao).toBe("falha_provedor");
    expect(registrarErroMock).toHaveBeenCalledTimes(1);
  });

  it("sucesso (200) devolve encerrado", async () => {
    process.env.RECALL_API_KEY = "chave-teste";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    const resultado = await encerrarBot("bot_y");

    expect(resultado).toEqual({ situacao: "encerrado" });
    expect(registrarErroMock).not.toHaveBeenCalled();
  });

  it("nao_configurado sem RECALL_API_KEY, sem chamar fetch", async () => {
    delete process.env.RECALL_API_KEY;
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await encerrarBot("bot_z");

    expect(resultado).toEqual({ situacao: "nao_configurado" });
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
