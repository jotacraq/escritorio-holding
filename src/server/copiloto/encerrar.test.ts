import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O EFEITO de encerrar (Fase 10, Fatia 3, §6.1/§8/§4.4 do plano) — extraído
 * de `POST .../encerrar` para ser reusado pelo ciclo automático quando
 * `duracao_maxima_minutos` estoura. `consolidarTranscricaoDaSessao` é
 * mockada aqui (tem teste próprio em `consolidar.test.ts`).
 */

const consolidarMock = vi.fn();
vi.mock("./consolidar", () => ({ consolidarTranscricaoDaSessao: (...a: unknown[]) => consolidarMock(...a) }));

const { executarEncerramentoCopiloto, encerrarSePassouDoTempo } = await import("./encerrar");

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    is: encadeavel,
    in: encadeavel,
    update: encadeavel,
    maybeSingle: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

function clientes(opts: {
  jornada?: Resultado;
  pessoa?: Resultado;
  marcarEncerrada?: Resultado; // update em sessoes_copiloto
  sugestoesExpiradas?: Resultado; // update em copiloto_sugestoes
}) {
  const supabase = {
    from: (t: string) => {
      if (t === "jornadas") return consultaEncadeavel(opts.jornada ?? { data: { pessoa_id: "p1" }, error: null });
      if (t === "pessoas") return consultaEncadeavel(opts.pessoa ?? { data: { nome: "Fulana" }, error: null });
      throw new Error(`tabela não mockada em supabase: ${t}`);
    },
  } as unknown as SupabaseClient;

  const admin = {
    from: (t: string) => {
      if (t === "sessoes_copiloto") return consultaEncadeavel(opts.marcarEncerrada ?? { data: { sessao_id: "s1" }, error: null });
      if (t === "copiloto_sugestoes") return consultaEncadeavel(opts.sugestoesExpiradas ?? { data: [], error: null });
      throw new Error(`tabela não mockada em admin: ${t}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, admin };
}

afterEach(() => {
  consolidarMock.mockReset();
});

describe("executarEncerramentoCopiloto", () => {
  it("já encerrada (0 linha afetada no UPDATE) → encerrado:false, NÃO consolida", async () => {
    const { supabase, admin } = clientes({ marcarEncerrada: { data: null, error: null } });
    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });
    expect(r.encerrado).toBe(false);
    expect(consolidarMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: marca encerrada, consolida, expira sugestões pendentes", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "transcricao-1", jaExistia: false });
    const { supabase, admin } = clientes({ sugestoesExpiradas: { data: [{ id: "s1" }, { id: "s2" }], error: null } });

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: "2026-09-11" } });

    expect(r).toMatchObject({ encerrado: true, transcricaoId: "transcricao-1", jaExistiaTranscricao: false, sugestoesExpiradas: 2 });
    expect(r.encerradoEm).not.toBeNull();
    expect(consolidarMock).toHaveBeenCalledTimes(1);
  });

  it("sem segmento suficiente para consolidar → transcricaoId null, encerramento ainda acontece", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: null, jaExistia: false });
    const { supabase, admin } = clientes({});

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(r.encerrado).toBe(true);
    expect(r.transcricaoId).toBeNull();
  });
});

describe("encerrarSePassouDoTempo", () => {
  const AGORA = Date.parse("2026-09-11T14:00:00.000Z");

  it("dentro do teto → false, NÃO chama executarEncerramentoCopiloto (zero I/O de encerramento)", async () => {
    const { supabase, admin } = clientes({});
    const r = await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: "2026-09-11T13:30:00.000Z", // 30 min atrás
      duracaoMaximaMinutos: 150,
      agoraMs: AGORA,
    });
    expect(r).toBe(false);
    expect(consolidarMock).not.toHaveBeenCalled();
  });

  it("ESTOUROU o teto → true, encerra de verdade (consolida)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: null, jaExistia: false });
    const { supabase, admin } = clientes({});
    const r = await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: "2026-09-11T11:00:00.000Z", // 3h atrás, acima do teto de 150min
      duracaoMaximaMinutos: 150,
      agoraMs: AGORA,
    });
    expect(r).toBe(true);
  });

  it("exatamente no limite conta como estourado (>=, não >)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: null, jaExistia: false });
    const { supabase, admin } = clientes({});
    const r = await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: new Date(AGORA - 150 * 60_000).toISOString(),
      duracaoMaximaMinutos: 150,
      agoraMs: AGORA,
    });
    expect(r).toBe(true);
  });

  it("falha ao encerrar (erro inesperado) NUNCA lança — devolve false, registra o erro", async () => {
    consolidarMock.mockRejectedValue(new Error("falha de rede"));
    const { supabase, admin } = clientes({});
    const r = await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: "2026-09-11T11:00:00.000Z",
      duracaoMaximaMinutos: 150,
      agoraMs: AGORA,
    });
    expect(r).toBe(false);
  });
});
