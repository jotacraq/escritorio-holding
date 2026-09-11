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
const tentarNovamenteEncerrarBotPendenteMock = vi.fn();
vi.mock("@/server/copiloto/encerrar", () => ({
  executarEncerramentoCopiloto: (...a: unknown[]) => executarEncerramentoMock(...a),
  tentarNovamenteEncerrarBotPendente: (...a: unknown[]) => tentarNovamenteEncerrarBotPendenteMock(...a),
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
  tentarNovamenteEncerrarBotPendenteMock.mockReset();
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

  it("sessão já 'encerrada' SEM pendência de bot → 409 sessao_ja_encerrada, ZERO chamada de executarEncerramentoCopiloto", async () => {
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
    tentarNovamenteEncerrarBotPendenteMock.mockResolvedValue({ tentou: false });

    const resposta = await POST(requisicao(), PARAMS);
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toBe("sessao_ja_encerrada");
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
    expect(tentarNovamenteEncerrarBotPendenteMock).toHaveBeenCalledWith(
      supabaseServidorMock,
      supabaseAdminMock,
      "11111111-1111-4111-8111-111111111111",
      { jornadaId: "j1", realizadaEm: null },
    );
  });

  // 🔴 Achado B do Fable: sessão já encerrada COM pendência de bot ganha
  // uma retentativa — não recusa cegamente.
  it("sessão já 'encerrada' COM pendência: tenta encerrarBotComRetentativa de novo, 409 mas mensagem reflete SUCESSO", async () => {
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
    tentarNovamenteEncerrarBotPendenteMock.mockResolvedValue({ tentou: true, resolvida: true, resultadoEncerramento: null });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("sessao_ja_encerrada");
    expect(corpo.mensagem).toMatch(/encerrado agora com sucesso/i);
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
  });

  it("sessão já 'encerrada' COM pendência: retentativa AINDA FALHA, mensagem NÃO afirma sucesso", async () => {
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
    tentarNovamenteEncerrarBotPendenteMock.mockResolvedValue({ tentou: true, resolvida: false, resultadoEncerramento: null });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("sessao_ja_encerrada");
    expect(corpo.mensagem).not.toMatch(/com sucesso/i);
  });

  // 🔴 O ACHADO CENTRAL DESTA RODADA: "o ciclo da pendência fechou para 1
  // dos 3 nascedouros". Sessão em `estado==='erro'` (os 2 nascedouros da
  // rota do bot) TEM de entrar no mesmo gate de retry — antes desta
  // correção, o `if` só cobria `'encerrado'`, e `'erro'` caía direto em
  // `executarEncerramentoCopiloto`, que recusava `'erro'` como origem: 409
  // puro, SEM retry, sessão BRICADA.
  it("sessão em estado='erro' (nascedouro da rota do bot) ENTRA no gate de retry — não é mais ignorada", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: { id: "sessao-1", jornada_id: "j1", realizada_em: null, sessoes_copiloto: { estado: "erro" } },
          error: null,
        });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });
    tentarNovamenteEncerrarBotPendenteMock.mockResolvedValue({ tentou: true, resolvida: false, resultadoEncerramento: null });

    const resposta = await POST(requisicao(), PARAMS);

    // O ponto central: `tentarNovamenteEncerrarBotPendente` FOI CHAMADO para
    // uma sessão em 'erro' — antes desta correção, isso nunca acontecia.
    expect(tentarNovamenteEncerrarBotPendenteMock).toHaveBeenCalledWith(
      supabaseServidorMock,
      supabaseAdminMock,
      "11111111-1111-4111-8111-111111111111",
      { jornadaId: "j1", realizadaEm: null },
    );
    expect(resposta.status).toBe(409);
    expect(executarEncerramentoMock).not.toHaveBeenCalled();
  });

  // Sessão em 'erro' cujo retry TEVE sucesso: a sessão foi encerrada de
  // verdade (fluxo completo, dentro de tentarNovamenteEncerrarBotPendente)
  // — a resposta é SUCESSO NORMAL (200), não mais um 409.
  it("sessão em estado='erro', retry com sucesso: devolve 200 com o payload de encerramento REAL (não 409)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    supabaseServidorMock.from.mockImplementation((t: string) => {
      if (t === "configuracoes") return consultaEncadeavel({ data: { valor: true }, error: null });
      if (t === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: { id: "sessao-1", jornada_id: "j1", realizada_em: "2026-09-11T10:00:00Z", sessoes_copiloto: { estado: "erro" } },
          error: null,
        });
      }
      throw new Error(`tabela não mockada: ${t}`);
    });
    tentarNovamenteEncerrarBotPendenteMock.mockResolvedValue({
      tentou: true,
      resolvida: true,
      resultadoEncerramento: {
        encerrado: true,
        encerradoEm: "2026-09-11T15:00:00.000Z",
        transcricaoId: "transcricao-do-erro",
        jaExistiaTranscricao: false,
        sugestoesExpiradas: 1,
      },
    });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({
      sessao_id: "11111111-1111-4111-8111-111111111111",
      estado: "encerrado",
      encerrado_em: "2026-09-11T15:00:00.000Z",
      transcricao_id: "transcricao-do-erro",
      ja_existia_transcricao: false,
      sugestoes_expiradas: 1,
    });
    // NUNCA chama executarEncerramentoCopiloto por fora — o resultado já
    // veio pronto do retry (evita corrida contra a chamada interna dele).
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
