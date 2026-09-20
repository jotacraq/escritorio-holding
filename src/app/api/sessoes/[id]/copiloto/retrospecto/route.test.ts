import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/sessoes/[id]/copiloto/retrospecto` — Fase 13, BE-4.
 *
 * Testa só a TRADUÇÃO HTTP e as TRAVAS. A montagem/leitura tem teste próprio
 * em `server/copiloto/retrospecto.test.ts`.
 *
 * O que este arquivo prova, item a item do critério de aceite:
 *   1. `exigirVePatrimonio()` é chamado ANTES de qualquer leitura.
 *   2. Kill-switch duplo, os dois fail-closed.
 *   3. Sem retrospecto → **404 com código**, nunca 200 com corpo vazio.
 *   4. `?formato=docx` → `Content-Disposition: attachment` com `filename` E
 *      `filename*=UTF-8''`, e SEM nome de cliente (PII) no nome do arquivo.
 *   5. A leitura usa o cliente COM SESSÃO (RLS decide), nunca o admin.
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...a: unknown[]) => exigirVePatrimonioMock(...a) }));

const supabaseServidorMock = { from: vi.fn(), marcador: "COM_SESSAO" };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));

// `criarClienteAdmin` existe SÓ para a remontagem (D-2), que ESCREVE. Nenhuma
// LEITURA pode usá-lo — os testes abaixo afirmam que `lerRetrospectoComEstado`
// recebe sempre o cliente COM SESSÃO (se recebesse este, service_role
// ignoraria a RLS e a URL viraria a única trava: padrão de IDOR).
const supabaseAdminMock = { from: vi.fn(), marcador: "SERVICE_ROLE" };
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const copilotoEstaAtivoMock = vi.fn();
vi.mock("@/server/copiloto/config", () => ({ copilotoEstaAtivo: (...a: unknown[]) => copilotoEstaAtivoMock(...a) }));

const lerRetrospectoMock = vi.fn();
const remontarMock = vi.fn();
const retrospectoEstaAtivoMock = vi.fn();
const montarDocxMock = vi.fn();
vi.mock("@/server/copiloto/retrospecto", () => ({
  lerRetrospectoComEstado: (...a: unknown[]) => lerRetrospectoMock(...a),
  remontarRetrospectoSeEncerrada: (...a: unknown[]) => remontarMock(...a),
  retrospectoEstaAtivo: (...a: unknown[]) => retrospectoEstaAtivoMock(...a),
  montarDocxRetrospecto: (...a: unknown[]) => montarDocxMock(...a),
  MIME_DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}));

const { GET } = await import("./route");

const SESSAO_ID = "11111111-1111-4111-8111-111111111111";
const PARAMS = { params: Promise.resolve({ id: SESSAO_ID }) };

function requisicao(query = "") {
  const url = `http://localhost/api/sessoes/${SESSAO_ID}/copiloto/retrospecto${query}`;
  return Object.assign(new Request(url), { nextUrl: new URL(url) }) as never;
}

const RETROSPECTO = {
  sessao_id: SESSAO_ID,
  jornada_id: "j1",
  origem: "derivado",
  schema_versao: 1,
  blocos_com_atividade: 9,
  blocos_no_roteiro: 13,
  conteudo: { versao: 1 },
  evidencias_redigidas_em: null,
  criado_em: "2026-09-19T20:00:00.000Z",
};

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  copilotoEstaAtivoMock.mockReset();
  lerRetrospectoMock.mockReset();
  remontarMock.mockReset();
  supabaseAdminMock.from.mockReset();
  retrospectoEstaAtivoMock.mockReset();
  montarDocxMock.mockReset();
});

function autorizado() {
  exigirVePatrimonioMock.mockResolvedValue({ id: "perfil-1", papel: "advogada" });
  copilotoEstaAtivoMock.mockResolvedValue(true);
  retrospectoEstaAtivoMock.mockResolvedValue(true);
  remontarMock.mockResolvedValue(null); // D-2 desligada por padrão nos testes antigos
}

describe("GET .../copiloto/retrospecto — travas", () => {
  it("🔴 sem permissão de patrimônio → 403 e ZERO leitura do retrospecto", async () => {
    const { ErroApi } = await import("@/server/erros");
    exigirVePatrimonioMock.mockRejectedValue(new ErroApi(403, "sem_permissao", "Sem permissão."));

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(403);
    expect(lerRetrospectoMock).not.toHaveBeenCalled();
  });

  it("copiloto_sessao.ativo=false → 409 copiloto_desligado, ZERO leitura", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "perfil-1", papel: "advogada" });
    copilotoEstaAtivoMock.mockResolvedValue(false);

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("copiloto_desligado");
    expect(lerRetrospectoMock).not.toHaveBeenCalled();
  });

  it("🔴 retrospecto_ativo=false (ou chave ausente — fail-closed) → 409 retrospecto_desligado, ZERO leitura", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "perfil-1", papel: "advogada" });
    copilotoEstaAtivoMock.mockResolvedValue(true);
    retrospectoEstaAtivoMock.mockResolvedValue(false);

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("retrospecto_desligado");
    expect(lerRetrospectoMock).not.toHaveBeenCalled();
  });

  it("id que não é uuid → 422, sem tocar no banco", async () => {
    autorizado();
    const resposta = await GET(requisicao(), { params: Promise.resolve({ id: "nao-e-uuid" }) });
    expect(resposta.status).toBe(422);
    expect(lerRetrospectoMock).not.toHaveBeenCalled();
  });

  it("🔴 a leitura usa o cliente COM SESSÃO (RLS decide), nunca service_role", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });

    await GET(requisicao(), PARAMS);
    expect(lerRetrospectoMock).toHaveBeenCalledWith(supabaseServidorMock, SESSAO_ID);
  });
});

describe("GET .../copiloto/retrospecto — JSON", () => {
  it("🔴 sem retrospecto → 404 COM CÓDIGO `retrospecto_nao_encontrado`, nunca 200 com corpo vazio", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(null); // sessão não encerrada → não remonta

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe("retrospecto_nao_encontrado");
  });

  it("com retrospecto → 200 com o documento inteiro e sem cache", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(RETROSPECTO);
    expect(resposta.headers.get("Cache-Control")).toContain("no-store");
  });

  it("IDOR: retrospecto de outra jornada é barrado pela RLS (lerRetrospecto devolve null) e vira o MESMO 404 — não confirma existência", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(null); // sessão não encerrada → não remonta

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();
    expect(resposta.status).toBe(404);
    // A mensagem é idêntica à de "não existe" — nada distingue os dois casos.
    expect(corpo.mensagem).toBe("Não existe Retrospecto para esta sessão.");
  });
});

describe("GET .../copiloto/retrospecto?formato=docx", () => {
  it("devolve attachment com filename E filename*=UTF-8'', com nosniff e sem cache", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });
    montarDocxMock.mockResolvedValue(Buffer.from("PK-fake-docx"));

    const resposta = await GET(requisicao("?formato=docx"), PARAMS);
    const cd = resposta.headers.get("Content-Disposition") ?? "";
    expect(resposta.status).toBe(200);
    expect(cd).toContain("attachment;");
    expect(cd).toContain('filename="Retrospecto-da-Sessao-2026-09-19.docx"');
    expect(cd).toContain("filename*=UTF-8''");
    expect(resposta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resposta.headers.get("Cache-Control")).toContain("no-store");
    expect(resposta.headers.get("Content-Type")).toContain("wordprocessingml");
  });

  it("🔴 NENHUM dado de cliente no nome do arquivo — só a data (regra 4 da 0028)", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });
    montarDocxMock.mockResolvedValue(Buffer.from("PK"));

    const cd = (await GET(requisicao("?formato=docx"), PARAMS)).headers.get("Content-Disposition") ?? "";
    // A única parte variável é a data ISO; nada vindo de `pessoas.nome`.
    expect(cd).toMatch(/filename="Retrospecto-da-Sessao-\d{4}-\d{2}-\d{2}\.docx"/);
  });

  it("🔴 injeção em Content-Disposition é impossível: `criado_em` inválido vira o literal 'sem-data', nunca aspa/CRLF", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({
      estado: "ok",
      retrospecto: { ...RETROSPECTO, criado_em: '"; evil: 1\r\nX-Injected: sim' },
    });
    montarDocxMock.mockResolvedValue(Buffer.from("PK"));

    const cd = (await GET(requisicao("?formato=docx"), PARAMS)).headers.get("Content-Disposition") ?? "";
    expect(cd).toBe(
      `attachment; filename="Retrospecto-da-Sessao-sem-data.docx"; filename*=UTF-8''${encodeURIComponent("Retrospecto-da-Sessao-sem-data.docx")}`,
    );
    expect(cd).not.toContain("X-Injected");
  });

  it("sem retrospecto → 404 ANTES de montar o .docx (não gasta CPU à toa)", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(null); // sessão não encerrada → não remonta

    const resposta = await GET(requisicao("?formato=docx"), PARAMS);
    expect(resposta.status).toBe(404);
    expect(montarDocxMock).not.toHaveBeenCalled();
  });

  it("teto de exportação: a 31ª chamada do MESMO usuário na janela vira 429", async () => {
    const { zerarLimites } = await import("@/server/exportacao/limite");
    zerarLimites();
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });
    montarDocxMock.mockResolvedValue(Buffer.from("PK"));

    for (let i = 0; i < 30; i += 1) {
      const ok = await GET(requisicao("?formato=docx"), PARAMS);
      expect(ok.status).toBe(200);
    }
    const bloqueada = await GET(requisicao("?formato=docx"), PARAMS);
    expect(bloqueada.status).toBe(429);
    expect((await bloqueada.json()).erro).toBe("limite_exportacao");
    zerarLimites();
  });

  it("o teto NÃO se aplica ao JSON (o pop-up abre sem gastar cota de exportação)", async () => {
    const { zerarLimites } = await import("@/server/exportacao/limite");
    zerarLimites();
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });

    for (let i = 0; i < 40; i += 1) {
      expect((await GET(requisicao(), PARAMS)).status).toBe(200);
    }
    zerarLimites();
  });
});

// ---------------------------------------------------------------------------
// 🔴 D-1 e D-2 — as duas dívidas da ressalva de SOLIDIFICAÇÃO do Fable.
// ---------------------------------------------------------------------------

describe("GET .../copiloto/retrospecto — D-1: titular anonimizado (lápide)", () => {
  it("🔴 linha anonimizada (conteudo sem `versao`) → 404 `retrospecto_indisponivel`, NUNCA corpo para a tela renderizar", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "lapide" });

    const resposta = await GET(requisicao(), PARAMS);
    const corpo = await resposta.json();
    expect(resposta.status).toBe(404);
    expect(corpo.erro).toBe("retrospecto_indisponivel");
    // O crash que a D-1 fechou era `conteudo.cobertura.x` sobre `{}`: se a
    // rota devolvesse 200 com o corpo vazio, a tela quebraria.
    expect(corpo.conteudo).toBeUndefined();
  });

  it("🔴 lápide NUNCA é remontada — as fontes também foram zeradas pela 0127; remontar criaria documento novo sobre titular anonimizado", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "lapide" });

    await GET(requisicao(), PARAMS);
    expect(remontarMock).not.toHaveBeenCalled();
  });

  it("lápide no ramo .docx também para no 404, sem montar arquivo nenhum", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "lapide" });

    const resposta = await GET(requisicao("?formato=docx"), PARAMS);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe("retrospecto_indisponivel");
    expect(montarDocxMock).not.toHaveBeenCalled();
  });

  it("`retrospecto_indisponivel` e `retrospecto_nao_encontrado` são códigos DIFERENTES — a tela distingue art. 18 de defeito", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "lapide" });
    const lapide = await (await GET(requisicao(), PARAMS)).json();

    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(null);
    const ausente = await (await GET(requisicao(), PARAMS)).json();

    expect(lapide.erro).toBe("retrospecto_indisponivel");
    expect(ausente.erro).toBe("retrospecto_nao_encontrado");
    expect(lapide.erro).not.toBe(ausente.erro);
  });
});

describe("GET .../copiloto/retrospecto — D-2: remontagem sob demanda", () => {
  it("🔴 sem linha + sessão encerrada → REMONTA e devolve 200 (a advogada não perde o documento por uma falha no encerramento)", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(RETROSPECTO);

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(RETROSPECTO);
    expect(remontarMock).toHaveBeenCalledTimes(1);
  });

  it("🔴 a remontagem recebe o cliente COM SESSÃO e o admin — leitura pela RLS, escrita por service_role", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(RETROSPECTO);

    await GET(requisicao(), PARAMS);
    expect(remontarMock).toHaveBeenCalledWith(supabaseServidorMock, supabaseAdminMock, SESSAO_ID);
    // E a LEITURA nunca usou service_role.
    expect(lerRetrospectoMock).toHaveBeenCalledWith(supabaseServidorMock, SESSAO_ID);
  });

  it("remontagem recusada (sessão não encerrada, ou RLS negou) → 404 `retrospecto_nao_encontrado`, sem 500", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(null);

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe("retrospecto_nao_encontrado");
  });

  it("documento já existe → NÃO remonta (o caminho comum não paga nada pela D-2)", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ok", retrospecto: RETROSPECTO });

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    expect(remontarMock).not.toHaveBeenCalled();
  });

  it("a remontagem vale também para o `.docx` — o documento baixado é o mesmo que o pop-up mostra", async () => {
    autorizado();
    lerRetrospectoMock.mockResolvedValue({ estado: "ausente" });
    remontarMock.mockResolvedValue(RETROSPECTO);
    montarDocxMock.mockResolvedValue(Buffer.from("PK"));

    const resposta = await GET(requisicao("?formato=docx"), PARAMS);
    expect(resposta.status).toBe(200);
    expect(montarDocxMock).toHaveBeenCalledWith(RETROSPECTO);
  });

  it("kill-switch desligado → nem lê nem remonta (a D-2 não fura o interruptor)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "perfil-1", papel: "advogada" });
    copilotoEstaAtivoMock.mockResolvedValue(true);
    retrospectoEstaAtivoMock.mockResolvedValue(false);

    const resposta = await GET(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect(lerRetrospectoMock).not.toHaveBeenCalled();
    expect(remontarMock).not.toHaveBeenCalled();
  });
});
