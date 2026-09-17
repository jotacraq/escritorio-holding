import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER de `GET /api/integracoes/zoom/zak` — a URL que a Recall
 * chama para obter o ZAK (bot autenticado no Zoom, 17/09/2026). Sem sessão
 * de usuário: autenticação só pelo `?k=` em tempo constante, mesmo padrão do
 * webhook de transcrição.
 */

const registrarErroMock = vi.fn();
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const obterZakMock = vi.fn();
const zakWebhookConfiguradoMock = vi.fn();
vi.mock("@/server/integracoes/zoom", () => ({
  obterZak: (...a: unknown[]) => obterZakMock(...a),
  zakWebhookConfigurado: (...a: unknown[]) => zakWebhookConfiguradoMock(...a),
}));

const { GET } = await import("./route");

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  Object.assign(builder, { select: encadeavel, eq: encadeavel, maybeSingle: async () => resultado });
  return builder;
}

function requisicao(query: string) {
  return new Request(`http://localhost/api/integracoes/zoom/zak${query}`) as never;
}

afterEach(() => {
  registrarErroMock.mockReset();
  supabaseAdminMock.from.mockReset();
  obterZakMock.mockReset();
  zakWebhookConfiguradoMock.mockReset();
  delete process.env.ZOOM_ZAK_WEBHOOK_SECRET;
});

describe("GET /api/integracoes/zoom/zak", () => {
  it("503 sem ZOOM_ZAK_WEBHOOK_SECRET configurado — fail-closed, nunca aceita", async () => {
    zakWebhookConfiguradoMock.mockReturnValue(false);

    const resposta = await GET(requisicao("?k=qualquer"));

    expect(resposta.status).toBe(503);
    expect(await resposta.text()).toBe("servico_indisponivel");
    expect(obterZakMock).not.toHaveBeenCalled();
  });

  it("401 com ?k= errado, comparação em tempo constante — nunca chega a ler o banco", async () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-correto";
    zakWebhookConfiguradoMock.mockReturnValue(true);

    const resposta = await GET(requisicao("?k=segredo-errado"));

    expect(resposta.status).toBe(401);
    expect(await resposta.text()).toBe("nao_autorizado");
    expect(supabaseAdminMock.from).not.toHaveBeenCalled();
    expect(obterZakMock).not.toHaveBeenCalled();
  });

  it("401 sem ?k= nenhum", async () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-correto";
    zakWebhookConfiguradoMock.mockReturnValue(true);

    const resposta = await GET(requisicao(""));

    expect(resposta.status).toBe(401);
  });

  it("404 conta_zoom_nao_autorizada quando não há credencial gravada", async () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-correto";
    zakWebhookConfiguradoMock.mockReturnValue(true);
    supabaseAdminMock.from.mockReturnValue(consultaEncadeavel({ data: { recall_credential_id: null }, error: null }));

    const resposta = await GET(requisicao("?k=segredo-correto"));

    expect(resposta.status).toBe(404);
    expect(await resposta.text()).toBe("conta_zoom_nao_autorizada");
    expect(obterZakMock).not.toHaveBeenCalled();
  });

  it("200 texto puro (nunca JSON) com o ZAK, content-type text/plain", async () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-correto";
    zakWebhookConfiguradoMock.mockReturnValue(true);
    supabaseAdminMock.from.mockReturnValue(consultaEncadeavel({ data: { recall_credential_id: "cred_1" }, error: null }));
    obterZakMock.mockResolvedValue({ situacao: "obtido", zak: "zak-token-xyz" });

    const resposta = await GET(requisicao("?k=segredo-correto"));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toMatch(/^text\/plain/);
    const corpo = await resposta.text();
    expect(corpo).toBe("zak-token-xyz");
    // Nunca um envelope JSON — a Recall repassa o corpo cru ao Zoom.
    expect(() => JSON.parse(corpo)).toThrow();
  });

  it("502 falha_provedor quando obterZak falha", async () => {
    process.env.ZOOM_ZAK_WEBHOOK_SECRET = "segredo-correto";
    zakWebhookConfiguradoMock.mockReturnValue(true);
    supabaseAdminMock.from.mockReturnValue(consultaEncadeavel({ data: { recall_credential_id: "cred_1" }, error: null }));
    obterZakMock.mockResolvedValue({ situacao: "falha_provedor", detalhe: "recall_500" });

    const resposta = await GET(requisicao("?k=segredo-correto"));

    expect(resposta.status).toBe(502);
  });
});
