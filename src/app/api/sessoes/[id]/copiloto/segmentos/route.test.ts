import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER de `POST /api/sessoes/[id]/copiloto/segmentos` — Fase 10,
 * Fatia 5 (achado do coordenador: "fala digitada depois do encerramento é
 * destruída em silêncio"). Foco do aceite: sessão `'encerrado'`/`'erro'`
 * RECUSA o POST com 409 `sessao_ja_encerrada`, ANTES de qualquer INSERT em
 * `sessoes_copiloto_segmentos` — a correção (a) da cadeia descrita pelo
 * coordenador. A correção (b) (backstop no DELETE do expurgo) é testada em
 * `server/copiloto/expurgo.test.ts`.
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...args: unknown[]) => exigirVePatrimonioMock(...args) }));

const copilotoEstaAtivoMock = vi.fn();
vi.mock("@/server/copiloto/config", () => ({ copilotoEstaAtivo: (...args: unknown[]) => copilotoEstaAtivoMock(...args) }));

const supabaseServidorMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));

// Warm-up de cache (0099) — mockado (tem teste próprio em warmup.test.ts).
// O que ESTE arquivo prova é SÓ o gatilho de disparo do HANDLER: quando
// `iniciadoAgora && pessoaId`, sem `await` (fire-and-forget), e que uma
// falha dele nunca derruba o POST.
const supabaseAdminMock = { from: vi.fn() };
const criarClienteAdminMock = vi.fn(() => supabaseAdminMock);
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => criarClienteAdminMock() }));

const dispararWarmupMock = vi.fn();
vi.mock("@/server/copiloto/warmup", () => ({ dispararWarmupCopiloto: (...args: unknown[]) => dispararWarmupMock(...args) }));

const { POST } = await import("./route");

beforeEach(() => {
  supabaseServidorMock.from.mockReset();
  copilotoEstaAtivoMock.mockReset();
  criarClienteAdminMock.mockClear();
  dispararWarmupMock.mockReset();
  dispararWarmupMock.mockResolvedValue(undefined);
});

interface Cenario {
  copilotoAtivo: boolean;
  sessaoExiste: boolean;
  pessoaId: string | null;
  sessoesCopilotoExistente: { estado: string; iniciado_em: string | null } | null;
  /** `count` devolvido pelo UPDATE `aguardando`→`ativo` — `1` = esta
   * requisição venceu a corrida (`iniciadoAgora=true`). Só importa quando
   * `sessoesCopilotoExistente.estado === "aguardando"`. */
  countAtivacao: number;
  insertSegmentoFalha: boolean;
}

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    insert: encadeavel,
    update: encadeavel,
    maybeSingle: terminal,
    single: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const CENARIO_ATIVO: Cenario = {
  copilotoAtivo: true,
  sessaoExiste: true,
  pessoaId: "pessoa-1",
  sessoesCopilotoExistente: { estado: "ativo", iniciado_em: "2026-09-01T10:00:00Z" },
  countAtivacao: 1,
  insertSegmentoFalha: false,
};

function montarCenario(c: Partial<Cenario> = {}) {
  const cenario = { ...CENARIO_ATIVO, ...c };
  copilotoEstaAtivoMock.mockResolvedValue(cenario.copilotoAtivo);

  supabaseServidorMock.from.mockImplementation((tabela: string) => {
    if (tabela === "sessoes_viabilidade") {
      return consultaEncadeavel({
        data: cenario.sessaoExiste
          ? { id: "sessao-1", jornada_id: "jornada-1", jornadas: cenario.pessoaId ? { pessoa_id: cenario.pessoaId } : null }
          : null,
        error: null,
      });
    }
    if (tabela === "sessoes_copiloto") {
      const builder = consultaEncadeavel({ data: cenario.sessoesCopilotoExistente, error: null });
      // `.update(...).eq(...).eq(...)` do ramo 'aguardando' (route.ts) —
      // precisa continuar ENCADEÁVEL e só o resultado final (`await`) trocar
      // para incluir `count`. `builderUpdate` é um builder PRÓPRIO (não
      // reusa `builder`, que resolve com `sessoesCopilotoExistente`).
      const resultadoUpdate = { data: null, error: null, count: cenario.countAtivacao };
      const builderUpdate: Record<string, unknown> = {};
      Object.assign(builderUpdate, {
        eq: () => builderUpdate,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(resultadoUpdate).then(ok),
      });
      builder.update = () => builderUpdate;
      return builder;
    }
    if (tabela === "sessoes_copiloto_segmentos") {
      if (cenario.insertSegmentoFalha) {
        return consultaEncadeavel({ data: null, error: { message: "falha ao inserir" } });
      }
      const builder = consultaEncadeavel({
        data: { id: "seg-1", sessao_id: "sessao-1", ordem: 1, falante: null, falante_confianca: null, texto: "oi", iniciado_ms: null, origem: "manual", criado_em: "2026-09-11T10:00:00Z" },
        error: null,
      });
      // a leitura de `max(ordem)` (maybeSingle) devolve null (sem segmento ainda)
      builder.maybeSingle = async () => ({ data: null, error: null });
      return builder;
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  return cenario;
}

function requisicaoPost(texto = "trecho digitado") {
  return new Request("http://localhost/api/sessoes/sessao-1/copiloto/segmentos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto }),
  }) as unknown as Parameters<typeof POST>[0];
}

const PARAMS = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

describe("POST /api/sessoes/[id]/copiloto/segmentos — trava de sessão encerrada (Fatia 5)", () => {
  it("sessão 'ativo' (caso comum): aceita o segmento, 201", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "ativo", iniciado_em: "2026-09-01T10:00:00Z" } });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(201);
  });

  it("sessão 'aguardando' (1º segmento, ativa sozinha): aceita o segmento, 201", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "aguardando", iniciado_em: null } });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(201);
  });

  it("sessão sem `sessoes_copiloto` ainda (nunca digitou nada): cria a linha 'ativo' e aceita, 201", async () => {
    montarCenario({ sessoesCopilotoExistente: null });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(201);
  });

  it("🔴 sessão 'encerrado': RECUSA com 409 sessao_ja_encerrada, ANTES de qualquer INSERT de segmento", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "encerrado", iniciado_em: "2026-09-01T10:00:00Z" } });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(409);
    const corpo = (await resposta.json()) as { erro: string };
    expect(corpo.erro).toBe("sessao_ja_encerrada");
    // Prova forte: a tabela de segmentos NUNCA foi tocada — não é só o
    // corpo 409, é a AUSÊNCIA da escrita (a cadeia inteira do achado do
    // coordenador depende de o INSERT nunca acontecer, não só do código
    // de resposta).
    expect(supabaseServidorMock.from.mock.calls.map((c) => c[0])).not.toContain("sessoes_copiloto_segmentos");
  });

  it("🔴 sessão 'erro': RECUSA com 409 sessao_ja_encerrada, mesmo padrão de 'encerrado'", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "erro", iniciado_em: "2026-09-01T10:00:00Z" } });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(409);
    const corpo = (await resposta.json()) as { erro: string };
    expect(corpo.erro).toBe("sessao_ja_encerrada");
    expect(supabaseServidorMock.from.mock.calls.map((c) => c[0])).not.toContain("sessoes_copiloto_segmentos");
  });

  it("copiloto_sessao.ativo=false: 409 copiloto_desligado, ANTES de olhar o estado da sessão", async () => {
    montarCenario({ copilotoAtivo: false, sessoesCopilotoExistente: { estado: "encerrado", iniciado_em: null } });
    const resposta = await POST(requisicaoPost(), PARAMS);
    expect(resposta.status).toBe(409);
    const corpo = (await resposta.json()) as { erro: string };
    expect(corpo.erro).toBe("copiloto_desligado");
  });
});

describe("POST /api/sessoes/[id]/copiloto/segmentos — disparo do warm-up de cache (0099)", () => {
  it("1º segmento de uma sessão nova (sem sessoes_copiloto ainda): dispara o warm-up, sem `await` (a resposta não fica pendurada nele)", async () => {
    // `dispararWarmupCopiloto` nunca resolve nesta rodada — se o handler
    // esperasse por ela, o teste travaria (vitest estouraria o timeout).
    dispararWarmupMock.mockReturnValue(new Promise(() => {}));
    montarCenario({ sessoesCopilotoExistente: null });

    const resposta = await POST(requisicaoPost(), PARAMS);

    expect(resposta.status).toBe(201);
    expect(dispararWarmupMock).toHaveBeenCalledTimes(1);
    expect(dispararWarmupMock).toHaveBeenCalledWith(
      supabaseAdminMock,
      expect.objectContaining({
        sessaoId: "11111111-1111-4111-8111-111111111111",
        jornadaId: "jornada-1",
        pessoaId: "pessoa-1",
      }),
    );
  });

  it("sessão 'aguardando'→'ativo' (venceu a corrida, count=1): dispara o warm-up", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "aguardando", iniciado_em: null }, countAtivacao: 1 });
    await POST(requisicaoPost(), PARAMS);
    expect(dispararWarmupMock).toHaveBeenCalledTimes(1);
  });

  it("sessão 'aguardando'→'ativo' mas PERDEU a corrida (count=0, outra aba venceu): NÃO dispara o warm-up desta requisição", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "aguardando", iniciado_em: null }, countAtivacao: 0 });
    await POST(requisicaoPost(), PARAMS);
    expect(dispararWarmupMock).not.toHaveBeenCalled();
  });

  it("sessão já 'ativo' (POST comum, não é o 1º segmento): NÃO dispara o warm-up — só a transição real dispara", async () => {
    montarCenario({ sessoesCopilotoExistente: { estado: "ativo", iniciado_em: "2026-09-01T10:00:00Z" } });
    await POST(requisicaoPost(), PARAMS);
    expect(dispararWarmupMock).not.toHaveBeenCalled();
  });

  it("sem pessoa vinculada à jornada (dado ausente): NÃO dispara o warm-up — nunca chama com pessoaId indefinido", async () => {
    montarCenario({ sessoesCopilotoExistente: null, pessoaId: null });
    await POST(requisicaoPost(), PARAMS);
    expect(dispararWarmupMock).not.toHaveBeenCalled();
  });

  it("🔴 warm-up FALHA (rejeita): o POST de segmento continua 201 — falha em silêncio, nunca derruba a rota", async () => {
    dispararWarmupMock.mockRejectedValue(new Error("boom"));
    montarCenario({ sessoesCopilotoExistente: null });

    const resposta = await POST(requisicaoPost(), PARAMS);

    expect(resposta.status).toBe(201);
  });

  it("🔴 criarClienteAdmin() lança (env ausente): o POST de segmento continua 201", async () => {
    criarClienteAdminMock.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente");
    });
    montarCenario({ sessoesCopilotoExistente: null });

    const resposta = await POST(requisicaoPost(), PARAMS);

    expect(resposta.status).toBe(201);
    expect(dispararWarmupMock).not.toHaveBeenCalled();
  });
});
