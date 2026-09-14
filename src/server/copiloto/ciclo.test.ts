import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O CICLO AUTOMÁTICO (Fase 10, Fatia 3, §4.3/§6.2.2 do plano) — orquestração
 * testada com os módulos que ele chama MOCKADOS (cada um já tem teste
 * próprio: gate.test.ts, orcamento.test.ts, executar-ia.test.ts,
 * gatilho.test.ts). O que ESTE arquivo prova é a ORDEM e o efeito de cada
 * recusa — em particular o ponto central da fatia: 🔴 O GATE RODA A CADA
 * CICLO, não uma vez. Revogação no meio da sessão cala o CICLO SEGUINTE.
 */

const avaliarGatilhoMock = vi.fn();
const conferirGateMock = vi.fn();
const conferirOrcamentoMock = vi.fn();
const montarContextoMock = vi.fn();
const executarIaMock = vi.fn();
const validarSugestaoMock = vi.fn();
const sugestaoEVisivelMock = vi.fn();
const lerConfiguracaoIntMock = vi.fn();
const lerConfiguracaoJsonMock = vi.fn();
const encerrarSePassouDoTempoMock = vi.fn();

vi.mock("./gatilho", () => ({ avaliarGatilho: (...a: unknown[]) => avaliarGatilhoMock(...a) }));
vi.mock("./gate", () => ({ conferirGateCopiloto: (...a: unknown[]) => conferirGateMock(...a) }));
vi.mock("./orcamento", () => ({ conferirOrcamentoCopiloto: (...a: unknown[]) => conferirOrcamentoMock(...a) }));
vi.mock("./contexto", () => ({ montarContextoCopiloto: (...a: unknown[]) => montarContextoMock(...a) }));
vi.mock("./executar-ia", () => ({ executarIaCopiloto: (...a: unknown[]) => executarIaMock(...a) }));
vi.mock("./validar", () => ({
  validarSugestaoCopiloto: (...a: unknown[]) => validarSugestaoMock(...a),
  sugestaoEVisivel: (...a: unknown[]) => sugestaoEVisivelMock(...a),
}));
// `encerrarSePassouDoTempo` MOCKADO explicitamente (tem teste próprio em
// encerrar.test.ts) — sem este mock, o real rodaria contra os Supabase
// falsos deste arquivo e "passaria" só por coincidência de datas (achado na
// revisão: os testes originais funcionavam porque AGORA-iniciado_em=30min <
// qualquer teto plausível, não porque o caminho estava coberto).
vi.mock("./encerrar", () => ({ encerrarSePassouDoTempo: (...a: unknown[]) => encerrarSePassouDoTempoMock(...a) }));
vi.mock("@/server/ia/configuracao", () => ({
  lerConfiguracaoInt: (...a: unknown[]) => lerConfiguracaoIntMock(...a),
  lerConfiguracaoJson: (...a: unknown[]) => lerConfiguracaoJsonMock(...a),
}));

const { executarCicloCopiloto } = await import("./ciclo");

beforeEach(() => {
  // Default: sessão dentro do teto de duração — a maioria dos testes deste
  // arquivo testa gatilho/gate/orçamento/IA, não duração máxima. O teste
  // dedicado de "sessao_encerrada_por_duracao_maxima" sobrescreve isto.
  encerrarSePassouDoTempoMock.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

const AGORA = Date.parse("2026-09-11T14:00:00.000Z");
const SESSAO_ATIVA = {
  jornada_id: "j1",
  criado_em: "2026-09-11T13:00:00.000Z",
  sessoes_copiloto: { estado: "ativo", iniciado_em: "2026-09-11T13:30:00.000Z", criado_em: "2026-09-11T13:30:00.000Z" },
  jornadas: { pessoa_id: "p1" },
};

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

/** Supabase falso com DUAS superfícies: leitura de `sessoes_viabilidade`
 * (supabase comum) e INSERT de `copiloto_ciclos`/`copiloto_sugestoes`
 * (admin). Controlado por tabela. */
function clientes(opts: { sessao?: Resultado; claim?: Resultado; insercaoSugestao?: Resultado }) {
  const sessaoResultado = opts.sessao ?? { data: SESSAO_ATIVA, error: null };
  const claimResultado = opts.claim ?? { data: { sessao_id: "s1" }, error: null };
  const insercaoResultado = opts.insercaoSugestao ?? { data: { id: "sugestao-1" }, error: null };

  class ConsultaSessao implements PromiseLike<Resultado> {
    select() { return this; }
    eq() { return this; }
    maybeSingle() { return Promise.resolve(sessaoResultado); }
    then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
      return Promise.resolve(sessaoResultado).then(ok) as PromiseLike<R1>;
    }
  }

  class ConsultaClaim implements PromiseLike<Resultado> {
    insert() { return this; }
    select() { return this; }
    maybeSingle() { return Promise.resolve(claimResultado); }
    then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
      return Promise.resolve(claimResultado).then(ok) as PromiseLike<R1>;
    }
  }

  class ConsultaSugestao implements PromiseLike<Resultado> {
    insert() { return this; }
    select() { return this; }
    single() { return Promise.resolve(insercaoResultado); }
    then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
      return Promise.resolve(insercaoResultado).then(ok) as PromiseLike<R1>;
    }
  }

  const supabase = { from: (t: string) => (t === "sessoes_viabilidade" ? new ConsultaSessao() : new ConsultaSessao()) } as unknown as SupabaseClient;
  const admin = {
    from: (t: string) => {
      if (t === "copiloto_ciclos") return new ConsultaClaim();
      if (t === "copiloto_sugestoes") return new ConsultaSugestao();
      return new ConsultaSessao();
    },
  } as unknown as SupabaseClient;

  return { supabase, admin };
}

const CONTEXTO_VAZIO = {
  roteiro_fonte: "carimbado",
  bloco_atual: { id: "bloco-1", titulo: "x", objetivo: null, acao: null, campos: [], observar: [], proibido: [] },
  bloco_anterior_titulo: null,
  bloco_seguinte_titulo: null,
  briefing_recorte: null,
  estado_factual: { sims_registrados: [], blocos_percorridos: [], campos_pendentes_no_bloco: [], decisores_esperados: null, decisores_presentes: null },
  janela_transcricao: [],
  resumo_acumulado: {},
  roteiro_ativo_blocos_ids: ["bloco-1"],
};

describe("executarCicloCopiloto — ordem e efeito de cada trava", () => {
  it("🔴 CORREÇÃO (achado do coordenador): duração máxima estourada → sessao_encerrada_por_duracao_maxima, ZERO chamada de gatilho/gate/IA", async () => {
    encerrarSePassouDoTempoMock.mockResolvedValue(true);
    lerConfiguracaoIntMock.mockResolvedValue(150); // duracao_maxima_minutos
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toEqual({ situacao: "sessao_encerrada_por_duracao_maxima" });
    expect(encerrarSePassouDoTempoMock).toHaveBeenCalledTimes(1);
    expect(avaliarGatilhoMock).not.toHaveBeenCalled();
    expect(conferirGateMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("duração DENTRO do teto → encerrarSePassouDoTempo devolve false, ciclo segue normalmente para avaliar gatilho", async () => {
    encerrarSePassouDoTempoMock.mockResolvedValue(false);
    avaliarGatilhoMock.mockResolvedValue({ dispara: false, gatilho: null });
    lerConfiguracaoIntMock.mockResolvedValue(150);
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toEqual({ situacao: "nenhum_gatilho" });
    expect(avaliarGatilhoMock).toHaveBeenCalledTimes(1);
  });

  it("sessão sem sessoes_copiloto (Fatia 1 nunca ativada) → sessao_nao_ativa_para_ciclo, ZERO chamada de gatilho", async () => {
    const { supabase, admin } = clientes({ sessao: { data: { ...SESSAO_ATIVA, sessoes_copiloto: null }, error: null } });
    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });
    expect(r).toEqual({ situacao: "sessao_nao_ativa_para_ciclo" });
    expect(avaliarGatilhoMock).not.toHaveBeenCalled();
  });

  it("sessao_copiloto.estado='encerrado' → sessao_nao_ativa_para_ciclo, ZERO chamada de gatilho (sessão encerrada não dispara ciclo)", async () => {
    const { supabase, admin } = clientes({
      sessao: { data: { ...SESSAO_ATIVA, sessoes_copiloto: { ...SESSAO_ATIVA.sessoes_copiloto, estado: "encerrado" } }, error: null },
    });
    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });
    expect(r).toEqual({ situacao: "sessao_nao_ativa_para_ciclo" });
    expect(avaliarGatilhoMock).not.toHaveBeenCalled();
  });

  it("gatilho não bate → nenhum_gatilho, ZERO claim (não escreve em copiloto_ciclos)", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: false, gatilho: null });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    const { supabase, admin } = clientes({});
    const insertSpy = vi.fn();
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "copiloto_ciclos") {
        insertSpy();
        throw new Error("não deveria chamar copiloto_ciclos quando o gatilho não bate");
      }
      return clientes({}).admin.from(t);
    };

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });
    expect(r).toEqual({ situacao: "nenhum_gatilho" });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("gatilho bate MAS a claim já foi tomada por outra requisição (on conflict do nothing) → janela_ja_claimada, ZERO gate/orçamento/IA", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    const { supabase, admin } = clientes({ claim: { data: null, error: null } }); // insert...returning devolve null = 0 linha afetada
    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });
    expect(r).toEqual({ situacao: "janela_ja_claimada_por_outra_requisicao" });
    expect(conferirGateMock).not.toHaveBeenCalled();
    expect(conferirOrcamentoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("🔴 PONTO CENTRAL DA FATIA: claimou a janela, MAS o gate jurídico recusa (revogação no meio da sessão) → bloqueado_pelo_gate, ZERO chamada de IA", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: false, motivo: "sem_consentimento_titular" });
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toEqual({ situacao: "bloqueado_pelo_gate", motivo: "sem_consentimento_titular" });
    // O GATE FOI CHAMADO (é o comportamento central: roda A CADA CICLO) —
    // mas nada depois dele.
    expect(conferirGateMock).toHaveBeenCalledTimes(1);
    expect(conferirOrcamentoMock).not.toHaveBeenCalled();
    expect(montarContextoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("gate liberado, orçamento estourado → orcamento_estourado, ZERO chamada de IA", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: false, naSessao: 30, noDia: 10, motivo: "teto_ia_sessao" });
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toEqual({ situacao: "orcamento_estourado", motivo: "teto_ia_sessao" });
    expect(montarContextoMock).not.toHaveBeenCalled();
    expect(executarIaMock).not.toHaveBeenCalled();
  });

  it("gate e orçamento liberados, IA estoura timeout → timeout", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 1, noDia: 1, motivo: null });
    montarContextoMock.mockResolvedValue(CONTEXTO_VAZIO);
    executarIaMock.mockResolvedValue({ situacao: "timeout" });
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });
    expect(r).toEqual({ situacao: "timeout" });
  });

  it("caminho feliz completo: gatilho → claim → gate → orçamento → IA → validação → grava sugestão", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "virada_bloco" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 1, noDia: 1, motivo: null });
    montarContextoMock.mockResolvedValue(CONTEXTO_VAZIO);
    executarIaMock.mockResolvedValue({ situacao: "ok", saida: {}, execucaoId: "exec-1", custoUsd: 0.01 });
    validarSugestaoMock.mockReturnValue({
      sugestao: { proxima_pergunta: null, falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.8, campos_evidencia_nao_conferida: [] },
      motivoRecusaTotal: null,
    });
    lerConfiguracaoJsonMock.mockResolvedValue(0.6);
    sugestaoEVisivelMock.mockReturnValue(true);
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toMatchObject({ situacao: "sugestao_gravada", sugestaoId: "sugestao-1", gatilho: "virada_bloco", visivel: true });
  });

  it("caminho feliz, mas confiança abaixo do mínimo → sugestao_gravada com visivel:false e sugestao:null na resposta (a linha AINDA é gravada)", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 1, noDia: 1, motivo: null });
    montarContextoMock.mockResolvedValue(CONTEXTO_VAZIO);
    executarIaMock.mockResolvedValue({ situacao: "ok", saida: {}, execucaoId: "exec-1", custoUsd: 0.01 });
    validarSugestaoMock.mockReturnValue({
      sugestao: { proxima_pergunta: null, falta_no_bloco: [], observacao: null, desvio_sugerido: null, confianca_geral: 0.2, campos_evidencia_nao_conferida: [] },
      motivoRecusaTotal: null,
    });
    lerConfiguracaoJsonMock.mockResolvedValue(0.6);
    sugestaoEVisivelMock.mockReturnValue(false);
    const { supabase, admin } = clientes({});

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toMatchObject({ situacao: "sugestao_gravada", visivel: false, sugestao: null });
  });

  it("saída recusada pelo validador (termo proibido) → conteudo_recusado, NADA gravado em copiloto_sugestoes", async () => {
    avaliarGatilhoMock.mockResolvedValue({ dispara: true, gatilho: "intervalo" });
    lerConfiguracaoIntMock.mockResolvedValue(45);
    conferirGateMock.mockResolvedValue({ liberado: true, motivo: null });
    conferirOrcamentoMock.mockResolvedValue({ dentro: true, naSessao: 1, noDia: 1, motivo: null });
    montarContextoMock.mockResolvedValue(CONTEXTO_VAZIO);
    executarIaMock.mockResolvedValue({ situacao: "ok", saida: {}, execucaoId: "exec-1", custoUsd: 0.01 });
    validarSugestaoMock.mockReturnValue({ sugestao: null, motivoRecusaTotal: "termo_proibido" });
    const { supabase, admin } = clientes({});
    const insercaoSpy = vi.fn();
    const originalFrom = admin.from.bind(admin);
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "copiloto_sugestoes") insercaoSpy();
      return originalFrom(t);
    };

    const r = await executarCicloCopiloto(supabase, admin, { sessaoId: "s1", blocoAtualIndice: 0, agoraMs: AGORA });

    expect(r).toEqual({ situacao: "conteudo_recusado" });
    expect(insercaoSpy).not.toHaveBeenCalled();
  });
});
