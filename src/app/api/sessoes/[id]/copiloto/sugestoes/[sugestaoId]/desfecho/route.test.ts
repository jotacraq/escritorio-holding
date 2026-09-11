import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST .../desfecho — §5/§9 do plano: o registro de aceite/ignorado da
 * sugestão, que a 0091 já reservava e nenhuma rota gravava. `desfecho` é
 * imutável depois de gravado (trigger 0095, backstop no banco) — este teste
 * prova o comportamento da ROTA (a 2ª tentativa de gravar dá 409, sem
 * segundo UPDATE bem-sucedido), não a trigger em si (isso é o passo 11 de
 * `scripts/verificacao-0092-0093.sql`, contra o banco real).
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...args: unknown[]) => exigirVePatrimonioMock(...args) }));

const supabaseServidorMock = { from: vi.fn() };
const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const { POST } = await import("./route");

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    is: encadeavel,
    update: encadeavel,
    maybeSingle: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

function requisicao(desfecho: string) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desfecho }),
  }) as never;
}

const PARAMS = {
  params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111", sugestaoId: "22222222-2222-4222-8222-222222222222" }),
};

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  supabaseAdminMock.from.mockReset();
});

describe("POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho", () => {
  it("copiloto desligado → 409 copiloto_desligado, sem tocar a sugestão", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: false }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao("aceita"), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_desligado");
  });

  it("sugestão inexistente na sessão → 404", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "copiloto_sugestoes") return consultaEncadeavel({ data: null, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao("aceita"), PARAMS);
    expect(resposta.status).toBe(404);
  });

  it("sugestão já tem desfecho gravado → 409 desfecho_ja_registrado, SEM tentar UPDATE", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    const updateSpy = vi.fn();
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "copiloto_sugestoes") return consultaEncadeavel({ data: { id: "sugestao-1", desfecho: "aceita" }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    supabaseAdminMock.from.mockImplementation((t: string) => {
      const builder = consultaEncadeavel({ data: null, error: null });
      if (t === "copiloto_sugestoes") {
        return { ...builder, update: (...a: unknown[]) => { updateSpy(...a); return builder; } };
      }
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao("ignorada"), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("desfecho_ja_registrado");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("sugestão sem desfecho: grava com sucesso e devolve 200 com o desfecho gravado", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "copiloto_sugestoes") return consultaEncadeavel({ data: { id: "sugestao-1", desfecho: null }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    supabaseAdminMock.from.mockImplementation((t: string) => {
      if (t === "copiloto_sugestoes") {
        return consultaEncadeavel({ data: { id: "sugestao-1", desfecho: "aceita", desfecho_em: "2026-09-11T12:00:00.000Z" }, error: null });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao("aceita"), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toMatchObject({ sugestao_id: "sugestao-1", desfecho: "aceita" });
  });

  it("corrida (is desfecho null não casou no UPDATE) → 409 desfecho_ja_registrado, nunca 200 fantasma", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "copiloto_sugestoes") return consultaEncadeavel({ data: { id: "sugestao-1", desfecho: null }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    supabaseAdminMock.from.mockImplementation((t: string) => {
      if (t === "copiloto_sugestoes") {
        // maybeSingle devolve null: nenhuma linha casou o `is(desfecho, null)`
        // porque outra requisição já gravou entre a leitura e o UPDATE.
        return consultaEncadeavel({ data: null, error: null });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao("aceita"), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("desfecho_ja_registrado");
  });
});
