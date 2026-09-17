import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER de `GET /api/integracoes/zoom/callback` — bot autenticado
 * no Zoom (17/09/2026). Contrato não negociável: responde 200 mesmo ANTES de
 * existir credencial e mesmo sem `?code=` — o Zoom valida a redirect URL ao
 * cadastrar o app, e uma 404 nessa validação foi o defeito real visto hoje.
 */

const registrarErroMock = vi.fn();
vi.mock("@/server/erros", () => ({ registrarErro: (...a: unknown[]) => registrarErroMock(...a) }));

const usuarioAtualMock = vi.fn();
vi.mock("@/server/auth", () => ({ usuarioAtual: (...a: unknown[]) => usuarioAtualMock(...a) }));

const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const trocarCodigoPorCredencialRecallMock = vi.fn();
const zoomOAuthConfiguradoMock = vi.fn();
vi.mock("@/server/integracoes/zoom", () => ({
  trocarCodigoPorCredencialRecall: (...a: unknown[]) => trocarCodigoPorCredencialRecallMock(...a),
  zoomOAuthConfigurado: (...a: unknown[]) => zoomOAuthConfiguradoMock(...a),
}));

const { GET } = await import("./route");

function requisicao(query: string) {
  return new Request(`http://localhost/api/integracoes/zoom/callback${query}`) as never;
}

function upsertEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  builder.upsert = async () => resultado;
  return builder;
}

afterEach(() => {
  registrarErroMock.mockReset();
  usuarioAtualMock.mockReset();
  supabaseAdminMock.from.mockReset();
  trocarCodigoPorCredencialRecallMock.mockReset();
  zoomOAuthConfiguradoMock.mockReset();
});

describe("GET /api/integracoes/zoom/callback", () => {
  it("200 sem ?code= — validação da redirect URL pelo Zoom, NUNCA 404", async () => {
    const resposta = await GET(requisicao(""));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toMatch(/^text\/html/);
    expect(usuarioAtualMock).not.toHaveBeenCalled();
  });

  it("200 sem usuário logado — mensagem clara, nunca 401 cru (o Zoom não interpretaria)", async () => {
    usuarioAtualMock.mockResolvedValue(null);

    const resposta = await GET(requisicao("?code=abc123"));

    expect(resposta.status).toBe(200);
    const html = await resposta.text();
    expect(html).toMatch(/login/i);
  });

  it("503 servico_indisponivel sem as envs configuradas", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "u1", papel: "admin", email: "admin@exemplo.com" });
    zoomOAuthConfiguradoMock.mockReturnValue(false);

    const resposta = await GET(requisicao("?code=abc123"));

    expect(resposta.status).toBe(503);
    expect(trocarCodigoPorCredencialRecallMock).not.toHaveBeenCalled();
  });

  it("grava o credential_id em integracoes_zoom e devolve 200 de sucesso", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "u1", papel: "admin", email: "admin@exemplo.com" });
    zoomOAuthConfiguradoMock.mockReturnValue(true);
    trocarCodigoPorCredencialRecallMock.mockResolvedValue({ situacao: "criada", credentialId: "cred_novo" });
    const upsertSpy = vi.fn(async () => ({ error: null }));
    supabaseAdminMock.from.mockReturnValue({ upsert: upsertSpy });

    const resposta = await GET(requisicao("?code=abc123"));

    expect(resposta.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, recall_credential_id: "cred_novo", autorizado_por_email: "admin@exemplo.com" }),
      expect.objectContaining({ onConflict: "id" }),
    );
    const html = await resposta.text();
    expect(html).toMatch(/autorizad/i);
  });

  it("500 quando a troca deu certo mas o upsert falha — avisa para não usar o bot em Zoom ainda", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "u1", papel: "admin", email: "admin@exemplo.com" });
    zoomOAuthConfiguradoMock.mockReturnValue(true);
    trocarCodigoPorCredencialRecallMock.mockResolvedValue({ situacao: "criada", credentialId: "cred_novo" });
    supabaseAdminMock.from.mockReturnValue(upsertEncadeavel({ error: { message: "erro simulado" } }));

    const resposta = await GET(requisicao("?code=abc123"));

    expect(resposta.status).toBe(500);
  });

  it("502 quando a troca com a Recall falha", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "u1", papel: "admin", email: "admin@exemplo.com" });
    zoomOAuthConfiguradoMock.mockReturnValue(true);
    trocarCodigoPorCredencialRecallMock.mockResolvedValue({ situacao: "falha_provedor", detalhe: "recall_400" });

    const resposta = await GET(requisicao("?code=abc123"));

    expect(resposta.status).toBe(502);
  });
});
