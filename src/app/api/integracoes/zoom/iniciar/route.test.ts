import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER de `GET /api/integracoes/zoom/iniciar` — bot autenticado
 * no Zoom (17/09/2026).
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...args: unknown[]) => exigirVePatrimonioMock(...args) }));

const { ErroApi } = await import("@/server/erros");

const zoomOAuthConfiguradoMock = vi.fn();
const montarUrlAutorizacaoZoomMock = vi.fn();
vi.mock("@/server/integracoes/zoom", () => ({
  zoomOAuthConfigurado: (...a: unknown[]) => zoomOAuthConfiguradoMock(...a),
  montarUrlAutorizacaoZoom: (...a: unknown[]) => montarUrlAutorizacaoZoomMock(...a),
}));

const { GET } = await import("./route");

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  zoomOAuthConfiguradoMock.mockReset();
  montarUrlAutorizacaoZoomMock.mockReset();
});

describe("GET /api/integracoes/zoom/iniciar", () => {
  it("503 servico_indisponivel sem as envs configuradas — nunca tenta montar URL", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "admin" });
    zoomOAuthConfiguradoMock.mockReturnValue(false);

    const resposta = await GET();

    expect(resposta.status).toBe(503);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("servico_indisponivel");
    expect(montarUrlAutorizacaoZoomMock).not.toHaveBeenCalled();
  });

  it("redireciona (302) para a URL de autorização quando configurado", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "admin" });
    zoomOAuthConfiguradoMock.mockReturnValue(true);
    montarUrlAutorizacaoZoomMock.mockReturnValue("https://zoom.us/oauth/authorize?response_type=code&client_id=x&redirect_uri=y");

    const resposta = await GET();

    expect(resposta.status).toBe(302);
    expect(resposta.headers.get("location")).toBe("https://zoom.us/oauth/authorize?response_type=code&client_id=x&redirect_uri=y");
  });

  it("propaga a recusa de exigirVePatrimonio (sem admin/advogada)", async () => {
    exigirVePatrimonioMock.mockRejectedValue(new ErroApi(403, "sem_permissao", "sem permissão"));

    const resposta = await GET();

    expect(resposta.status).toBe(403);
  });
});
