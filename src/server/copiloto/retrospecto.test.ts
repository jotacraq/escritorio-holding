import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroBloco } from "@/types/roteiro";
import type { FichaAcumulada, InventarioAcumulado, SugestaoCopiloto } from "@/types/copiloto";

/**
 * RETROSPECTO DA SESSÃO — Fase 13, BE-2/BE-3 (`docs/ARQUITETURA-FASE-13.md`).
 *
 * 🔴 O TESTE QUE IMPORTA É O PRIMEIRO: a cobertura calculada tem de
 * reproduzir **4/13, 9/13 e 6/13** — os números MEDIDOS em produção
 * (`fcfsnqqaphtamhrpuyoh`, 19/09/2026) nas 3 sessões reais já encerradas. Os
 * `bloco_id` abaixo não são inventados: são os conjuntos distintos que a
 * consulta `select sessao_id, bloco_id from copiloto_sugestoes` devolveu,
 * copiados literalmente. Se alguém mudar a regra de cobertura, é aqui que
 * quebra.
 *
 * Nenhuma citação literal de cliente aparece neste arquivo — as evidências
 * dos fixtures são texto sintético.
 */

const lerConfiguracaoBoolMock = vi.fn();
vi.mock("@/server/ia/configuracao", () => ({
  lerConfiguracaoBool: (...a: unknown[]) => lerConfiguracaoBoolMock(...a),
}));

const {
  montarConteudoRetrospecto,
  gravarRetrospectoDaSessao,
  lerRetrospectoDaSessao,
  lerRetrospectoComEstado,
  remontarRetrospectoSeEncerrada,
  montarDocxRetrospecto,
  TETO_BYTES_CHECK_0125,
} = await import("./retrospecto");

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

/** O roteiro `sessao_viabilidade` v5 (o que conduziu as 3 sessões reais): 13
 * partes, `parte_00` a `parte_12`. Conferido em produção em 19/09/2026 — as
 * versões v1 a v5 têm as MESMAS 13, então o denominador é 13 nas três
 * sessões, mesmo a mais antiga tendo `roteiro_versao_id` da v4. */
const ROTEIRO_13: RoteiroBloco[] = Array.from({ length: 13 }, (_, i) => ({
  id: `parte_${String(i).padStart(2, "0")}`,
  titulo: `Parte ${i}`,
  objetivo: null,
  acao: null,
  falas: [],
  campos: [],
  observar: [],
  proibido: [],
}));

function conteudoVazio(extra: Partial<SugestaoCopiloto> = {}): SugestaoCopiloto {
  return {
    proxima_pergunta: null,
    falta_no_bloco: [],
    observacao: null,
    desvio_sugerido: null,
    confianca_geral: 0.7,
    campos_evidencia_nao_conferida: [],
    ...extra,
  };
}

function sugestoesComBlocos(blocoIds: string[]) {
  return blocoIds.map((bloco_id) => ({
    bloco_id,
    conteudo: conteudoVazio(),
    confianca: 0.6,
  }));
}

function insumos(over: Partial<Parameters<typeof montarConteudoRetrospecto>[0]> = {}) {
  return {
    blocos: ROTEIRO_13,
    sugestoes: [],
    ficha: [] as FichaAcumulada,
    inventario: [] as InventarioAcumulado,
    iniciadoEm: "2026-09-18T12:06:45.936Z",
    encerradoEm: "2026-09-18T14:08:05.755Z",
    execucoes: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// BE-2 — COBERTURA contra os números REAIS
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — cobertura reproduz as 3 sessões reais (medido 19/09/2026)", () => {
  // Conjuntos DISTINTOS de `bloco_id` medidos em produção, sessão a sessão.
  const SESSOES_REAIS: Array<{ nome: string; blocos: string[]; esperado: number }> = [
    { nome: "755d87d7 (70 sugestões)", blocos: ["parte_00", "parte_01", "parte_03", "parte_09"], esperado: 4 },
    {
      nome: "b3eca233 (178 sugestões)",
      blocos: ["parte_00", "parte_01", "parte_02", "parte_03", "parte_04", "parte_05", "parte_08", "parte_10", "parte_11"],
      esperado: 9,
    },
    {
      nome: "ebbf08d4 (121 sugestões)",
      blocos: ["parte_00", "parte_01", "parte_03", "parte_04", "parte_11", "parte_12"],
      esperado: 6,
    },
  ];

  for (const sessao of SESSOES_REAIS) {
    it(`${sessao.nome} → ${sessao.esperado} de 13 partes`, () => {
      // Cada bloco aparece VÁRIAS vezes (a sessão gera dezenas de sugestões
      // no mesmo bloco) — a contagem é DISTINTA, não total.
      const repetidos = [...sessao.blocos, ...sessao.blocos, ...sessao.blocos];
      const c = montarConteudoRetrospecto(insumos({ sugestoes: sugestoesComBlocos(repetidos) }));
      expect(c.cobertura.blocos_com_atividade).toBe(sessao.esperado);
      expect(c.cobertura.blocos_no_roteiro).toBe(13);
      expect(c.cobertura.nao_percorridos).toHaveLength(13 - sessao.esperado);
    });
  }

  it("`nao_percorridos` vem na ORDEM do roteiro, com id, título e índice — não é só a contagem", () => {
    const c = montarConteudoRetrospecto(insumos({ sugestoes: sugestoesComBlocos(["parte_00", "parte_12"]) }));
    expect(c.cobertura.nao_percorridos.map((b) => b.id)).toEqual([
      "parte_01", "parte_02", "parte_03", "parte_04", "parte_05",
      "parte_06", "parte_07", "parte_08", "parte_09", "parte_10", "parte_11",
    ]);
    expect(c.cobertura.nao_percorridos[0]).toEqual({ id: "parte_01", titulo: "Parte 1", indice: 1 });
  });

  it("🔴 bloco_id que NÃO existe no roteiro da sessão não conta (senão a cobertura passaria de 100% e o CHECK da 0125 recusaria a linha)", () => {
    const c = montarConteudoRetrospecto(
      insumos({ sugestoes: sugestoesComBlocos(["parte_00", "bloco_de_outro_roteiro", "parte_99"]) }),
    );
    expect(c.cobertura.blocos_com_atividade).toBe(1);
    expect(c.cobertura.blocos_com_atividade).toBeLessThanOrEqual(c.cobertura.blocos_no_roteiro);
  });

  it("sugestão sem bloco_id (null) não conta como atividade", () => {
    const c = montarConteudoRetrospecto(
      insumos({ sugestoes: [{ bloco_id: null, conteudo: conteudoVazio(), confianca: 0.5 }] }),
    );
    expect(c.cobertura.blocos_com_atividade).toBe(0);
  });

  it("sessão sem sugestão nenhuma: 0 de 13, e as 13 partes aparecem como não percorridas — nunca 'sem dados'", () => {
    const c = montarConteudoRetrospecto(insumos());
    expect(c.cobertura.blocos_com_atividade).toBe(0);
    expect(c.cobertura.nao_percorridos).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// DURAÇÃO, PATRIMÔNIO
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — duração e patrimônio", () => {
  it("duração sai dos dois carimbos (b3eca233 real: 12:06:45 → 14:08:05 = 121 min)", () => {
    const c = montarConteudoRetrospecto(insumos());
    expect(c.duracao.minutos).toBe(121);
  });

  it("🔴 falta um dos carimbos → minutos é null, NUNCA 0 (vazio é vazio, nunca zero)", () => {
    expect(montarConteudoRetrospecto(insumos({ encerradoEm: null })).duracao.minutos).toBeNull();
    expect(montarConteudoRetrospecto(insumos({ iniciadoEm: null })).duracao.minutos).toBeNull();
  });

  it("🔴 inventário vazio → patrimonio é null, NUNCA um objeto de zeros (medido: 1 das 3 sessões reais tem 0 itens)", () => {
    expect(montarConteudoRetrospecto(insumos()).patrimonio).toBeNull();
  });

  it("patrimônio reusa resumirInventario: 'terceiro' não entra na contagem de próprios, 'incerta' vai separado", () => {
    const inventario: InventarioAcumulado = [
      { categoria: "imovel", descricao: "Casa", titularidade: null, posse: "propria", valor_mencionado: null, evidencia: "e1", chave: "imovel:casa", primeira_mencao_em: "2026-09-18T12:10:00Z", ultima_mencao_em: "2026-09-18T12:10:00Z" },
      { categoria: "empresa", descricao: "Empresa do genro", titularidade: "genro", posse: "terceiro", valor_mencionado: null, evidencia: "e2", chave: "empresa:empresa do genro", primeira_mencao_em: "2026-09-18T12:11:00Z", ultima_mencao_em: "2026-09-18T12:11:00Z" },
      { categoria: "imovel", descricao: "Sala", titularidade: null, posse: "incerta", valor_mencionado: null, evidencia: "e3", chave: "imovel:sala", primeira_mencao_em: "2026-09-18T12:12:00Z", ultima_mencao_em: "2026-09-18T12:12:00Z" },
    ];
    const c = montarConteudoRetrospecto(insumos({ inventario }));
    expect(c.patrimonio).not.toBeNull();
    expect(c.patrimonio!.total_itens_proprios).toBe(1);
    expect(c.patrimonio!.total_itens_incertos).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// OBSERVAÇÕES SOBRE O CLIENTE
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — observações sobre o cliente", () => {
  const ficha: FichaAcumulada = [
    { categoria: "dor", texto: "Medo de perder qualidade de vida", evidencia: "citacao-dor", chave: "dor:x", primeira_mencao_em: "2026-09-18T12:20:00Z", ultima_mencao_em: "2026-09-18T12:20:00Z", n: 2 },
    { categoria: "objecao", texto: "Acha o imposto alto", evidencia: "citacao-objecao", chave: "objecao:y", primeira_mencao_em: "2026-09-18T12:30:00Z", ultima_mencao_em: "2026-09-18T12:30:00Z", n: 1 },
  ];

  it("🔴 a ordem é a regra de negócio do dono, já produzida por ordenarFicha: OBJEÇÃO antes de DOR, mesmo com n menor", () => {
    const c = montarConteudoRetrospecto(insumos({ ficha }));
    expect(c.observacoes_do_cliente[0].categoria).toBe("objecao");
    expect(c.observacoes_do_cliente[0].n).toBe(1);
    expect(c.observacoes_do_cliente[1].categoria).toBe("dor");
    expect(c.observacoes_do_cliente[1].n).toBe(2);
  });

  it("observação da IA repetida vira UM item com n=3, e guarda a MAIOR confiança", () => {
    const sugestoes = [0.4, 0.9, 0.6].map((confianca, i) => ({
      bloco_id: "parte_01",
      conteudo: conteudoVazio({
        // Mesma frase com acento/caixa/espaço diferentes — a deduplicação é
        // por texto NORMALIZADO, igual à do acumulador da Ficha.
        observacao: { tipo: "fato" as const, texto: i === 1 ? "A  Família  TEM três filhos" : "A familia tem tres filhos", evidencia: null, confianca },
      }),
      confianca,
    }));
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    const daIa = c.observacoes_do_cliente.filter((o) => o.origem === "observacao");
    expect(daIa).toHaveLength(1);
    expect(daIa[0].n).toBe(3);
    expect(daIa[0].confianca).toBe(0.9);
  });

  it("observações da IA saem agrupadas por tipo, na ordem da casa: fato · hipótese · inferência · recomendação", () => {
    const tipos = ["recomendacao", "inferencia", "hipotese", "fato"] as const;
    const sugestoes = tipos.map((tipo) => ({
      bloco_id: "parte_01",
      conteudo: conteudoVazio({ observacao: { tipo, texto: `obs ${tipo}`, evidencia: null, confianca: 0.5 } }),
      confianca: 0.5,
    }));
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(c.observacoes_do_cliente.map((o) => o.tipo)).toEqual(["fato", "hipotese", "inferencia", "recomendacao"]);
  });

  it("🔴 evidência já redigida na fonte ('' depois do expurgo) entra como null, nunca como string vazia fingindo citação", () => {
    const fichaRedigida: FichaAcumulada = [{ ...ficha[0], evidencia: "" }];
    const c = montarConteudoRetrospecto(insumos({ ficha: fichaRedigida }));
    expect(c.observacoes_do_cliente[0].evidencia).toBeNull();
  });

  it("observação com texto vazio/só espaço é ignorada (não vira item em branco no documento)", () => {
    const sugestoes = [
      {
        bloco_id: "parte_01",
        conteudo: conteudoVazio({ observacao: { tipo: "fato" as const, texto: "   ", evidencia: null, confianca: 0.5 } }),
        confianca: 0.5,
      },
    ];
    expect(montarConteudoRetrospecto(insumos({ sugestoes })).observacoes_do_cliente).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PONTOS DE MELHORIA
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — pontos de melhoria da condução", () => {
  it("🔴 item que apareceu em cobriu_no_bloco NÃO vira ponto de melhoria, mesmo tendo aparecido em falta_no_bloco antes", () => {
    const sugestoes = [
      {
        bloco_id: "parte_01",
        conteudo: conteudoVazio({
          falta_no_bloco: [{ item: "Perguntar sobre o regime de bens", evidencia: null }, { item: "Confirmar os filhos", evidencia: null }],
        }),
        confianca: 0.5,
      },
      {
        bloco_id: "parte_02",
        conteudo: conteudoVazio({ cobriu_no_bloco: [{ item: "perguntar sobre o REGIME de bens", evidencia: null }] }),
        confianca: 0.5,
      },
    ];
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(c.pontos_de_melhoria.map((p) => p.item)).toEqual(["Confirmar os filhos"]);
  });

  it("o mesmo item apontado em 3 janelas vira UM ponto com n=3, e o bloco é o da ocorrência mais recente", () => {
    const sugestoes = ["parte_01", "parte_01", "parte_05"].map((bloco_id) => ({
      bloco_id,
      conteudo: conteudoVazio({ falta_no_bloco: [{ item: "Confirmar os filhos", evidencia: null }] }),
      confianca: 0.5,
    }));
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(c.pontos_de_melhoria).toHaveLength(1);
    expect(c.pontos_de_melhoria[0].n).toBe(3);
    expect(c.pontos_de_melhoria[0].bloco_id).toBe("parte_05");
    expect(c.pontos_de_melhoria[0].bloco_titulo).toBe("Parte 5");
  });

  it("bloco_id órfão (fora do roteiro) não vira bloco_titulo inventado — fica null", () => {
    const sugestoes = [
      {
        bloco_id: "bloco_de_outro_roteiro",
        conteudo: conteudoVazio({ falta_no_bloco: [{ item: "Confirmar os filhos", evidencia: null }] }),
        confianca: 0.5,
      },
    ];
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(c.pontos_de_melhoria[0].bloco_id).toBeNull();
    expect(c.pontos_de_melhoria[0].bloco_titulo).toBeNull();
  });

  it("🔴 ponto de melhoria NÃO carrega evidência (é descrição do que faltou, não fala do cliente)", () => {
    const sugestoes = [
      {
        bloco_id: "parte_01",
        conteudo: conteudoVazio({ falta_no_bloco: [{ item: "Confirmar os filhos", evidencia: "citacao-literal-do-cliente" }] }),
        confianca: 0.5,
      },
    ];
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(JSON.stringify(c.pontos_de_melhoria)).not.toContain("citacao-literal-do-cliente");
  });
});

// ---------------------------------------------------------------------------
// SAÚDE DO MOTOR
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — saúde do motor", () => {
  it("numerador + denominador, nunca percentual pronto: confiança média, evidência não conferida e truncadas", () => {
    const sugestoes = [
      { bloco_id: "parte_01", conteudo: conteudoVazio({ campos_evidencia_nao_conferida: ["observacao.evidencia"] }), confianca: 0.5 },
      { bloco_id: "parte_01", conteudo: conteudoVazio(), confianca: 0.7 },
      { bloco_id: "parte_02", conteudo: conteudoVazio(), confianca: null },
    ];
    // 🔴 As execuções NÃO saem das sugestões (ver `carregarExecucoesDaSessao`):
    // uma execução truncada nunca vira sugestão, então contar por ali daria
    // sempre 0. Aqui há 2 execuções na janela e só 1 delas produziu sugestão.
    const c = montarConteudoRetrospecto(
      insumos({
        sugestoes,
        execucoes: [
          { id: "e1", stop_reason: "max_tokens" },
          { id: "e2", stop_reason: "end_turn" },
        ],
      }),
    );
    expect(c.saude_do_motor.sugestoes).toBe(3);
    expect(c.saude_do_motor.confianca_media).toBe(0.6); // média só de quem TEM confiança
    expect(c.saude_do_motor.sugestoes_com_evidencia_nao_conferida).toBe(1);
    expect(c.saude_do_motor.execucoes_ia).toBe(2);
    expect(c.saude_do_motor.execucoes_truncadas).toBe(1);
  });

  it("'length' (nome do mesmo evento em provedores compatíveis com OpenAI) também conta como truncada", () => {
    const c = montarConteudoRetrospecto(insumos({ execucoes: [{ id: "e1", stop_reason: "length" }] }));
    expect(c.saude_do_motor.execucoes_truncadas).toBe(1);
  });


  it("🔴 janela desconhecida (sem iniciado_em/encerrado_em) → execucoes_ia e execucoes_truncadas são NULL, nunca 0", () => {
    const c = montarConteudoRetrospecto(insumos({ execucoes: null }));
    expect(c.saude_do_motor.execucoes_ia).toBeNull();
    expect(c.saude_do_motor.execucoes_truncadas).toBeNull();
  });

  it("🔴 execução truncada CONTA mesmo sem nenhuma sugestão atrás dela (foi medido: 49 de 299 na sessão real, e 0 pelo lado das sugestões)", () => {
    // Zero sugestões — e ainda assim 2 de 3 execuções truncadas aparecem.
    const c = montarConteudoRetrospecto(
      insumos({
        sugestoes: [],
        execucoes: [
          { id: "e1", stop_reason: "max_tokens" },
          { id: "e2", stop_reason: "max_tokens" },
          { id: "e3", stop_reason: "end_turn" },
        ],
      }),
    );
    expect(c.saude_do_motor.sugestoes).toBe(0);
    expect(c.saude_do_motor.execucoes_ia).toBe(3);
    expect(c.saude_do_motor.execucoes_truncadas).toBe(2);
  });

  it("🔴 nenhuma sugestão com confiança → confianca_media é null, nunca 0", () => {
    const c = montarConteudoRetrospecto(
      insumos({ sugestoes: [{ bloco_id: "parte_01", conteudo: conteudoVazio(), confianca: null }] }),
    );
    expect(c.saude_do_motor.confianca_media).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TETO / PODA
// ---------------------------------------------------------------------------

describe("montarConteudoRetrospecto — teto de bytes (CHECK de 32 KB da 0125)", () => {
  it("🔴 sessão anômala (205 itens de falta_no_bloco, medido em 1 das 3 reais) cabe no CHECK e marca podado:true", () => {
    const sugestoes = Array.from({ length: 205 }, (_, i) => ({
      bloco_id: "parte_01",
      conteudo: conteudoVazio({
        falta_no_bloco: [{ item: `Item de condução número ${i} com um texto razoavelmente longo para inflar o documento`, evidencia: null }],
      }),
      confianca: 0.5,
    }));
    const c = montarConteudoRetrospecto(insumos({ sugestoes }));
    expect(c.podado).toBe(true);
    expect(c.pontos_de_melhoria.length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(JSON.stringify(c), "utf8")).toBeLessThan(TETO_BYTES_CHECK_0125);
  });

  it("🔴 a poda NUNCA zera uma seção inteira: corta da lista MAIS LONGA, a curta sobrevive (medido: alternar zerava os 14 pontos de melhoria da sessão real)", () => {
    // 200 observações longas (cada uma com citação) + 5 pontos de melhoria.
    // A poda tem de derrubar observação até caber e deixar os 5 pontos de pé.
    const ficha: FichaAcumulada = Array.from({ length: 200 }, (_, i) => ({
      categoria: "dor" as const,
      texto: `Observacao numero ${i} com um texto longo o suficiente para pesar bytes no documento inteiro`,
      evidencia: `citacao sintetica numero ${i} igualmente longa para inflar o tamanho do json gravado`,
      chave: `dor:${i}`,
      primeira_mencao_em: "2026-09-18T12:20:00Z",
      ultima_mencao_em: "2026-09-18T12:20:00Z",
      n: 1,
    }));
    const sugestoes = Array.from({ length: 5 }, (_, i) => ({
      bloco_id: "parte_01",
      conteudo: conteudoVazio({ falta_no_bloco: [{ item: `Ponto de melhoria ${i}`, evidencia: null }] }),
      confianca: 0.5,
    }));

    const c = montarConteudoRetrospecto(insumos({ ficha, sugestoes }));
    expect(c.podado).toBe(true);
    expect(c.pontos_de_melhoria).toHaveLength(5); // intactos
    expect(c.observacoes_do_cliente.length).toBeLessThan(200); // foi a lista longa que encolheu
    expect(Buffer.byteLength(JSON.stringify(c), "utf8")).toBeLessThan(TETO_BYTES_CHECK_0125);
  });

  it("documento normal não é podado — `podado:false` é o caminho comum", () => {
    const c = montarConteudoRetrospecto(insumos({ sugestoes: sugestoesComBlocos(["parte_00", "parte_01"]) }));
    expect(c.podado).toBe(false);
  });

  it("o rodapé explica POR QUE não há nota — a ausência é declarada, não esquecida", () => {
    const c = montarConteudoRetrospecto(insumos());
    expect(c.nota_de_rodape).toContain("não traz nota de 0 a 10");
    expect(JSON.stringify(c)).not.toContain('"nota"');
  });
});

// ---------------------------------------------------------------------------
// I/O — gravação
// ---------------------------------------------------------------------------

function builder(resultado: unknown) {
  const b: Record<string, unknown> = {};
  const enc = () => b;
  Object.assign(b, {
    select: enc,
    eq: enc,
    in: enc,
    gte: enc,
    lte: enc,
    order: enc,
    limit: enc,
    upsert: enc,
    update: enc,
    returns: async () => resultado,
    maybeSingle: async () => resultado,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return b;
}

const SESSAO_OK = {
  data: {
    id: "s1",
    jornada_id: "j1",
    roteiro_versao_id: "rv1",
    roteiros_versoes: { definicao: { blocos: ROTEIRO_13 } },
    sessoes_copiloto: {
      iniciado_em: "2026-09-18T12:06:45.936Z",
      encerrado_em: "2026-09-18T14:08:05.755Z",
      inventario_acumulado: [],
      ficha_acumulada: [],
    },
  },
  error: null,
};

/** Banco de mentira MÍNIMO para `eventos_timeline`, com a trava da 0126
 * (índice único parcial em `(dados->>'sessao_id') where tipo='retrospecto'`)
 * simulada em memória: o 2º INSERT da MESMA sessão devolve `23505`, que é
 * exatamente o que o Postgres faz. Sem isto o teste de idempotência provaria
 * só que o código chama o insert, não que o evento é único. */
function bancoDeTimeline() {
  const linhas: Array<Record<string, unknown>> = [];
  const insertSpy = vi.fn();
  const tabela = () => {
    const b: Record<string, unknown> = {};
    let filtroSessao: string | undefined;
    b.insert = async (linha: Record<string, unknown>) => {
      insertSpy(linha);
      const chave = (linha.dados as { sessao_id?: string } | undefined)?.sessao_id;
      const duplicada = linha.tipo === "retrospecto" && linhas.some(
        (l) => l.tipo === "retrospecto" && (l.dados as { sessao_id?: string }).sessao_id === chave,
      );
      if (duplicada) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      linhas.push(linha);
      return { data: null, error: null };
    };
    // F2: a releitura da linha conflitante — `.select().eq().eq().contains().maybeSingle()`.
    b.select = () => b;
    b.eq = () => b;
    b.contains = (_coluna: string, valor: { sessao_id?: string }) => {
      filtroSessao = valor.sessao_id;
      return b;
    };
    b.maybeSingle = async () => {
      const achada = linhas.find(
        (l) => l.tipo === "retrospecto" && (l.dados as { sessao_id?: string }).sessao_id === filtroSessao,
      );
      return {
        data: achada
          ? {
              id: "evt-1",
              titulo: achada.titulo ?? null,
              descricao: achada.descricao ?? null,
              ator_tipo: achada.ator_tipo ?? null,
              ator_perfil_id: achada.ator_perfil_id ?? null,
              ocorrido_em: "2026-09-19T20:00:00.000Z",
            }
          : null,
        error: null,
      };
    };
    return b;
  };
  /** Planta uma linha ANTES do sistema — o cenário de squat do F2. */
  const plantar = (linha: Record<string, unknown>) => linhas.push(linha);
  return { linhas, insertSpy, tabela, plantar };
}

function clientes(opts: { sessao?: unknown; sugestoes?: unknown; execucoes?: unknown; upsert?: unknown; timeline?: { tabela: () => unknown } } = {}) {
  const supabase = {
    from: (t: string) => {
      if (t === "sessoes_viabilidade") return builder(opts.sessao ?? SESSAO_OK);
      if (t === "copiloto_sugestoes") return builder(opts.sugestoes ?? { data: [], error: null });
      if (t === "roteiros_versoes") return builder({ data: { definicao: { blocos: ROTEIRO_13 } }, error: null });
      // `carregarExecucoesDaSessao` — 2 idas: as versões do prompt e as
      // execuções na janela da sessão (NUNCA derivadas das sugestões).
      if (t === "prompts_versoes") return builder({ data: [{ id: "pv1" }], error: null });
      if (t === "execucoes_ia") return builder(opts.execucoes ?? { data: [], error: null });
      throw new Error(`tabela não mockada em supabase: ${t}`);
    },
  } as unknown as SupabaseClient;

  const admin = {
    from: (t: string) => {
      if (t === "copiloto_retrospectos") {
        return builder(
          opts.upsert ?? {
            data: { sessao_id: "s1", jornada_id: "j1", conteudo: {}, blocos_com_atividade: 9, blocos_no_roteiro: 13 },
            error: null,
          },
        );
      }
      if (t === "eventos_timeline") return (opts.timeline ?? bancoDeTimeline()).tabela();
      throw new Error(`tabela não mockada em admin: ${t}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, admin };
}

afterEach(() => {
  lerConfiguracaoBoolMock.mockReset();
});

describe("gravarRetrospectoDaSessao — kill-switch e isolamento (BE-3)", () => {
  it("🔴 FAIL-CLOSED: kill-switch desligado → devolve null e NÃO escreve nada", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(false);
    const escrita = vi.fn();
    const admin = {
      from: () => {
        escrita();
        return builder({ data: null, error: null });
      },
    } as unknown as SupabaseClient;
    const { supabase } = clientes();

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("🔴 lê a chave com padrão FALSE — chave ausente NUNCA liga a feature", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(false);
    const { supabase, admin } = clientes();
    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(lerConfiguracaoBoolMock).toHaveBeenCalledWith(supabase, "copiloto_sessao.retrospecto_ativo", false);
  });

  it("🔴 NUNCA LANÇA: erro de banco no meio da montagem vira null (o encerramento não pode cair por causa do retrospecto)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const { admin } = clientes();
    const supabase = {
      from: () => {
        throw new Error("banco fora do ar");
      },
    } as unknown as SupabaseClient;

    await expect(
      gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null }),
    ).resolves.toBeNull();
  });

  it("sessão inexistente → null, sem tentar gravar", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const escrita = vi.fn();
    const { supabase } = clientes({ sessao: { data: null, error: null } });
    const admin = {
      from: () => {
        escrita();
        return builder({ data: null, error: null });
      },
    } as unknown as SupabaseClient;

    expect(await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null })).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("grava com origem='derivado', schema_versao=1 e a cobertura nas COLUNAS (não só no jsonb)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const upsertSpy = vi.fn();
    const { supabase } = clientes({
      sugestoes: { data: sugestoesComBlocos(["parte_00", "parte_01", "parte_03", "parte_09"]), error: null },
    });
    const timeline = bancoDeTimeline();
    const admin = {
      from: (t: string) => {
        if (t === "eventos_timeline") return timeline.tabela();
        const b = builder({ data: { sessao_id: "s1", blocos_com_atividade: 4, blocos_no_roteiro: 13 }, error: null });
        b.upsert = (payload: unknown) => {
          upsertSpy(payload);
          return b;
        };
        return b;
      },
    } as unknown as SupabaseClient;

    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: "perfil-1" });
    const payload = upsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origem).toBe("derivado");
    expect(payload.schema_versao).toBe(1);
    expect(payload.blocos_com_atividade).toBe(4);
    expect(payload.blocos_no_roteiro).toBe(13);
    expect(payload.criado_por).toBe("perfil-1");
    // Zero chamada de IA: `execucao_ia_id` nem aparece no payload.
    expect(payload.execucao_ia_id).toBeUndefined();
  });

  it("🔴 corrida (on conflict do nothing devolve 0 linha) → RELÊ a linha existente, nunca devolve null nem 2 linhas", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const { supabase } = clientes();
    // `conteudo` com `versao` de propósito: desde a D-1, `lerRetrospectoDaSessao`
    // recusa corpo sem `versao` (lápide de anonimização). Um fixture com `{}`
    // fazia este teste exercitar o caminho errado.
    const existente = {
      sessao_id: "s1", jornada_id: "j1", origem: "derivado",
      conteudo: { versao: 1 }, blocos_com_atividade: 9, blocos_no_roteiro: 13,
    };
    const timeline = bancoDeTimeline();
    let chamada = 0;
    const admin = {
      from: (t: string) => {
        if (t === "eventos_timeline") return timeline.tabela();
        chamada += 1;
        // 1ª: o upsert com ignoreDuplicates → 0 linha. 2ª: a releitura.
        return builder(chamada === 1 ? { data: null, error: null } : { data: existente, error: null });
      },
    } as unknown as SupabaseClient;

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).toEqual(existente);
  });
});

describe("lerRetrospectoDaSessao", () => {
  it("sem linha → null (o chamador devolve 404 com código, nunca 200 com corpo vazio)", async () => {
    const supabase = { from: () => builder({ data: null, error: null }) } as unknown as SupabaseClient;
    expect(await lerRetrospectoDaSessao(supabase, "s1")).toBeNull();
  });

  it("erro de banco PROPAGA (a rota traduz em 500) — nunca devolve null fingindo 'não existe'", async () => {
    const supabase = { from: () => builder({ data: null, error: { message: "boom" } }) } as unknown as SupabaseClient;
    await expect(lerRetrospectoDaSessao(supabase, "s1")).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

describe("montarDocxRetrospecto", () => {
  const base = {
    sessao_id: "s1",
    jornada_id: "j1",
    origem: "derivado" as const,
    schema_versao: 1,
    blocos_com_atividade: 9,
    blocos_no_roteiro: 13,
    evidencias_redigidas_em: null,
    criado_em: "2026-09-19T20:00:00.000Z",
  };

  it("produz um .docx de verdade (assinatura ZIP 'PK') sem lançar", async () => {
    const conteudo = montarConteudoRetrospecto(insumos({ sugestoes: sugestoesComBlocos(["parte_00"]) }));
    const bytes = await montarDocxRetrospecto({ ...base, conteudo });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("documento de sessão vazia não inventa zeros — diz por escrito que não houve item", async () => {
    const conteudo = montarConteudoRetrospecto(insumos());
    const bytes = await montarDocxRetrospecto({ ...base, conteudo });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// 🔴 EVENTO DE TIMELINE — achado do `frontend-engineer` (19/09/2026).
//
// `src/lib/pasta/derivar.ts:66` lê `ficha.timeline.some(e => e.tipo ===
// "retrospecto")` para decidir se o item `retrospecto_sv` aparece como
// `pronto` na Pasta. Sem o evento, o documento existe e a feature é
// INVISÍVEL. O contrato é do FRONTEND: estes testes travam o `tipo` exato e
// a unicidade, sem que nenhum arquivo de `lib/pasta/` precise mudar.
// ---------------------------------------------------------------------------

describe("gravarRetrospectoDaSessao — evento de timeline (integração com a Pasta)", () => {
  it("🔴 grava evento com tipo EXATAMENTE 'retrospecto' — é a string que derivar.ts:66 procura", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();
    const { supabase, admin } = clientes({ timeline });

    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: "perfil-1" });

    expect(timeline.linhas).toHaveLength(1);
    expect(timeline.linhas[0].tipo).toBe("retrospecto");
    expect(timeline.linhas[0].jornada_id).toBe("j1");
    // `dados.sessao_id` é a chave do índice único da 0126.
    expect((timeline.linhas[0].dados as { sessao_id: string }).sessao_id).toBe("s1");
  });

  it("🔴 IDEMPOTENTE: gravar 2x para a MESMA sessão deixa 1 evento só (a 2a tentativa bate no 23505 da 0126 e é tratada como sucesso)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();

    // Duas execuções completas do encerramento sobre a mesma sessão — o
    // cenário real: retry de sessão em 'erro', ou corrida entre o clique e o
    // ciclo automático de `duracao_maxima_minutos`.
    const primeira = clientes({ timeline });
    const r1 = await gravarRetrospectoDaSessao(primeira.supabase, primeira.admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      criadoPor: "perfil-1",
    });
    const segunda = clientes({ timeline });
    const r2 = await gravarRetrospectoDaSessao(segunda.supabase, segunda.admin, {
      sessaoId: "s1",
      jornadaId: "j1",
      criadoPor: "perfil-1",
    });

    // O INSERT foi TENTADO duas vezes (o código não adivinha nada)...
    expect(timeline.insertSpy).toHaveBeenCalledTimes(2);
    // ...e mesmo assim existe UMA linha: quem garante é o banco, não o código.
    expect(timeline.linhas).toHaveLength(1);
    // E o 23505 NÃO virou falha: as duas chamadas devolveram o documento.
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });

  it("🔴 23505 (evento já existe) NÃO é registrado como erro — alerta que acende quando está tudo certo é alerta que se aprende a ignorar", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeline = bancoDeTimeline();

    const a = clientes({ timeline });
    await gravarRetrospectoDaSessao(a.supabase, a.admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    erroSpy.mockClear();
    const b = clientes({ timeline });
    await gravarRetrospectoDaSessao(b.supabase, b.admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });

    expect(erroSpy).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });

  it("ator_tipo é honesto: humano quando a advogada clicou, sistema quando foi o ciclo automático", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);

    const comHumano = bancoDeTimeline();
    const a = clientes({ timeline: comHumano });
    await gravarRetrospectoDaSessao(a.supabase, a.admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: "perfil-1" });
    expect(comHumano.linhas[0].ator_tipo).toBe("humano");
    expect(comHumano.linhas[0].ator_perfil_id).toBe("perfil-1");

    const semHumano = bancoDeTimeline();
    const b = clientes({ timeline: semHumano });
    await gravarRetrospectoDaSessao(b.supabase, b.admin, { sessaoId: "s2", jornadaId: "j1", criadoPor: null });
    expect(semHumano.linhas[0].ator_tipo).toBe("sistema");
    expect(semHumano.linhas[0].ator_perfil_id).toBeNull();
  });

  it("🔴 NENHUMA PII no evento: a timeline é lida por eh_interno(), recorte MAIS LARGO que o ve_patrimonio() do retrospecto", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();
    const { supabase, admin } = clientes({
      timeline,
      // A sessão traz Ficha com citação literal; ela vai para o `conteudo` do
      // documento (protegido por `ve_patrimonio`), NUNCA para o evento.
      sessao: {
        data: {
          id: "s1",
          jornada_id: "j1",
          roteiro_versao_id: "rv1",
          roteiros_versoes: { definicao: { blocos: ROTEIRO_13 } },
          sessoes_copiloto: {
            iniciado_em: "2026-09-18T12:06:45.936Z",
            encerrado_em: "2026-09-18T14:08:05.755Z",
            inventario_acumulado: [],
            ficha_acumulada: [
              {
                categoria: "dor",
                texto: "Teme perder controle",
                evidencia: "CITACAO-LITERAL-DO-CLIENTE",
                chave: "dor:x",
                primeira_mencao_em: "2026-09-18T12:20:00Z",
                ultima_mencao_em: "2026-09-18T12:20:00Z",
                n: 1,
              },
            ],
          },
        },
        error: null,
      },
    });

    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });

    const serializado = JSON.stringify(timeline.linhas[0]);
    expect(serializado).not.toContain("CITACAO-LITERAL-DO-CLIENTE");
    expect(serializado).not.toContain("Teme perder controle");
    // 🔴 F5: a `descricao` NÃO carrega métrica de condução. O Histórico é
    // lido por `eh_interno()` (inclui `relacionamento`); "4 de 13 partes" ali
    // seria julgamento da advogada legível por quem nem abre o documento.
    expect(timeline.linhas[0].descricao).toBeNull();
    // A fração continua existindo — em `dados`, que o Histórico não renderiza.
    expect(timeline.linhas[0].dados).toMatchObject({ blocos_com_atividade: 9, blocos_no_roteiro: 13 });
  });

  it("🔴 falha do evento NÃO derruba o retrospecto: o documento volta assim mesmo (timeline é registro secundário)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timelineQuebrada = {
      tabela: () => ({ insert: async () => ({ data: null, error: { code: "08006", message: "conexao perdida" } }) }),
    };
    const { supabase, admin } = clientes({ timeline: timelineQuebrada });

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).not.toBeNull(); // o documento existe e é devolvido
  });

  it("🔴 42P01 (0126 não aplicada) degrada em silêncio — não é falha, e não bloqueia o encerramento", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const semTabela = {
      tabela: () => ({ insert: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) }),
    };
    const { supabase, admin } = clientes({ timeline: semTabela });

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).not.toBeNull();
    expect(erroSpy).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });

  it("kill-switch desligado → nem documento nem evento (um if governa os dois)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(false);
    const timeline = bancoDeTimeline();
    const { supabase, admin } = clientes({ timeline });

    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(timeline.insertSpy).not.toHaveBeenCalled();
  });

  it("🔴 documento AUSENTE (corrida perdida e releitura vazia) → NENHUM evento: a Pasta nunca diz pronto sobre papel que não existe", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();
    const { supabase } = clientes({ timeline });
    // upsert devolve 0 linha E a releitura também — o documento não existe.
    const admin = {
      from: (t: string) => {
        if (t === "copiloto_retrospectos") return builder({ data: null, error: null });
        if (t === "eventos_timeline") return timeline.tabela();
        throw new Error(`tabela nao mockada: ${t}`);
      },
    } as unknown as SupabaseClient;

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).toBeNull();
    expect(timeline.insertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 🔴 F2 (pentest Fase 13) — o `23505` pode NÃO ser a nossa idempotência.
//
// `eventos_timeline` aceita INSERT de qualquer papel interno (`tl_ins`,
// 0014:25 — `app.eh_interno()`, que inclui `relacionamento`) e `tipo` é
// `text` livre. Alguém de dentro pode PLANTAR a linha antes do encerramento;
// sem estes testes, a rotina trataria como "já existe" em silêncio e o
// Histórico do cliente exibiria texto de outra pessoa como se fosse do
// sistema — numa tabela append-only que a aplicação não corrige.
// ---------------------------------------------------------------------------

describe("registrarRetrospectoNaTimeline — 23505 não é sucesso automático (F2)", () => {
  it("🔴 SQUAT: linha plantada por outra pessoa → NÃO passa em silêncio, vira erro com código próprio", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeline = bancoDeTimeline();

    // Alguém interno planta o evento ANTES do encerramento, com texto próprio.
    timeline.plantar({
      tipo: "retrospecto",
      jornada_id: "j1",
      titulo: "Cliente desistiu, não insistir",
      descricao: "anotação plantada por terceiro",
      dados: { sessao_id: "s1" },
      ator_perfil_id: "perfil-invasor",
      ator_tipo: "humano",
    });

    const { supabase, admin } = clientes({ timeline });
    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: "perfil-1" });

    // O documento continua sendo gravado e devolvido — o squat é do EVENTO.
    expect(r).not.toBeNull();
    // E o squat NÃO passou mudo.
    expect(erroSpy).toHaveBeenCalledTimes(1);
    const registrado = JSON.stringify(erroSpy.mock.calls[0]);
    expect(registrado).toContain("evento_squatado");
    // 🔴 O texto plantado NUNCA entra no log: origem não confiável não vira
    // fato que alguém lê depois. Só ids.
    expect(registrado).not.toContain("Cliente desistiu");
    expect(registrado).not.toContain("plantada por terceiro");
    expect(registrado).toContain("perfil-invasor");
    erroSpy.mockRestore();
  });

  it("🔴 a linha do SISTEMA (título exato, descricao null) continua sendo sucesso mudo — a idempotência não virou alarme", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeline = bancoDeTimeline();

    const a = clientes({ timeline });
    await gravarRetrospectoDaSessao(a.supabase, a.admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    erroSpy.mockClear();
    const b = clientes({ timeline });
    await gravarRetrospectoDaSessao(b.supabase, b.admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });

    expect(timeline.linhas).toHaveLength(1);
    expect(erroSpy).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });

  it("🔴 título parecido MAS diferente conta como squat — o reconhecedor é estreito de propósito", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeline = bancoDeTimeline();
    timeline.plantar({
      tipo: "retrospecto",
      jornada_id: "j1",
      titulo: "Retrospecto da Sessao gerado", // sem o acento
      descricao: null,
      dados: { sessao_id: "s1" },
      ator_perfil_id: null,
      ator_tipo: "sistema",
    });

    const { supabase, admin } = clientes({ timeline });
    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });

    // Errar para o lado do ALARME: falso positivo custa investigação, falso
    // negativo deixa texto de terceiro passando por registro do sistema.
    expect(JSON.stringify(erroSpy.mock.calls)).toContain("evento_squatado");
    erroSpy.mockRestore();
  });

  it("linha do sistema com `descricao` preenchida também é squat (F5 tirou a descrição de vez)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeline = bancoDeTimeline();
    timeline.plantar({
      tipo: "retrospecto",
      jornada_id: "j1",
      titulo: "Retrospecto da Sessão gerado",
      descricao: "Cobertura do roteiro: 4 de 13 partes.",
      dados: { sessao_id: "s1" },
      ator_perfil_id: null,
      ator_tipo: "sistema",
    });

    const { supabase, admin } = clientes({ timeline });
    await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(JSON.stringify(erroSpy.mock.calls)).toContain("evento_squatado");
    erroSpy.mockRestore();
  });

  it("releitura FALHA (banco oscilou) → nem acusa squat nem dá sucesso mudo: registra `conflito_nao_lido`", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timelineCega = {
      tabela: () => ({
        insert: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
        select: function () { return this; },
        eq: function () { return this; },
        contains: function () { return this; },
        maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
      }),
    };
    const { supabase, admin } = clientes({ timeline: timelineCega });

    const r = await gravarRetrospectoDaSessao(supabase, admin, { sessaoId: "s1", jornadaId: "j1", criadoPor: null });
    expect(r).not.toBeNull(); // o documento não é derrubado por isto
    const registrado = JSON.stringify(erroSpy.mock.calls);
    expect(registrado).toContain("conflito_nao_lido");
    expect(registrado).not.toContain("evento_squatado"); // nunca acusa sem ter lido
    erroSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 🔴 D-1 — LÁPIDE. A 0127 zera `conteudo` para `{}` ao anonimizar o titular.
// A linha fica; o documento não. Quem lê fazia `conteudo.cobertura.x` sobre
// `{}` = TypeError — a correção de LGPD plantava um crash na tela do primeiro
// titular anonimizado. Fechado no SERVIDOR: linha anonimizada não é
// retrospecto, é lápide, e nunca chega ao front como corpo.
// ---------------------------------------------------------------------------

describe("lerRetrospectoComEstado — D-1: lápide x ausente x ok", () => {
  function clienteComLinha(conteudo: unknown) {
    return {
      from: () => builder({ data: { sessao_id: "s1", jornada_id: "j1", conteudo }, error: null }),
    } as unknown as SupabaseClient;
  }

  it("linha com corpo válido → estado 'ok'", async () => {
    const r = await lerRetrospectoComEstado(clienteComLinha({ versao: 1, cobertura: { blocos_com_atividade: 9 } }), "s1");
    expect(r.estado).toBe("ok");
  });

  it("🔴 conteudo `{}` (anonimizado pela 0127) → estado 'lapide', NUNCA 'ok'", async () => {
    const r = await lerRetrospectoComEstado(clienteComLinha({}), "s1");
    expect(r.estado).toBe("lapide");
  });

  it("🔴 conteudo null → 'lapide' (nunca deixa `null.cobertura` chegar na tela)", async () => {
    const r = await lerRetrospectoComEstado(clienteComLinha(null), "s1");
    expect(r.estado).toBe("lapide");
  });

  it("conteudo com outras chaves mas SEM `versao` → 'lapide' (o discriminante é `versao`)", async () => {
    const r = await lerRetrospectoComEstado(clienteComLinha({ observacoes_do_cliente: [] }), "s1");
    expect(r.estado).toBe("lapide");
  });

  it("sem linha → 'ausente' (é o ÚNICO estado que autoriza remontar)", async () => {
    const supabase = { from: () => builder({ data: null, error: null }) } as unknown as SupabaseClient;
    expect((await lerRetrospectoComEstado(supabase, "s1")).estado).toBe("ausente");
  });

  it("documento REAL montado pelo módulo passa no discriminante (o teste que impede a guarda de ficar estrita demais)", async () => {
    const conteudo = montarConteudoRetrospecto(insumos({ sugestoes: sugestoesComBlocos(["parte_00"]) }));
    expect((await lerRetrospectoComEstado(clienteComLinha(conteudo), "s1")).estado).toBe("ok");
  });

  it("`lerRetrospectoDaSessao` (atalho) devolve null para lápide E para ausente", async () => {
    expect(await lerRetrospectoDaSessao(clienteComLinha({}), "s1")).toBeNull();
    const vazio = { from: () => builder({ data: null, error: null }) } as unknown as SupabaseClient;
    expect(await lerRetrospectoDaSessao(vazio, "s1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 D-2 — REMONTAR SOB DEMANDA. Sem isto, uma falha na gravação do
// encerramento deixava a sessão em 404 PARA SEMPRE: `marcarEncerrada` não
// deixa o encerramento rodar de novo, e a advogada perdia o documento sem
// saber por quê.
// ---------------------------------------------------------------------------

describe("remontarRetrospectoSeEncerrada — D-2", () => {
  function clienteSessao(estado: string | null, achou = true) {
    return {
      from: (t: string) => {
        if (t === "sessoes_viabilidade") {
          return builder({
            data: achou ? { id: "s1", jornada_id: "j1", sessoes_copiloto: estado ? { estado } : null } : null,
            error: null,
          });
        }
        if (t === "copiloto_sugestoes") return builder({ data: [], error: null });
        if (t === "roteiros_versoes") return builder({ data: { definicao: { blocos: ROTEIRO_13 } }, error: null });
        if (t === "prompts_versoes") return builder({ data: [{ id: "pv1" }], error: null });
        if (t === "execucoes_ia") return builder({ data: [], error: null });
        if (t === "configuracoes") return builder({ data: { valor: true }, error: null });
        throw new Error(`tabela não mockada: ${t}`);
      },
    } as unknown as SupabaseClient;
  }

  it("🔴 sessão ENCERRADA e sem linha → monta e grava", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();
    const admin = {
      from: (t: string) => {
        if (t === "eventos_timeline") return timeline.tabela();
        return builder({ data: { sessao_id: "s1", blocos_com_atividade: 0, blocos_no_roteiro: 13 }, error: null });
      },
    } as unknown as SupabaseClient;

    const r = await remontarRetrospectoSeEncerrada(clienteSessao("encerrado"), admin, "s1");
    expect(r).not.toBeNull();
  });

  it("🔴 sessão ATIVA → NÃO remonta (congelaria um documento parcial, e a PK impediria o certo de entrar depois)", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const escrita = vi.fn();
    const admin = { from: () => { escrita(); return builder({ data: null, error: null }); } } as unknown as SupabaseClient;

    expect(await remontarRetrospectoSeEncerrada(clienteSessao("ativo"), admin, "s1")).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("sessão sem `sessoes_copiloto` (copiloto nunca usado) → não remonta", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const escrita = vi.fn();
    const admin = { from: () => { escrita(); return builder({ data: null, error: null }); } } as unknown as SupabaseClient;

    expect(await remontarRetrospectoSeEncerrada(clienteSessao(null), admin, "s1")).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("🔴 RLS negou a sessão (leitura volta vazia) → não remonta e não escreve", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const escrita = vi.fn();
    const admin = { from: () => { escrita(); return builder({ data: null, error: null }); } } as unknown as SupabaseClient;

    expect(await remontarRetrospectoSeEncerrada(clienteSessao("encerrado", false), admin, "s1")).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("🔴 kill-switch desligado → não grava nada, mesmo com a sessão encerrada", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(false);
    const escrita = vi.fn();
    const admin = { from: () => { escrita(); return builder({ data: null, error: null }); } } as unknown as SupabaseClient;

    expect(await remontarRetrospectoSeEncerrada(clienteSessao("encerrado"), admin, "s1")).toBeNull();
    expect(escrita).not.toHaveBeenCalled();
  });

  it("🔴 a autoria é do SISTEMA (`criadoPor: null`) — quem abriu a tela não conduziu a sessão", async () => {
    lerConfiguracaoBoolMock.mockResolvedValue(true);
    const timeline = bancoDeTimeline();
    const upsertSpy = vi.fn();
    const admin = {
      from: (t: string) => {
        if (t === "eventos_timeline") return timeline.tabela();
        const b = builder({ data: { sessao_id: "s1", blocos_com_atividade: 0, blocos_no_roteiro: 13 }, error: null });
        b.upsert = (payload: unknown) => { upsertSpy(payload); return b; };
        return b;
      },
    } as unknown as SupabaseClient;

    await remontarRetrospectoSeEncerrada(clienteSessao("encerrado"), admin, "s1");
    expect((upsertSpy.mock.calls[0][0] as Record<string, unknown>).criado_por).toBeNull();
    expect(timeline.linhas[0]?.ator_tipo).toBe("sistema");
  });
});
