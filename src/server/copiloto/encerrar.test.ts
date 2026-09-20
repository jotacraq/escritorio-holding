import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O EFEITO de encerrar (Fase 10, Fatia 3/4, §6.1/§8/§4.4 do plano) —
 * extraído de `POST .../encerrar` para ser reusado pelo ciclo automático
 * quando `duracao_maxima_minutos` estoura. `consolidarTranscricaoDaSessao` é
 * mockada aqui (tem teste próprio em `consolidar.test.ts`).
 *
 * 🔴 Achados A e B do Fable (revisão de Solidificação): "você corrigiu o
 * ramo raro e deixou o comum" — `tirarBotDaSalaSeHouver` (o caminho COMUM:
 * manual e duração máxima) chamava `encerrarBot()` cru, sem retentativa; e
 * "ninguém limpa a pendência" — nada escrevia NULL de volta em sucesso. Este
 * arquivo mocka `encerrarBotComRetentativa` (não mais `encerrarBot`) e prova
 * os dois pontos: retentativa no caminho comum, e limpeza em sucesso.
 */

const consolidarMock = vi.fn();
vi.mock("./consolidar", () => ({ consolidarTranscricaoDaSessao: (...a: unknown[]) => consolidarMock(...a) }));

const encerrarBotComRetentativaMock = vi.fn();
vi.mock("./recall", () => ({ encerrarBotComRetentativa: (...a: unknown[]) => encerrarBotComRetentativaMock(...a) }));

/** FASE 13 (19/09/2026) — o RETROSPECTO é o 4º efeito do encerramento. Tem
 * teste próprio em `retrospecto.test.ts` (inclusive a cobertura contra os
 * números reais); aqui só provamos o CONTRATO com o encerramento: roda 1×
 * por sessão (o portão é `marcarEncerrada`) e NUNCA derruba a consolidação. */
const gravarRetrospectoMock = vi.fn();
vi.mock("./retrospecto", () => ({ gravarRetrospectoDaSessao: (...a: unknown[]) => gravarRetrospectoMock(...a) }));

const { executarEncerramentoCopiloto, encerrarSePassouDoTempo, tentarNovamenteEncerrarBotPendente } = await import("./encerrar");

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

/** Constrói UM builder para uma chamada de `.from("sessoes_copiloto")`. A
 * 1ª chamada nesta sessão de teste é sempre `marcarEncerrada`
 * (`.update().eq().in().select().maybeSingle()`, devolve
 * `marcarEncerradaResultado`); qualquer chamada seguinte é um UPDATE
 * subsequente (pendência ou `transcricao_id`) que sempre resolve com
 * sucesso — mas o PAYLOAD de TODO `.update()` (inclusive o de
 * `marcarEncerrada`) passa pelo `updateSpy`, para o teste poder inspecionar
 * exatamente o que foi escrito (achado B: limpeza precisa gravar `null` de
 * verdade, não só "não lançar"). */
function criarTabelaSessoesCopilotoComSpy(marcarEncerradaResultado: Resultado, updateSpy: ReturnType<typeof vi.fn>) {
  let chamadasFrom = 0;
  return () => {
    chamadasFrom += 1;
    const ehPrimeiraChamada = chamadasFrom === 1;
    const builder: Record<string, unknown> = {};
    const encadeavel = () => builder;
    builder.select = encadeavel;
    builder.eq = encadeavel;
    builder.in = encadeavel;
    builder.maybeSingle = async () => (ehPrimeiraChamada ? marcarEncerradaResultado : { data: { sessao_id: "s1" }, error: null });
    builder.update = (payload: unknown) => {
      updateSpy(payload);
      return builder; // resultado do UPDATE em si não importa para o código de produção
    };
    builder.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(ehPrimeiraChamada ? marcarEncerradaResultado : { data: null, error: null }).then(ok);
    return builder;
  };
}

function clientes(opts: {
  jornada?: Resultado;
  pessoa?: Resultado;
  marcarEncerrada?: Resultado; // update em sessoes_copiloto (marcarEncerrada)
  sugestoesExpiradas?: Resultado; // update em copiloto_sugestoes
  updateSessoesCopilotoSpy?: ReturnType<typeof vi.fn>;
}) {
  const supabase = {
    from: (t: string) => {
      if (t === "jornadas") return consultaEncadeavel(opts.jornada ?? { data: { pessoa_id: "p1" }, error: null });
      if (t === "pessoas") return consultaEncadeavel(opts.pessoa ?? { data: { nome: "Fulana" }, error: null });
      throw new Error(`tabela não mockada em supabase: ${t}`);
    },
  } as unknown as SupabaseClient;

  const spy = opts.updateSessoesCopilotoSpy ?? vi.fn();
  const fabricaSessoesCopiloto = criarTabelaSessoesCopilotoComSpy(
    opts.marcarEncerrada ?? { data: { sessao_id: "s1", gravacao_externa_id: null }, error: null },
    spy,
  );
  const admin = {
    from: (t: string) => {
      if (t === "sessoes_copiloto") return fabricaSessoesCopiloto();
      if (t === "copiloto_sugestoes") return consultaEncadeavel(opts.sugestoesExpiradas ?? { data: [], error: null });
      throw new Error(`tabela não mockada em admin: ${t}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, admin, updateSpy: spy };
}

afterEach(() => {
  consolidarMock.mockReset();
  encerrarBotComRetentativaMock.mockReset();
  gravarRetrospectoMock.mockReset();
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

  // Aceite pedido pelo coordenador (achado: "encerrar a sessão deixa o bot
  // na sala") — os dois pontos: chama encerrarBotComRetentativa quando há
  // bot, e falha do Recall NÃO impede a consolidação da transcrição.
  it("sessão COM bot vinculado: encerrarBotComRetentativa é chamado com o gravacao_externa_id certo", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_123" }, error: null } });

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(encerrarBotComRetentativaMock).toHaveBeenCalledTimes(1);
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_123");
    expect(r.encerrado).toBe(true);
  });

  it("sessão SEM bot (modo manual/digitado): encerrarBotComRetentativa NUNCA é chamado", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: null }, error: null } });

    await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(encerrarBotComRetentativaMock).not.toHaveBeenCalled();
  });

  it("encerrarBotComRetentativa devolve sucesso:false: a consolidação ACONTECE mesmo assim (nunca lança, nunca bloqueia)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_123" }, error: null } });

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(r.encerrado).toBe(true);
    expect(r.transcricaoId).toBe("t1");
    expect(consolidarMock).toHaveBeenCalledTimes(1);
  });

  it("encerrarBotComRetentativa LANÇA (defeito inesperado): a consolidação ainda ACONTECE (defesa em profundidade)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockRejectedValue(new Error("erro totalmente inesperado"));
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_123" }, error: null } });

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(r.encerrado).toBe(true);
    expect(consolidarMock).toHaveBeenCalledTimes(1);
  });

  it("encerrarBotComRetentativa devolve sucesso:true/ja_tinha_saido: sucesso, consolidação normal", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "ja_tinha_saido" });
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_123" }, error: null } });

    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(r.encerrado).toBe(true);
    expect(consolidarMock).toHaveBeenCalledTimes(1);
  });

  // 🔴 Achado A do Fable: o caminho COMUM (manual/duração máxima) usa
  // RETENTATIVA — mesma função usada pelo achado 4 em bot/route.ts.
  it("achado A: usa encerrarBotComRetentativa (COM retentativa), não encerrarBot cru", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_retry" }, error: null } });

    await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    // A própria existência da chamada a `encerrarBotComRetentativa` (e não
    // a uma função "encerrarBot" separada) já prova que o caminho comum usa
    // retentativa — é a mesma função testada em `recall.test.ts` para fazer
    // 1 retentativa antes de desistir.
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_retry");
  });

  // 🔴 Achado A do Fable: pendência gravada no caminho COMUM em falha
  // definitiva — não só stdout.
  it("achado A: encerrarBotComRetentativa falha DEFINITIVA grava pendencia_encerramento_bot visivel", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });
    const updateSpy = vi.fn();
    const { supabase, admin } = clientes({
      marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_falha" }, error: null },
      updateSessoesCopilotoSpy: updateSpy,
    });

    await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    const chamadaComPendencia = updateSpy.mock.calls.find(
      (args) => args[0] && typeof args[0] === "object" && "pendencia_encerramento_bot" in args[0],
    );
    expect(chamadaComPendencia).toBeDefined();
    expect(chamadaComPendencia?.[0].pendencia_encerramento_bot).toContain("NÃO CONSEGUIU");
    expect(chamadaComPendencia?.[0].pendencia_encerramento_bot_em).toBeTruthy();
  });

  // 🔴 Achado B do Fable: limpeza em sucesso — sem isso, uma pendência
  // resolvida à mão fica eterna.
  it("achado B: encerrarBotComRetentativa com SUCESSO grava pendencia_encerramento_bot NULL (limpeza)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const updateSpy = vi.fn();
    const { supabase, admin } = clientes({
      marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_ok" }, error: null },
      updateSessoesCopilotoSpy: updateSpy,
    });

    await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    const chamadaDeLimpeza = updateSpy.mock.calls.find(
      (args) => args[0] && typeof args[0] === "object" && "pendencia_encerramento_bot" in args[0] && args[0].pendencia_encerramento_bot === null,
    );
    expect(chamadaDeLimpeza).toBeDefined();
    expect(chamadaDeLimpeza?.[0].pendencia_encerramento_bot_em).toBeNull();
  });
});

describe("encerramento AUTOMATICO (duracao_maxima_minutos) tambem tira o bot da sala", () => {
  it("estourou o teto, sessão com bot vinculado: encerrarBotComRetentativa é chamado igual ao caminho manual", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: null, jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const AGORA = Date.parse("2026-09-11T14:00:00.000Z");
    const { supabase, admin } = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: "bot_automatico" }, error: null } });

    const r = await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: "2026-09-11T11:00:00.000Z",
      duracaoMaximaMinutos: 150,
      agoraMs: AGORA,
    });

    expect(r).toBe(true);
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_automatico");
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

// ---------------------------------------------------------------------------
// 🔴 Achado do Fable ("o ciclo da pendência fechou para 1 dos 3
// nascedouros"): `tentarNovamenteEncerrarBotPendente` — os DOIS ramos.
//
//   estado==='encerrado' — a sessão já foi consolidada (nascedouro comum,
//     tirarBotDaSalaSeHouver): só falta tirar o bot da sala.
//   estado==='erro' — a sessão NUNCA foi consolidada (os 2 nascedouros da
//     rota do bot): precisa do fluxo COMPLETO, via executarEncerramentoCopiloto.
// ---------------------------------------------------------------------------
describe("tentarNovamenteEncerrarBotPendente — estado='encerrado' (fluxo simples)", () => {
  /** Mock isolado: só o SELECT inicial de `tentarNovamenteEncerrarBotPendente`
   * e o UPDATE de limpeza dentro de `tirarBotDaSalaSeHouver` — nunca chama
   * `executarEncerramentoCopiloto` neste ramo, então não precisa de
   * `jornadas`/`pessoas`/`copiloto_sugestoes`. */
  function clienteEncerradaComPendencia(opts: { pendencia?: string | null; gravacaoExternaId?: string | null; pendenciaDepois?: string | null }) {
    let chamadasSelect = 0;
    const admin = {
      from: (t: string) => {
        if (t !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${t}`);
        chamadasSelect += 1;
        const numeroDestaChamada = chamadasSelect;
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.update = () => builder;
        builder.maybeSingle = async () => {
          if (numeroDestaChamada === 1) {
            return {
              data: { estado: "encerrado", gravacao_externa_id: opts.gravacaoExternaId ?? "bot_x", pendencia_encerramento_bot: opts.pendencia ?? null },
              error: null,
            };
          }
          return { data: { pendencia_encerramento_bot: opts.pendenciaDepois ?? null }, error: null };
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    return admin;
  }

  it("sessão sem pendência: tentou:false, NUNCA chama encerrarBotComRetentativa", async () => {
    const admin = clienteEncerradaComPendencia({ pendencia: null });
    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });
    expect(r).toEqual({ tentou: false });
    expect(encerrarBotComRetentativaMock).not.toHaveBeenCalled();
  });

  it("sessão com pendência, retentativa TEM sucesso: tentou:true, resolvida:true, SEM resultadoEncerramento (não reconsolida)", async () => {
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const admin = clienteEncerradaComPendencia({ pendencia: "pendência antiga", gravacaoExternaId: "bot_y", pendenciaDepois: null });

    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });

    expect(r).toEqual({ tentou: true, resolvida: true, resultadoEncerramento: null });
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_y");
  });

  it("sessão com pendência, retentativa FALHA de novo: tentou:true, resolvida:false", async () => {
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });
    const admin = clienteEncerradaComPendencia({ pendencia: "pendência antiga", gravacaoExternaId: "bot_z", pendenciaDepois: "pendência antiga" });

    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });

    expect(r).toEqual({ tentou: true, resolvida: false, resultadoEncerramento: null });
  });
});

// 🔴 O RAMO QUE FALTAVA: estado==='erro' — os 2 nascedouros da rota do bot
// (retenção infinita, falha ao persistir vínculo). Sem este ramo a sessão
// ficava BRICADA: nem bot novo, nem encerramento formal, nem limpeza.
describe("tentarNovamenteEncerrarBotPendente — estado='erro' (fluxo COMPLETO, via executarEncerramentoCopiloto)", () => {
  /** Fila de respostas por chamada de `.from("sessoes_copiloto")`, na ORDEM
   * real: (1) o SELECT inicial de `tentarNovamenteEncerrarBotPendente`;
   * (2) o UPDATE de `marcarEncerrada` dentro de `executarEncerramentoCopiloto`
   * — TEM de aceitar `estado='erro'` como origem (é o que está sendo
   * testado); (3) o UPDATE de limpeza/pendência dentro de
   * `tirarBotDaSalaSeHouver`; (4) o SELECT final de conferência da pendência. */
  function clienteEmErroComPendencia(opts: {
    gravacaoExternaId?: string | null;
    marcarEncerradaResultado?: Resultado;
    pendenciaDepois?: string | null;
  }) {
    // Discrimina pela COLUNA pedida no `.select()`, não pela posição da
    // chamada — mais robusto: o número de chamadas intermediárias muda
    // conforme `consolidarMock` devolve `transcricaoId` ou não (um UPDATE a
    // mais em `sessoes_copiloto.transcricao_id` quando devolve).
    const admin = {
      from: (t: string) => {
        if (t === "sessoes_copiloto") {
          const builder: Record<string, unknown> = {};
          let colunasSelecionadas = "";
          let ehUpdate = false;
          builder.select = (colunas?: string) => {
            colunasSelecionadas = colunas ?? "";
            return builder;
          };
          builder.eq = () => builder;
          builder.in = () => builder;
          builder.update = () => {
            ehUpdate = true;
            return builder;
          };
          builder.maybeSingle = async () => {
            if (ehUpdate) {
              // UPDATE de marcarEncerrada (dentro de executarEncerramentoCopiloto)
              // — TEM de aceitar 'erro' como estado de origem.
              return opts.marcarEncerradaResultado ?? { data: { sessao_id: "s1", gravacao_externa_id: opts.gravacaoExternaId ?? "bot_erro" }, error: null };
            }
            if (colunasSelecionadas.includes("estado")) {
              // SELECT inicial de tentarNovamenteEncerrarBotPendente.
              return {
                data: { estado: "erro", gravacao_externa_id: opts.gravacaoExternaId ?? "bot_erro", pendencia_encerramento_bot: "pendência antiga" },
                error: null,
              };
            }
            // SELECT final de conferência da pendência.
            return { data: { pendencia_encerramento_bot: opts.pendenciaDepois ?? null }, error: null };
          };
          builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
          return builder;
        }
        if (t === "jornadas") return consultaEncadeavel({ data: { pessoa_id: "p1" }, error: null });
        if (t === "pessoas") return consultaEncadeavel({ data: { nome: "Fulana" }, error: null });
        if (t === "copiloto_sugestoes") return consultaEncadeavel({ data: [], error: null });
        throw new Error(`tabela não mockada: ${t}`);
      },
    } as unknown as SupabaseClient;
    return admin;
  }

  it("estado='erro', retentativa TEM sucesso: encerra de VERDADE (marcarEncerrada aceita 'erro'), consolida, resultadoEncerramento preenchido", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t-erro-1", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });
    const admin = clienteEmErroComPendencia({ gravacaoExternaId: "bot_erro_1", pendenciaDepois: null });

    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });

    expect(r.tentou).toBe(true);
    if (r.tentou) {
      expect(r.resolvida).toBe(true);
      expect(r.resultadoEncerramento).not.toBeNull();
      expect(r.resultadoEncerramento?.encerrado).toBe(true);
      expect(r.resultadoEncerramento?.transcricaoId).toBe("t-erro-1");
    }
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_erro_1");
    expect(consolidarMock).toHaveBeenCalledTimes(1);
  });

  it("estado='erro', retentativa FALHA de novo: continua em 'erro' (marcarEncerrada não teria rodado se o UPDATE não aceitasse 'erro' — aqui simulamos sucesso do UPDATE mas falha do bot)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t-erro-2", jaExistia: false });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });
    const admin = clienteEmErroComPendencia({ gravacaoExternaId: "bot_erro_2", pendenciaDepois: "pendência ainda não resolvida" });

    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });

    // A sessão AINDA assim sai formalmente de 'erro' (marcarEncerrada teve
    // sucesso), mas a pendência do bot continua — resolvida:false.
    expect(r.tentou).toBe(true);
    if (r.tentou) {
      expect(r.resolvida).toBe(false);
      expect(r.resultadoEncerramento?.encerrado).toBe(true);
    }
  });

  it("corrida: outra requisição já resolveu entre a leitura e o UPDATE — resolvida:true, resultadoEncerramento:null (não reconsolida)", async () => {
    const admin = clienteEmErroComPendencia({ gravacaoExternaId: "bot_erro_3", marcarEncerradaResultado: { data: null, error: null } });

    const r = await tentarNovamenteEncerrarBotPendente(admin, admin, "s1", { jornadaId: "j1", realizadaEm: null });

    expect(r).toEqual({ tentou: true, resolvida: true, resultadoEncerramento: null });
  });
});

// ---------------------------------------------------------------------------
// FASE 13 (19/09/2026) — BE-3: o retrospecto pendurado no encerramento.
// ---------------------------------------------------------------------------

describe("executarEncerramentoCopiloto — RETROSPECTO (Fase 13, BE-3)", () => {
  const RETROSPECTO = { sessao_id: "s1", jornada_id: "j1", origem: "derivado", blocos_com_atividade: 9, blocos_no_roteiro: 13 };

  it("🔴 chamar 2× → o retrospecto é gravado UMA vez só (o portão é `marcarEncerrada`, não disciplina de quem chama)", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    gravarRetrospectoMock.mockResolvedValue(RETROSPECTO);

    // 1ª chamada: o UPDATE de `marcarEncerrada` afeta a linha.
    const primeira = clientes({ marcarEncerrada: { data: { sessao_id: "s1", gravacao_externa_id: null }, error: null } });
    const r1 = await executarEncerramentoCopiloto(primeira.supabase, primeira.admin, {
      sessaoId: "s1",
      sessao: { jornadaId: "j1", realizadaEm: null },
    });

    // 2ª chamada: a linha já está 'encerrado', o `.in(estado,[...])` não casa,
    // `marcarEncerrada` devolve null — é ISSO que impede o 2º retrospecto.
    const segunda = clientes({ marcarEncerrada: { data: null, error: null } });
    const r2 = await executarEncerramentoCopiloto(segunda.supabase, segunda.admin, {
      sessaoId: "s1",
      sessao: { jornadaId: "j1", realizadaEm: null },
    });

    expect(r1.encerrado).toBe(true);
    expect(r1.retrospecto).toEqual(RETROSPECTO);
    expect(r2.encerrado).toBe(false);
    expect(r2.retrospecto).toBeNull();
    expect(gravarRetrospectoMock).toHaveBeenCalledTimes(1); // 1 chamada em 2 encerramentos
  });

  it("🔴 retrospecto FALHANDO (devolve null) → encerrado:true assim mesmo, transcrição consolidada, retrospecto:null", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    gravarRetrospectoMock.mockResolvedValue(null); // o módulo nunca lança; null é como ele reporta falha

    const { supabase, admin } = clientes({});
    const r = await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });

    expect(r.encerrado).toBe(true);
    expect(r.transcricaoId).toBe("t1"); // o que NÃO pode se perder continua salvo
    expect(r.retrospecto).toBeNull();
  });

  it("🔴 retrospecto LANÇANDO (defesa em profundidade) NÃO derruba o encerramento", async () => {
    // `gravarRetrospectoDaSessao` tem try/catch próprio e não deveria lançar
    // nunca — mas o encerramento não pode DEPENDER dessa garantia.
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    gravarRetrospectoMock.mockRejectedValue(new Error("explodiu"));

    const { supabase, admin } = clientes({});
    await expect(
      executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } }),
    ).resolves.toMatchObject({ encerrado: true, transcricaoId: "t1", retrospecto: null });
  });

  it("roda DEPOIS de expirar as sugestões (o documento retrata a sessão já fechada)", async () => {
    const ordem: string[] = [];
    consolidarMock.mockImplementation(async () => {
      ordem.push("consolidar");
      return { transcricaoId: "t1", jaExistia: false };
    });
    gravarRetrospectoMock.mockImplementation(async () => {
      ordem.push("retrospecto");
      return RETROSPECTO;
    });

    const { supabase, admin } = clientes({});
    await executarEncerramentoCopiloto(supabase, admin, { sessaoId: "s1", sessao: { jornadaId: "j1", realizadaEm: null } });
    expect(ordem).toEqual(["consolidar", "retrospecto"]);
  });

  it("encerramento AUTOMÁTICO (duração máxima) grava o retrospecto com criadoPor NULL — não inventa autoria humana", async () => {
    consolidarMock.mockResolvedValue({ transcricaoId: "t1", jaExistia: false });
    gravarRetrospectoMock.mockResolvedValue(RETROSPECTO);

    const { supabase, admin } = clientes({});
    await encerrarSePassouDoTempo(supabase, admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      realizadaEm: null,
      inicioSessaoIso: "2026-09-18T12:00:00.000Z",
      duracaoMaximaMinutos: 60,
      agoraMs: Date.parse("2026-09-18T14:00:00.000Z"),
    });

    expect(gravarRetrospectoMock).toHaveBeenCalledTimes(1);
    expect(gravarRetrospectoMock.mock.calls[0][2]).toMatchObject({ sessaoId: "s1", jornadaId: "j1", criadoPor: null });
  });
});
