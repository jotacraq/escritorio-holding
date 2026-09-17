import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do adaptador Zoom OAuth/ZAK — bot autenticado no Zoom (17/09/2026,
 * docs.recall.ai/docs/zoom-signed-in-bots). Fornecedor SEMPRE mockado —
 * nenhuma chamada real à API do Zoom nem da Recall.
 */

const registrarErroMock = vi.fn();
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const {
  zoomOAuthConfigurado,
  montarUrlAutorizacaoZoom,
  trocarCodigoPorCredencialRecall,
  obterZak,
  montarZakUrlComSegredo,
  zakWebhookConfigurado,
  linkEhZoom,
} = await import("./zoom");

function limparEnvs() {
  delete process.env.ZOOM_CLIENT_ID;
  delete process.env.ZOOM_CLIENT_SECRET;
  delete process.env.RECALL_API_KEY;
  delete process.env.RECALL_ZOOM_OAUTH_APP_ID;
  delete process.env.ZOOM_ZAK_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
}

function configurarEnvsCompletas() {
  process.env.ZOOM_CLIENT_ID = "client-id-teste";
  process.env.ZOOM_CLIENT_SECRET = "client-secret-teste";
  process.env.RECALL_API_KEY = "recall-key-teste";
  process.env.RECALL_ZOOM_OAUTH_APP_ID = "recall-app-id-teste";
}

afterEach(() => {
  vi.unstubAllGlobals();
  registrarErroMock.mockReset();
  limparEnvs();
});

describe("zoomOAuthConfigurado", () => {
  it("falso sem nenhuma env", () => {
    limparEnvs();
    expect(zoomOAuthConfigurado()).toBe(false);
  });

  it("falso faltando só RECALL_ZOOM_OAUTH_APP_ID (as 4 são obrigatórias juntas)", () => {
    configurarEnvsCompletas();
    delete process.env.RECALL_ZOOM_OAUTH_APP_ID;
    expect(zoomOAuthConfigurado()).toBe(false);
  });

  it("verdadeiro com as 4 envs presentes", () => {
    configurarEnvsCompletas();
    expect(zoomOAuthConfigurado()).toBe(true);
  });
});

describe("montarUrlAutorizacaoZoom", () => {
  it("null sem ZOOM_CLIENT_ID", () => {
    limparEnvs();
    expect(montarUrlAutorizacaoZoom()).toBeNull();
  });

  it("monta a URL de autorização do Zoom com response_type=code e o redirect_uri do callback", () => {
    configurarEnvsCompletas();
    const url = montarUrlAutorizacaoZoom();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-id-teste");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://escritorio.grupoparticipa.app.br/api/integracoes/zoom/callback");
  });
});

describe("trocarCodigoPorCredencialRecall", () => {
  it("nao_configurado sem envs, sem chamar fetch", async () => {
    limparEnvs();
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await trocarCodigoPorCredencialRecall("code-123");

    expect(resultado).toEqual({ situacao: "nao_configurado" });
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("envia oauth_app e authorization_code{code,redirect_uri} exatamente como a doc da Recall", async () => {
    configurarEnvsCompletas();
    const fetchEspiao = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: "cred_1" }) });
    vi.stubGlobal("fetch", fetchEspiao);

    await trocarCodigoPorCredencialRecall("code-123");

    const [url, init] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us-east-1.recall.ai/api/v2/zoom-oauth-credentials/");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Token recall-key-teste");
    const corpo = JSON.parse(init.body as string);
    expect(corpo).toEqual({
      oauth_app: "recall-app-id-teste",
      authorization_code: { code: "code-123", redirect_uri: "https://escritorio.grupoparticipa.app.br/api/integracoes/zoom/callback" },
    });
  });

  it("devolve criada com o credential_id da resposta", async () => {
    configurarEnvsCompletas();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: "cred_abc" }) }));

    const resultado = await trocarCodigoPorCredencialRecall("code-123");

    expect(resultado).toEqual({ situacao: "criada", credentialId: "cred_abc" });
  });

  it("falha_provedor quando a Recall responde erro", async () => {
    configurarEnvsCompletas();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify(["Received error from Zoom while retrieving refresh token."]) }));

    const resultado = await trocarCodigoPorCredencialRecall("code-123");

    expect(resultado).toEqual({ situacao: "falha_provedor", detalhe: "recall_400" });
    expect(registrarErroMock).toHaveBeenCalled();
  });
});

describe("obterZak", () => {
  it("nao_configurado sem envs, sem chamar fetch", async () => {
    limparEnvs();
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await obterZak("cred_1");

    expect(resultado).toEqual({ situacao: "nao_configurado" });
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("busca access-token na Recall e depois o zak no Zoom com Bearer", async () => {
    configurarEnvsCompletas();
    const fetchEspiao = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at-123" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: "zak-xyz" }) });
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await obterZak("cred_1");

    expect(resultado).toEqual({ situacao: "obtido", zak: "zak-xyz" });
    const [urlToken, initToken] = fetchEspiao.mock.calls[0] as [string, RequestInit];
    expect(urlToken).toBe("https://us-east-1.recall.ai/api/v2/zoom-oauth-credentials/cred_1/access-token/");
    expect((initToken.headers as Record<string, string>).Authorization).toBe("Token recall-key-teste");

    const [urlZak, initZak] = fetchEspiao.mock.calls[1] as [string, RequestInit];
    expect(urlZak).toBe("https://api.zoom.us/v2/users/me/zak");
    expect((initZak.headers as Record<string, string>).Authorization).toBe("Bearer at-123");
  });

  it("sem_credencial quando a Recall devolve 404 no access-token (credencial revogada/apagada)", async () => {
    configurarEnvsCompletas();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    const resultado = await obterZak("cred_1");

    expect(resultado).toEqual({ situacao: "sem_credencial" });
  });

  it("falha_provedor quando o Zoom recusa o access token", async () => {
    configurarEnvsCompletas();
    const fetchEspiao = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "at-123" }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchEspiao);

    const resultado = await obterZak("cred_1");

    expect(resultado).toEqual({ situacao: "falha_provedor", detalhe: "zoom_401" });
  });
});

describe("montarZakUrlComSegredo / zakWebhookConfigurado", () => {
  it("null e falso sem ZOOM_ZAK_WEBHOOK_SECRET", () => {
    delete process.env.ZOOM_ZAK_WEBHOOK_SECRET;
    expect(zakWebhookConfigurado()).toBe(false);
    expect(montarZakUrlComSegredo()).toBeNull();
  });

  it("com o secret, devolve a URL do zak com ?k=<segredo>", () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-zak";
    expect(zakWebhookConfigurado()).toBe(true);
    expect(montarZakUrlComSegredo()).toBe("https://escritorio.grupoparticipa.app.br/api/integracoes/zoom/zak?k=segredo-zak");
  });
});

describe("linkEhZoom", () => {
  it("verdadeiro para zoom.us e subdomínios", () => {
    expect(linkEhZoom("https://zoom.us/j/123456789")).toBe(true);
    expect(linkEhZoom("https://us02web.zoom.us/j/123456789")).toBe(true);
  });

  it("falso para Meet e links inválidos", () => {
    expect(linkEhZoom("https://meet.google.com/abc-defg-hij")).toBe(false);
    expect(linkEhZoom("não é uma url")).toBe(false);
  });
});
