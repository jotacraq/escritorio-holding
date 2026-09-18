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
  /** Override por chave — `{ "copiloto_sessao.dossie_cliente": { data: {valor:false}, error: null } }`.
   * Só usado quando a chave pedida bate exatamente; senão cai em `papeisDeFalaValor`. */
  configuracaoPorChave?: Record<string, { data: unknown; error: unknown }>;
  /** `sessoes_copiloto.dossie_cliente` embutido no select principal — o caso
   * COMUM (sessão que já passou por `montarContextoCopiloto` ao menos 1×) é
   * já vir preenchido, por isso o default aqui NÃO é `undefined`: testes que
   * não se importam com dossiê continuam provando "zero query nova" sem
   * precisar declarar isto toda vez. Passe `null` explicitamente para testar
   * o caminho raro de 1ª montagem. */
  dossieCliente?: unknown;
  /** `sessoes_copiloto.inventario_acumulado` embutido no select principal —
   * default `[]` (sessão sem nenhum item ainda, caso comum). */
  inventarioAcumulado?: unknown;
}

const DOSSIE_JA_PERSISTIDO = { faixa_patrimonio: null, familiares: [], patrimonio_tipos: [], documentos_recebidos: [], documentos_pendentes: [] };

function montarSupabase(opts: MontarSupabaseOpts): SupabaseClient {
  const sessaoData = {
    id: "sessao-1",
    jornada_id: "jornada-1",
    roteiro_versao_id: opts.roteiroVersaoId,
    sims: {},
    jornadas: { pessoa_id: "pessoa-1" },
    roteiros_versoes: opts.roteirosVersoesEmbed,
    sessoes_copiloto: {
      participantes: opts.participantes ?? [],
      resumo_acumulado: {},
      dossie_cliente: "dossieCliente" in opts ? opts.dossieCliente : DOSSIE_JA_PERSISTIDO,
      inventario_acumulado: opts.inventarioAcumulado ?? [],
    },
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
      // Duas chaves passam por aqui (`papeis_de_fala`, `dossie_cliente`) —
      // `configuracaoPorChave` sobrepõe o valor default por chave; sem ela,
      // as duas leituras compartilham `opts.papeisDeFalaValor` (comportamento
      // de antes desta fatia, preservado para não quebrar teste que não se
      // importa com a distinção).
      const builder: Record<string, unknown> = {};
      let chavePedida: string | null = null;
      const encadeavel = (...args: unknown[]) => {
        if (args[0] === "chave") chavePedida = String(args[1]);
        return builder;
      };
      Object.assign(builder, {
        select: encadeavel,
        eq: encadeavel,
        maybeSingle: async () => {
          if (chavePedida && opts.configuracaoPorChave?.[chavePedida]) {
            return opts.configuracaoPorChave[chavePedida];
          }
          return opts.papeisDeFalaValor ?? { data: null, error: null };
        },
      });
      return builder;
    }
    throw new Error(`tabela não mockada: ${tabela}`);
  });
  return { from } as unknown as SupabaseClient;
}

const { montarContextoCopiloto, montarJanelaTranscricaoDeSegmentos, montarMapaDePapeis, rotuloFalante } = await import("./contexto");

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

describe("montarContextoCopiloto — dossiê do cliente (17/09/2026, decisão do Marcio)", () => {
  it("🔴 kill-switch 'copiloto_sessao.dossie_cliente' DESLIGADO: dossie null MESMO com dossie_cliente já persistido — não apaga a coluna, só para de EXIBIR", async () => {
    const dossiePersistido = {
      faixa_patrimonio: "5 a 10 milhões",
      familiares: [],
      patrimonio_tipos: [],
      documentos_recebidos: [],
      documentos_pendentes: [],
    };
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      dossieCliente: dossiePersistido,
      configuracaoPorChave: { "copiloto_sessao.dossie_cliente": { data: { valor: false }, error: null } },
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.dossie).toBeNull();
  });

  it("kill-switch DESLIGADO barra ANTES de montar — nenhuma query em jornadas/familiares/patrimonio_itens/documentos/documentos_pedidos", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      dossieCliente: null,
      configuracaoPorChave: { "copiloto_sessao.dossie_cliente": { data: { valor: false }, error: null } },
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.dossie).toBeNull();
    const tabelasChamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(tabelasChamadas).not.toContain("jornadas");
    expect(tabelasChamadas).not.toContain("familiares");
  });

  it("dossie_cliente JÁ PERSISTIDO (caso comum): devolve direto, SEM consultar jornadas/familiares/patrimonio_itens/documentos/documentos_pedidos", async () => {
    const dossiePersistido = {
      faixa_patrimonio: "5 a 10 milhões",
      familiares: [{ papel: "conjuge", nome: "Elaine", regime: "comunhao_parcial" }],
      patrimonio_tipos: ["imovel"],
      documentos_recebidos: ["imposto_renda"],
      documentos_pendentes: [],
    };
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      dossieCliente: dossiePersistido,
    });
    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.dossie).toEqual(dossiePersistido);
    const tabelasChamadas = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(tabelasChamadas).not.toContain("jornadas");
    expect(tabelasChamadas).not.toContain("familiares");
    expect(tabelasChamadas).not.toContain("patrimonio_itens");
    expect(tabelasChamadas).not.toContain("documentos");
    expect(tabelasChamadas).not.toContain("documentos_pedidos");
  });

  it("dossie_cliente NULO (1ª chamada da sessão): monta via buscarDossieCliente e GRAVA de volta (upsert)", async () => {
    const upsertSpy = vi.fn<(valores: Record<string, unknown>, opts: unknown) => Promise<{ error: null }>>(() =>
      Promise.resolve({ error: null }),
    );
    const supabaseBase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      dossieCliente: null,
    });
    const fromOriginal = supabaseBase.from as ReturnType<typeof vi.fn>;
    const from = vi.fn((tabela: string) => {
      if (tabela === "jornadas") return consultaEncadeavel({ data: { faixa_patrimonio_declarada: "1 a 5 milhões" }, error: null });
      if (tabela === "familiares") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "patrimonio_itens") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "documentos") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "documentos_pedidos") return consultaEncadeavel({ data: [], error: null });
      if (tabela === "sessoes_copiloto") return { upsert: upsertSpy };
      return fromOriginal(tabela);
    });
    const supabase = { from } as unknown as SupabaseClient;

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.dossie).toEqual({
      faixa_patrimonio: "1 a 5 milhões",
      familiares: [],
      patrimonio_tipos: [],
      documentos_recebidos: [],
      documentos_pendentes: [],
    });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0]![0]).toMatchObject({ sessao_id: "sessao-1" });
  });

  it("pessoa_id ausente (sessão sem jornada→pessoa resolvível): dossie null, NUNCA tenta montar", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      dossieCliente: null,
    });
    // Remove o vínculo de pessoa que `montarSupabase` normalmente embute.
    const fromOriginal = supabase.from as ReturnType<typeof vi.fn>;
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_viabilidade") {
        return consultaEncadeavel({
          data: {
            id: "sessao-1",
            jornada_id: "jornada-1",
            roteiro_versao_id: "roteiro-1",
            sims: {},
            jornadas: null,
            roteiros_versoes: { definicao: DEFINICAO_CARIMBADA },
            sessoes_copiloto: { participantes: [], resumo_acumulado: {}, dossie_cliente: null },
          },
          error: null,
        });
      }
      return fromOriginal(tabela);
    });

    const contexto = await montarContextoCopiloto({ from } as unknown as SupabaseClient, "sessao-1", 0);
    expect(contexto.dossie).toBeNull();
  });
});

describe("montarContextoCopiloto — bloco G: resumo do inventário mencionado (17/09/2026)", () => {
  it("sessão sem nenhum item acumulado: resumo com listas vazias, ZERO query nova", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      inventarioAcumulado: [],
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.inventario_resumo).toEqual({ por_categoria: [], total_itens_proprios: 0, total_itens_incertos: 0 });
  });

  it("resume por categoria a partir do que já veio no select principal (sem query extra)", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      inventarioAcumulado: [
        {
          chave: "imovel:sala comercial no centro",
          categoria: "imovel",
          descricao: "sala comercial no centro",
          titularidade: "do casal",
          posse: "propria",
          valor_mencionado: "uns 800 mil",
          evidencia: "temos uma sala comercial no centro",
          primeira_mencao_em: "2026-09-17T10:00:00Z",
          ultima_mencao_em: "2026-09-17T10:00:00Z",
        },
        {
          chave: "empresa:construtora do genro",
          categoria: "empresa",
          descricao: "construtora do genro",
          titularidade: null,
          posse: "terceiro",
          valor_mencionado: null,
          evidencia: "meu genro tem uma construtora",
          primeira_mencao_em: "2026-09-17T10:05:00Z",
          ultima_mencao_em: "2026-09-17T10:05:00Z",
        },
      ],
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);

    expect(contexto.inventario_resumo).toEqual({
      por_categoria: [{ categoria: "imovel", contagem_propria: 1, contagem_incerta: 0, sem_titularidade: 0 }],
      total_itens_proprios: 1,
      total_itens_incertos: 0,
    });
  });

  it("🔴 kill-switch 'copiloto_sessao.inventario_mencionado' DESLIGADO: resumo null, mesmo com itens já acumulados", async () => {
    const supabase = montarSupabase({
      roteiroVersaoId: "roteiro-1",
      roteirosVersoesEmbed: { definicao: DEFINICAO_CARIMBADA },
      inventarioAcumulado: [
        {
          chave: "imovel:sala",
          categoria: "imovel",
          descricao: "sala",
          titularidade: null,
          posse: "propria",
          valor_mencionado: null,
          evidencia: "temos uma sala",
          primeira_mencao_em: "2026-09-17T10:00:00Z",
          ultima_mencao_em: "2026-09-17T10:00:00Z",
        },
      ],
      configuracaoPorChave: { "copiloto_sessao.inventario_mencionado": { data: { valor: false }, error: null } },
    });

    const contexto = await montarContextoCopiloto(supabase, "sessao-1", 0);
    expect(contexto.inventario_resumo).toBeNull();
  });
});

/**
 * `montarJanelaTranscricaoDeSegmentos` — núcleo PURO do bloco D, extraído de
 * `buscarJanelaTranscricao` em 18/09/2026 para reuso em
 * `scripts/bancada-copiloto.ts` (REPLAY de sessão real). Estes casos replicam
 * a regra de produção operação a operação: filtro por `criado_em >= agora -
 * janela`, corte em `MAX_SEGMENTOS_JANELA`, e troca de nome por papel via
 * `rotuloFalante` — na MESMA ordem da query (`gte` → `order by ordem` →
 * `limit`). Isto é a "função que reconstrói a janela a partir dos segmentos"
 * exigida pela tarefa: ela replica regra de produção, não pode ficar sem
 * teste.
 */
describe("montarJanelaTranscricaoDeSegmentos — núcleo puro do bloco D", () => {
  const AGORA = new Date("2026-09-18T12:00:00Z").getTime();

  function seg(segundosAtras: number, falante: string | null, texto: string): { falante: string | null; texto: string; criado_em: string } {
    return { falante, texto, criado_em: new Date(AGORA - segundosAtras * 1000).toISOString() };
  }

  it("descarta segmento mais velho que a janela (90s) e mantém o resto, na ordem recebida", () => {
    const segmentos = [seg(120, "advogada", "fala antiga, fora da janela"), seg(60, "advogada", "fala dentro da janela"), seg(10, "cliente", "fala mais recente")];

    const janela = montarJanelaTranscricaoDeSegmentos(segmentos, null, { agora: AGORA });

    expect(janela).toEqual(["advogada: fala dentro da janela", "cliente: fala mais recente"]);
  });

  it("segmento EXATAMENTE no limite da janela (>=) entra — mesmo operador `gte` da query em produção", () => {
    const segmentos = [seg(90, "advogada", "no limite exato")];
    const janela = montarJanelaTranscricaoDeSegmentos(segmentos, null, { agora: AGORA, janelaSegundos: 90 });
    expect(janela).toEqual(["advogada: no limite exato"]);
  });

  it("respeita o teto de segmentos (MAX_SEGMENTOS_JANELA) mesmo com mais linhas dentro da janela de tempo", () => {
    const segmentos = Array.from({ length: 5 }, (_, i) => seg(10 - i, "advogada", `fala ${i}`));
    const janela = montarJanelaTranscricaoDeSegmentos(segmentos, null, { agora: AGORA, maxSegmentos: 2 });
    expect(janela).toEqual(["advogada: fala 0", "advogada: fala 1"]);
  });

  it("troca nome próprio por papel via mapaDePapeis (§7 — nome nunca sai desta função)", () => {
    const mapa = montarMapaDePapeis([
      { nome: "João CSM", entrou_em: "2026-09-18T11:00:00Z", saiu_em: null, papel: "decisor_1" },
    ]);
    const segmentos = [seg(5, "João CSM", "eu queria proteger o imóvel")];

    const janela = montarJanelaTranscricaoDeSegmentos(segmentos, mapa, { agora: AGORA });

    expect(janela).toEqual(["decisor_1: eu queria proteger o imóvel"]);
  });

  it("sem mapa de papéis, cai no fallback conhecido (advogada/cliente) ou 'participante' — nunca o nome próprio", () => {
    expect(rotuloFalante("advogada", null)).toBe("advogada");
    expect(rotuloFalante("Terezinha Alves", null)).toBe("participante");
    expect(rotuloFalante(null, null)).toBe("participante");
  });

  it("array vazio devolve janela vazia, sem lançar", () => {
    expect(montarJanelaTranscricaoDeSegmentos([], null, { agora: AGORA })).toEqual([]);
  });
});
