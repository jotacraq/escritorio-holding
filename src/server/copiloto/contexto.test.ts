import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `montarContextoCopiloto` — fallback de roteiro ATIVO (achado do
 * coordenador, 14/09/2026, medido em sessão real): `roteiro_versao_id` só é
 * carimbado por `registrar_sim_sessao` (0030) no 1º SIM — antes disso a
 * sessão chega aqui com o campo NULO, e sem fallback `bloco_atual` sai vazio
 * (medido: a IA respondeu com confiança 0,30, "sem roteiro carregado").
 *
 * Este é o PRIMEIRO teste próprio deste módulo (antes só coberto
 * indiretamente via ciclo.test.ts/sugestao/route.test.ts, que mockam
 * `montarContextoCopiloto` inteiro) — por isso cobre também o caminho já
 * existente (roteiro carimbado), não só o fallback novo.
 */

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    gte: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    maybeSingle: terminal,
    returns: encadeavel,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const BLOCOS_ATIVOS = [
  { id: "parte_00", titulo: "Check-in", objetivo: "obj", acao: null, falas: [], campos: [], observar: [], proibido: [] },
];
const DEFINICAO_ATIVA = { blocos: BLOCOS_ATIVOS };

const BLOCOS_CARIMBADOS = [
  { id: "parte_99", titulo: "Bloco carimbado", objetivo: "obj-antigo", acao: null, falas: [], campos: [], observar: [], proibido: [] },
];
const DEFINICAO_CARIMBADA = { blocos: BLOCOS_CARIMBADOS };

interface MontarSupabaseOpts {
  roteiroVersaoId: string | null;
  roteirosVersoesEmbed: { definicao: unknown } | null;
  roteiroAtivoResultado?: { data: unknown; error: unknown };
  roteiroAtivoSpy?: ReturnType<typeof vi.fn>;
  /** `sessoes_copiloto.participantes` embutido no select principal — jsonb cru. */
  participantes?: unknown;
  /** Segmentos brutos da janela D (`falante` já é o NOME do provedor, nunca papel). */
  segmentos?: Array<{ falante: string | null; texto: string; criado_em: string }>;
  /** `configuracoes['copiloto_sessao.papeis_de_fala']` — ausente cai no default `true`
   * (mesmo comportamento de produção: nasce ligado). */
  papeisDeFalaValor?: { data: unknown; error: unknown };
}

function montarSupabase(opts: MontarSupabaseOpts): SupabaseClient {
  const sessaoData = {
    id: "sessao-1",
    jornada_id: "jornada-1",
    roteiro_versao_id: opts.roteiroVersaoId,
    sims: {},
    jornadas: { pessoa_id: "pessoa-1" },
    roteiros_versoes: opts.roteirosVersoesEmbed,
    sessoes_copiloto: { participantes: opts.participantes ?? [], resumo_acumulado: {} },
  };

  const from = vi.fn((tabela: string) => {
    if (tabela === "sessoes_viabilidade") {
      return consultaEncadeavel({ data: sessaoData, error: null });
    }
    if (tabela === "roteiros_versoes") {
      opts.roteiroAtivoSpy?.();
      return consultaEncadeavel(opts.roteiroAtivoResultado ?? { data: null, error: null });
    }
    if (tabela === "briefings") {
      return consultaEncadeavel({ data: null, error: null });
    }
    if (tabela === "sessoes_copiloto_segmentos") {
      return consultaEncadeavel({ data: opts.segmentos ?? [], error: null });
    }
    if (tabela === "configuracoes") {
      return consultaEncadeavel(opts.papeisDeFalaValor ?? { data: null, error: null });
    }
    throw new Error(`tabela não mockada: ${tabela}`);
  });
  return { from } as unknown as SupabaseClient;
}

const { montarContextoCopiloto } = await import("./contexto");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("montarContextoCopiloto — fonte do roteiro", () => {
  it("roteiro_versao_id preenchido (já houve 1º SIM): usa o roteiro CARIMBADO, roteiro_fonte='carimbado', SEM 2ª query em roteiros_versoes", async () => {
    const roteiroAtivoSpy = vi.fn();
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-carimbado-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      roteiroAtivoSpy,
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.roteiro_fonte).toBe("carimbado");
    expect(contexto.bloco_atual?.id).toBe("parte_99");
    expect(contexto.bloco_atual?.objetivo).toBe("obj-antigo");
    // Caminho comum (sessão já carimbada) nunca paga a 2ª query.
    expect(roteiroAtivoSpy).not.toHaveBeenCalled();
  });

  it("🔴 roteiro_versao_id NULO (sessão antes do 1º SIM) + existe roteiro ATIVO: usa o fallback, roteiro_fonte='ativo_fallback'", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: null,
      roteirosVersoesEmbed: null,
      roteiroAtivoResultado: { data: { definicao: DEFINICAO_ATIVA }, error: null },
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.roteiro_fonte).toBe("ativo_fallback");
    expect(contexto.bloco_atual?.id).toBe("parte_00");
    expect(contexto.roteiro_ativo_blocos_ids).toEqual(["parte_00"]);
  });

  it("roteiro_versao_id NULO e NENHUM roteiro ativo: bloco_atual continua null, roteiro_fonte='nenhum' — nunca inventa bloco", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: null,
      roteirosVersoesEmbed: null,
      roteiroAtivoResultado: { data: null, error: null },
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.roteiro_fonte).toBe("nenhum");
    expect(contexto.bloco_atual).toBeNull();
    expect(contexto.roteiro_ativo_blocos_ids).toEqual([]);
  });

  it("este módulo NUNCA escreve roteiro_versao_id de volta na sessão — carimbar é ato de registrar_sim_sessao, não do copiloto", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_viabilidade") {
        const builder = consultaEncadeavel({
          data: {
            id: "sessao-1",
            jornada_id: "jornada-1",
            roteiro_versao_id: null,
            sims: {},
            jornadas: { pessoa_id: "pessoa-1" },
            roteiros_versoes: null,
            sessoes_copiloto: null,
          },
          error: null,
        }) as Record<string, unknown>;
        // update/upsert não deveriam existir na superfície usada por este módulo.
        builder.update = () => {
          throw new Error("montarContextoCopiloto não deveria chamar update() em sessoes_viabilidade");
        };
        return builder;
      }
      if (tabela === "roteiros_versoes") {
        return consultaEncadeavel({ data: { definicao: DEFINICAO_ATIVA }, error: null });
      }
      if (tabela === "briefings") return consultaEncadeavel({ data: null, error: null });
      if (tabela === "sessoes_copiloto_segmentos") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "configuracoes") return consultaEncadeavel({ data: null, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const supabase = { from } as unknown as SupabaseClient;

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.roteiro_fonte).toBe("ativo_fallback");
  });
});

describe("montarContextoCopiloto — 🔴 fronteira de PII (§7 do plano, teste mais importante desta fatia)", () => {
  it("🔴 nenhum NOME PRÓPRIO de participantes aparece em nenhuma string do ContextoCopiloto serializado", async () => {
    const NOMES_PROIBIDOS = ["João CSM", "Cláudia", "Rodrigo", "Terezinha", "Cleison", "Fulano de Tal"];
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [
        { id: "p1", nome: "João CSM", entrou_em: "10:00", saiu_em: null, papel: "advogada" },
        { id: "p2", nome: "Cláudia", entrou_em: "10:01", saiu_em: null, papel: "decisor_1" },
        { id: "p3", nome: "Rodrigo", entrou_em: "10:02", saiu_em: null, papel: "decisor_2" },
        { id: "p4", nome: "Fulano de Tal", entrou_em: "10:03", saiu_em: null, papel: "acompanhante_1" },
      ],
      segmentos: [
        { falante: "João CSM", texto: "Vamos começar a sessão.", criado_em: new Date().toISOString() },
        { falante: "Cláudia", texto: "Temos um imóvel e uma empresa.", criado_em: new Date().toISOString() },
        { falante: "Rodrigo", texto: "Concordo com ela.", criado_em: new Date().toISOString() },
        { falante: "Fulano de Tal", texto: "Posso perguntar uma coisa?", criado_em: new Date().toISOString() },
        { falante: "Terezinha", texto: "Fala antiga sem papel resolvido (sessão de antes da fatia).", criado_em: new Date().toISOString() },
      ],
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    const serializado = JSON.stringify(contexto);

    for (const nome of NOMES_PROIBIDOS) {
      expect(serializado).not.toContain(nome);
    }
    // Prova positiva de que o papel SUBSTITUIU o nome (não é um teste vazio).
    expect(contexto.janela_transcricao.some((l) => l.startsWith("advogada:"))).toBe(true);
    expect(contexto.janela_transcricao.some((l) => l.startsWith("decisor_1:"))).toBe(true);
    expect(contexto.janela_transcricao.some((l) => l.startsWith("decisor_2:"))).toBe(true);
    expect(contexto.janela_transcricao.some((l) => l.startsWith("acompanhante_1:"))).toBe(true);
  });
});

describe("montarContextoCopiloto — resolução de papel (15/09/2026, correção de cegueira)", () => {
  it("🔴 nome próprio com papel resolvido vira o PAPEL na janela de transcrição, nunca 'participante' genérico", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [{ id: "p1", nome: "João CSM", entrou_em: "10:00", saiu_em: null, papel: "advogada" }],
      segmentos: [{ falante: "João CSM", texto: "fala real", criado_em: new Date().toISOString() }],
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.janela_transcricao).toEqual(["advogada: fala real"]);
  });

  it("participante sem papel resolvido (sessão em andamento de antes desta fatia) cai no fallback 'participante' — degradação graciosa", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [{ id: "p1", nome: "João CSM", entrou_em: "10:00", saiu_em: null, papel: null }],
      segmentos: [{ falante: "João CSM", texto: "fala real", criado_em: new Date().toISOString() }],
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.janela_transcricao).toEqual(["participante: fala real"]);
  });

  it("interruptor 'copiloto_sessao.papeis_de_fala' DESLIGADO: ignora o mapa mesmo com papel gravado — volta ao 'participante' genérico", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [{ id: "p1", nome: "João CSM", entrou_em: "10:00", saiu_em: null, papel: "advogada" }],
      segmentos: [{ falante: "João CSM", texto: "fala real", criado_em: new Date().toISOString() }],
      papeisDeFalaValor: { data: { valor: false }, error: null },
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.janela_transcricao).toEqual(["participante: fala real"]);
  });

  it("caminho MANUAL preservado: falante já É o papel literal ('advogada'/'cliente') digitado pela advogada", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [], // sem participantes do bot — modo digitado
      segmentos: [
        { falante: "advogada", texto: "pergunta manual", criado_em: new Date().toISOString() },
        { falante: "cliente", texto: "resposta manual", criado_em: new Date().toISOString() },
      ],
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.janela_transcricao).toEqual(["advogada: pergunta manual", "cliente: resposta manual"]);
  });

  it("ZERO query nova: sessoes_viabilidade/roteiros_versoes/briefings/sessoes_copiloto_segmentos/configuracoes — nenhuma tabela extra", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      participantes: [{ id: "p1", nome: "João CSM", entrou_em: "10:00", saiu_em: null, papel: "advogada" }],
    });
    await montarContextoCopiloto(supabase, "sessao-1", 0);
    const tabelasChamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(new Set(tabelasChamadas)).toEqual(
      new Set(["sessoes_viabilidade", "briefings", "configuracoes", "sessoes_copiloto_segmentos"]),
    );
  });
});
