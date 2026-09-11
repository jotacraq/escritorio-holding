import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/sessoes/[id]/copiloto/encerrar — Fase 10, Fatia 3 (§6.1/§8 do
 * plano). O EFEITO de encerrar (marcar estado, consolidar transcrição,
 * expirar sugestões) mora em `server/copiloto/encerrar.ts::
 * executarEncerramentoCopiloto` (mockado aqui — tem teste próprio em
 * `encerrar.test.ts`). Este arquivo testa só a TRADUÇÃO HTTP da rota:
 *   1. Kill-switch continua fail-closed.
 *   2. Sessão inexistente/sem sessoes_copiloto/já 'encerrada' → 409 antes de
 *      chamar `executarEncerramentoCopiloto`.
 *   3. `executarEncerramentoCopiloto` devolve `encerrado:false` (corrida) →
 *      409 `sessao_ja_encerrada`.
 *   4. Caminho feliz: repassa o resultado para o payload HTTP certo.
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...a: unknown[]) => exigirVePatrimonioMock(...a) }));

const supabaseServidorMock = { from: vi.fn() };
const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const executarEncerramentoMock = vi.fn();
vi.mock("@/server/copiloto/encerrar", () => ({
  executarEncerramentoCopiloto: (...a: unknown[]) => executarEncerramentoMock(...a),
}));

const { POST } = await import("./route");

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    maybeSingle: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const PARAMS = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

function requisicao() {
  return new Request("http://localhost/api/sessoes/11111111-1111-4111-8111-111111111111/copiloto/encerrar", {
    method: "POST",
  }) as never;
}

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  supabaseAdminMock.from.mockReset();
  executarEncerramentoMock.mockReset();
});

describe("POST /api/sessoes/[id]/copiloto/encerrar", () => {
  it("copiloto_sessao.ativo=false → 409 copiloto_desligado, ZERO chamada de executarEncerramentoCopiloto", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: false }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("copiloto_desligado");
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
  });

  it("sessão já 'encerrada' → 409 sessao_ja_encerrada, ZERO chamada de executarEncerramentoCopiloto", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: { id: "sessao-1", jornada_id: "j1", realizada_em: null, sessoes_copiloto: { estado: "encerrado" } },
          error: null,
        });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("sessao_ja_encerrada");
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
  });

  it("sessão sem sessoes_copiloto (Fatia 1 nunca ativada) → 409 sessao_ja_encerrada (nada para encerrar)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({ data: { id: "sessao-1", jornada_id: "j1", realizada_em: null, sessoes_copiloto: null }, error: null });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
  });

  it("executarEncerramentoCopiloto devolve encerrado:false (corrida) → 409 sessao_ja_encerrada", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: { id: "sessao-1", jornada_id: "j1", realizada_em: null, sessoes_copiloto: { estado: "ativo" } },
          error: null,
        });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });
    executarEncerramentoMock.mockResolvedValue({
      encerrado: false, encerradoEm: null, transcricaoId: null, jaExistiaTranscricao: false, sugestoesExpiradas: 0,
    });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("sessao_ja_encerrada");
  });

  it("caminho feliz: repassa o resultado de executarEncerramentoCopiloto para o payload HTTP", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: { id: "sessao-1", jornada_id: "j1", realizada_em: "2026-09-11T10:00:00Z", sessoes_copiloto: { estado: "ativo" } },
          error: null,
        });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });
    executarEncerramentoMock.mockResolvedValue({
      encerrado: true,
      encerradoEm: "2026-09-11T14:00:00.000Z",
      transcricaoId: "transcricao-1",
      jaExistiaTranscricao: false,
      sugestoesExpiradas: 2,
    });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo).toEqual({
      sessao_id: "11111111-1111-4111-8111-111111111111", // id do PATH
      estado: "encerrado",
      encerrado_em: "2026-09-11T14:00:00.000Z",
      transcricao_id: "transcricao-1",
      ja_existia_transcricao: false,
      sugestoes_expiradas: 2,
    });
    expect(executarEncerramentoMock).toHaveBeenCalledWith(
      supabaseServidorMock,
      supabaseAdminMock,
      { sessaoId: "11111111-1111-4111-8111-111111111111", sessao: { jornadaId: "j1", realizadaEm: "2026-09-11T10:00:00Z" } },
    );
  });
});
