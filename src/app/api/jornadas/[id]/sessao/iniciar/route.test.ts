import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/jornadas/[id]/sessao/iniciar — 17/09/2026, Fatia 1. O EFEITO
 * (garantir sessão + agendamento vivo agora, com idempotência) mora em
 * `server/agenda/iniciar-sessao.ts::iniciarSessaoImediata` (mockado aqui —
 * tem teste próprio em `iniciar-sessao.test.ts`). Este arquivo testa só a
 * TRADUÇÃO HTTP da rota:
 *   1. Kill-switch `sessao.inicio_direto_do_card=false` → 409, SEM chamar
 *      `iniciarSessaoImediata`.
 *   2. Jornada inexistente → 404, SEM chamar `iniciarSessaoImediata`.
 *   3. Caminho feliz, 1ª chamada: 201, `reaproveitado: false`.
 *   4. Caminho feliz, 2ª chamada (mesma sessão): 200, `reaproveitado: true`.
 *   5. EXCLUDE constraint → 409 `horario_indisponivel`.
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...a: unknown[]) => exigirVePatrimonioMock(...a) }));

const supabaseServidorMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));

const iniciarSessaoImediataMock = vi.fn();
vi.mock("@/server/agenda/iniciar-sessao", () => ({
  iniciarSessaoImediata: (...a: unknown[]) => iniciarSessaoImediataMock(...a),
  SQLSTATE_EXCLUSION_VIOLATION: "23P01",
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

const JORNADA_ID = "11111111-1111-4111-8111-111111111111";
const PARAMS = { params: Promise.resolve({ id: JORNADA_ID }) };

function requisicao() {
  return new Request(`http://localhost/api/jornadas/${JORNADA_ID}/sessao/iniciar`, { method: "POST" }) as never;
}

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  iniciarSessaoImediataMock.mockReset();
});

describe("POST /api/jornadas/[id]/sessao/iniciar", () => {
  it("sessao.inicio_direto_do_card=false → 409 inicio_direto_desligado, ZERO chamada de iniciarSessaoImediata", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: false }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao(), PARAMS);

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("inicio_direto_desligado");
    expect(iniciarSessaoImediataMock).not.toHaveBeenCalled();
  });

  it("jornada inexistente → 404, ZERO chamada de iniciarSessaoImediata", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "jornadas") return consultaEncadeavel({ data: null, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });

    const resposta = await POST(requisicao(), PARAMS);

    expect(resposta.status).toBe(404);
    expect(iniciarSessaoImediataMock).not.toHaveBeenCalled();
  });

  it("1ª chamada: cria e devolve 201 com reaproveitado=false", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "jornadas") return consultaEncadeavel({ data: { id: JORNADA_ID }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    iniciarSessaoImediataMock.mockResolvedValue({
      sessao: { id: "sessao-1", link_sala: null },
      agendamento: { id: "ag-1" },
      reaproveitado: false,
    });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(201);
    expect(corpo).toEqual({ sessaoId: "sessao-1", jornadaId: JORNADA_ID, temLinkSala: false, reaproveitado: false });
    expect(iniciarSessaoImediataMock).toHaveBeenCalledWith(supabaseServidorMock, { jornadaId: JORNADA_ID });
  });

  // 🔴 Prova o contrato pedido: iniciar DUAS VEZES seguidas no mesmo cliente
  // devolve `reaproveitado: true` na segunda, sem duplicar agendamento.
  it("2ª chamada (agendamento já vivo agora): devolve 200 com reaproveitado=true", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "jornadas") return consultaEncadeavel({ data: { id: JORNADA_ID }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    iniciarSessaoImediataMock.mockResolvedValue({
      sessao: { id: "sessao-1", link_sala: "https://meet.google.com/abc" },
      agendamento: { id: "ag-1" },
      reaproveitado: true,
    });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({ sessaoId: "sessao-1", jornadaId: JORNADA_ID, temLinkSala: true, reaproveitado: true });
  });

  it("EXCLUDE constraint (23P01) → 409 horario_indisponivel", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ id: "u1", papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "jornadas") return consultaEncadeavel({ data: { id: JORNADA_ID }, error: null });
      throw new Error(`tabela não mockada: ${t}`);
    });
    iniciarSessaoImediataMock.mockRejectedValue({ code: "23P01", message: "conflito" });

    const resposta = await POST(requisicao(), PARAMS);

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("horario_indisponivel");
  });
});
