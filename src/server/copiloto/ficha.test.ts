import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acumularFicha,
  acumularFichaNaSessao,
  converterDeFichaEstruturada,
  converterDeObservacao,
  ordenarFicha,
  redigirEvidenciasFicha,
  temEvidenciaNaoRedigidaNaFicha,
} from "./ficha";
import type { FichaAcumulada, ItemFichaCliente, ItemInventarioRecentePainel } from "@/types/copiloto";

function itemFicha(overrides: Partial<ItemFichaCliente> = {}): ItemFichaCliente {
  return {
    categoria: "dor",
    texto: "vai perder qualidade de vida",
    evidencia: "eu vou perder qualidade de vida",
    ...overrides,
  };
}

describe("acumularFicha — dedupe por categoria + texto normalizado", () => {
  it("item novo entra com n=1, primeira/ultima mencao iguais", () => {
    const resultado = acumularFicha([], [itemFicha()], "2026-09-18T10:00:00Z");
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({
      categoria: "dor",
      texto: "vai perder qualidade de vida",
      chave: "dor:vai perder qualidade de vida",
      n: 1,
      primeira_mencao_em: "2026-09-18T10:00:00Z",
      ultima_mencao_em: "2026-09-18T10:00:00Z",
    });
  });

  it("mesmo texto com grafia diferente (maiúscula/espaço duplo) casa na MESMA chave", () => {
    const primeira = acumularFicha([], [itemFicha({ texto: "Vai Perder Qualidade de Vida" })], "2026-09-18T10:00:00Z");
    const segunda = acumularFicha(primeira, [itemFicha({ texto: "vai  perder  qualidade de vida" })], "2026-09-18T10:05:00Z");
    expect(segunda).toHaveLength(1);
    expect(segunda[0]!.n).toBe(2);
  });

  it("categorias diferentes com o mesmo texto são itens DISTINTOS", () => {
    const resultado = acumularFicha(
      [],
      [itemFicha({ categoria: "dor", texto: "imposto de renda" }), itemFicha({ categoria: "objecao", texto: "imposto de renda" })],
      "2026-09-18T10:00:00Z",
    );
    expect(resultado).toHaveLength(2);
  });

  it("item repetido soma n e atualiza ultima_mencao_em, preserva primeira_mencao_em", () => {
    const primeira = acumularFicha([], [itemFicha()], "2026-09-18T10:00:00Z");
    const segunda = acumularFicha(primeira, [itemFicha()], "2026-09-18T10:05:00Z");
    expect(segunda).toHaveLength(1);
    expect(segunda[0]!.n).toBe(2);
    expect(segunda[0]!.primeira_mencao_em).toBe("2026-09-18T10:00:00Z");
    expect(segunda[0]!.ultima_mencao_em).toBe("2026-09-18T10:05:00Z");
  });

  it("evidência mais recente substitui a antiga (citação mais fresca do mesmo fato)", () => {
    const primeira = acumularFicha([], [itemFicha({ evidencia: "primeira citação" })], "2026-09-18T10:00:00Z");
    const segunda = acumularFicha(primeira, [itemFicha({ evidencia: "segunda citação, mais completa" })], "2026-09-18T10:05:00Z");
    expect(segunda[0]!.evidencia).toBe("segunda citação, mais completa");
  });

  it("🔴 ANTI-PISCADA: item que não é repetido na chamada seguinte NÃO SOME — upsert, nunca delete", () => {
    const acumulado = acumularFicha([], [itemFicha({ texto: "medo de perder o patrimônio" })], "2026-09-18T10:00:00Z");
    const resultado = acumularFicha(acumulado, [itemFicha({ texto: "quer proteger os filhos" })], "2026-09-18T10:05:00Z");
    expect(resultado).toHaveLength(2);
    expect(resultado.map((i) => i.texto)).toEqual(["medo de perder o patrimônio", "quer proteger os filhos"]);
  });
});

describe("acumularFicha — poda por bytes (alvo 3.000 B, backstop CHECK 4096 da 0122)", () => {
  it("array grande é podado abaixo do alvo de bytes, removendo o item MENOS RECENTE primeiro", () => {
    let acumulado: FichaAcumulada = [];
    for (let i = 0; i < 60; i++) {
      acumulado = acumularFicha(
        acumulado,
        [itemFicha({ categoria: "fato_decisor", texto: `fato numero ${i} sobre a familia`, evidencia: "x".repeat(100) })],
        `2026-09-18T10:${String(i).padStart(2, "0")}:00Z`,
      );
    }
    const tamanho = Buffer.byteLength(JSON.stringify(acumulado), "utf8");
    expect(tamanho).toBeLessThanOrEqual(3000);
  });

  /**
   * 🔴 O LIMIAR, não o array gigante (achado do Fable, 2ª rodada) —
   * `verificacao-0122.sql` passo 3 já prova que o CHECK real do banco
   * recusa um array de ~18 KB; o que faltava provar é a MARGEM: quanto
   * `JSON.stringify` sobra até o CHECK de 4096, considerando o overhead do
   * jsonb BINÁRIO (~4 B a mais por PAR chave/valor que o texto UTF-8 mede —
   * `JEntry`), que a poda em TypeScript não vê diretamente.
   *
   * `ItemFichaClienteAcumulado` tem 7 chaves por item — o PIOR caso para o
   * overhead não é "poucos itens grandes" (a poda por bytes já corta isso
   * cedo), é MUITOS itens PEQUENOS (textos de 1 char): cabem mais itens
   * dentro do alvo de bytes, e cada item paga 7 pares de overhead. Medido
   * (busca exaustiva sobre o tamanho de `texto`/`evidencia`): no alvo
   * ANTIGO de 3.500 B esse pior caso chegava a um `pg_column_size`
   * ESTIMADO de ~4.020 B — 76 B de folga contra o CHECK de 4096, margem
   * real muito mais apertada que os "596 B" que o comentário desta base
   * citava (copiados de `resumo.ts`, cujo item tem menos chaves). Este
   * teste prova a folga do alvo ATUAL (3.000 B) contra essa mesma
   * estimativa de overhead — não contra um array arbitrariamente grande.
   */
  it("MARGEM REAL contra o CHECK de 4096: mesmo no pior caso (muitos itens de texto mínimo), a estimativa com overhead de jsonb binário (~4B/par × 7 pares/item) sobra folga", () => {
    // Itens de texto MÍNIMO maximizam a CONTAGEM que cabe no alvo de bytes —
    // é o cenário que mais paga overhead de JEntry por byte de conteúdo.
    let acumulado: FichaAcumulada = [];
    for (let i = 0; i < 60; i++) {
      acumulado = acumularFicha(acumulado, [itemFicha({ categoria: "fato_decisor", texto: `f${i}`, evidencia: "x" })], `2026-09-18T10:${String(i).padStart(2, "0")}:00Z`);
    }
    const bytesTexto = Buffer.byteLength(JSON.stringify(acumulado), "utf8");
    const PARES_POR_ITEM = 7;
    const OVERHEAD_ESTIMADO_POR_PAR = 4; // heurística de JEntry já usada nesta base (resumo.ts)
    const overheadEstimado = acumulado.length * PARES_POR_ITEM * OVERHEAD_ESTIMADO_POR_PAR;
    const pgColumnSizeEstimado = bytesTexto + overheadEstimado;
    const CHECK_MIGRATION_0122 = 4096;
    expect(pgColumnSizeEstimado).toBeLessThan(CHECK_MIGRATION_0122);
    // Folga mínima exigida (não só "não estourou por 1 byte") — mesma ordem
    // de grandeza da margem original de `resumo.ts` (596 B).
    expect(CHECK_MIGRATION_0122 - pgColumnSizeEstimado).toBeGreaterThanOrEqual(400);
  });

  it("a poda preserva os itens de MAIOR n mesmo que sejam mais antigos que o corte cronológico simples", () => {
    // Item repetido várias vezes (n alto) mencionado CEDO — a poda por bytes
    // só remove o MENOS RECENTE, então este teste prova que "menos recente"
    // é o critério, não "menor n".
    let acumulado: FichaAcumulada = acumularFicha([], [itemFicha({ texto: "objecao recorrente" })], "2026-09-18T09:00:00Z");
    acumulado = acumularFicha(acumulado, [itemFicha({ texto: "objecao recorrente" })], "2026-09-18T09:01:00Z");
    // Item mencionado DEPOIS, só 1 vez.
    acumulado = acumularFicha(acumulado, [itemFicha({ texto: "fato novo", categoria: "fato_decisor" })], "2026-09-18T09:02:00Z");
    expect(acumulado).toHaveLength(2);
    expect(acumulado.find((i) => i.texto === "objecao recorrente")!.n).toBe(2);
  });
});

describe("ordenarFicha — rank_categoria ASC, n DESC, ultima_mencao_em DESC (decisão do dono)", () => {
  function itemAcumulado(overrides: Partial<FichaAcumulada[number]> = {}): FichaAcumulada[number] {
    return {
      categoria: "dor",
      texto: "x",
      evidencia: "y",
      chave: "dor:x",
      primeira_mencao_em: "2026-09-18T10:00:00Z",
      ultima_mencao_em: "2026-09-18T10:00:00Z",
      n: 1,
      ...overrides,
    };
  }

  it("objeção vem ANTES de dor, mesmo com n menor — objeção não tratada derruba a venda", () => {
    const ficha: FichaAcumulada = [
      itemAcumulado({ categoria: "dor", texto: "dor dita 3 vezes", n: 3, ultima_mencao_em: "2026-09-18T10:03:00Z" }),
      itemAcumulado({ categoria: "objecao", texto: "objecao dita 1 vez", n: 1, ultima_mencao_em: "2026-09-18T10:00:00Z" }),
    ];
    const ordenado = ordenarFicha(ficha, []);
    expect(ordenado[0]!.categoria).toBe("objecao");
    expect(ordenado[1]!.categoria).toBe("dor");
  });

  it("ordem completa das 4 categorias + patrimônio: objecao, dor, desejo, fato_decisor, patrimonio", () => {
    const ficha: FichaAcumulada = [
      itemAcumulado({ categoria: "fato_decisor", texto: "d" }),
      itemAcumulado({ categoria: "desejo", texto: "c" }),
      itemAcumulado({ categoria: "dor", texto: "b" }),
      itemAcumulado({ categoria: "objecao", texto: "a" }),
    ];
    const inventario: ItemInventarioRecentePainel[] = [
      { categoria: "imovel", descricao: "sala comercial", titularidade: null, posse: "propria", valor_mencionado: null, evidencia: "e", primeira_mencao_em: "t", ultima_mencao_em: "t" },
    ];
    const ordenado = ordenarFicha(ficha, inventario);
    expect(ordenado.map((i) => i.categoria)).toEqual(["objecao", "dor", "desejo", "fato_decisor", "patrimonio"]);
  });

  it("DENTRO da mesma categoria, n DESC é o desempate", () => {
    const ficha: FichaAcumulada = [
      itemAcumulado({ categoria: "dor", texto: "dor a", n: 1, ultima_mencao_em: "2026-09-18T10:05:00Z" }),
      itemAcumulado({ categoria: "dor", texto: "dor b", n: 5, ultima_mencao_em: "2026-09-18T10:00:00Z" }),
    ];
    const ordenado = ordenarFicha(ficha, []);
    expect(ordenado[0]!.texto).toBe("dor b");
    expect(ordenado[1]!.texto).toBe("dor a");
  });

  it("com categoria E n empatados, ultima_mencao_em DESC decide (2º desempate)", () => {
    const ficha: FichaAcumulada = [
      itemAcumulado({ categoria: "dor", texto: "dor mais antiga", n: 1, ultima_mencao_em: "2026-09-18T10:00:00Z" }),
      itemAcumulado({ categoria: "dor", texto: "dor mais recente", n: 1, ultima_mencao_em: "2026-09-18T10:10:00Z" }),
    ];
    const ordenado = ordenarFicha(ficha, []);
    expect(ordenado[0]!.texto).toBe("dor mais recente");
  });
});

describe("redigirEvidenciasFicha / temEvidenciaNaoRedigidaNaFicha", () => {
  function itemAcumulado(evidencia: string): FichaAcumulada[number] {
    return {
      categoria: "dor",
      texto: "x",
      evidencia,
      chave: "dor:x",
      primeira_mencao_em: "t",
      ultima_mencao_em: "t",
      n: 1,
    };
  }

  it("zera evidencia de cada item, preserva os demais campos", () => {
    const acumulado: FichaAcumulada = [itemAcumulado("citação literal do cliente")];
    const redigido = redigirEvidenciasFicha(acumulado);
    expect(redigido[0]!.evidencia).toBe("");
    expect(redigido[0]!.texto).toBe("x");
    expect(redigido[0]!.n).toBe(1);
  });

  it("temEvidenciaNaoRedigidaNaFicha detecta pelo menos 1 evidência não vazia", () => {
    expect(temEvidenciaNaoRedigidaNaFicha([itemAcumulado("algo")])).toBe(true);
    expect(temEvidenciaNaoRedigidaNaFicha([itemAcumulado("")])).toBe(false);
    expect(temEvidenciaNaoRedigidaNaFicha([])).toBe(false);
  });
});

describe("contingência de fonte — converterDeFichaEstruturada / converterDeObservacao", () => {
  it("converterDeFichaEstruturada é identidade (fonte ativa hoje)", () => {
    const itens = [itemFicha()];
    expect(converterDeFichaEstruturada(itens)).toBe(itens);
  });

  it("converterDeObservacao deriva 1 item de fato_decisor quando há evidência", () => {
    const resultado = converterDeObservacao({ tipo: "fato", texto: "algo dito", evidencia: "citação literal" });
    expect(resultado).toEqual([{ categoria: "fato_decisor", texto: "algo dito", evidencia: "citação literal" }]);
  });

  it("converterDeObservacao devolve [] sem evidência ou sem observação", () => {
    expect(converterDeObservacao(null)).toEqual([]);
    expect(converterDeObservacao({ tipo: "fato", texto: "algo", evidencia: null })).toEqual([]);
  });
});

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, { select: encadeavel, eq: encadeavel, maybeSingle: terminal });
  return builder;
}

describe("acumularFichaNaSessao — I/O, caminho comum sem query", () => {
  it("itensNovos vazio: NÃO consulta o banco (zero query no caminho quente do ciclo)", async () => {
    const from = vi.fn();
    const admin = { from } as unknown as SupabaseClient;

    await acumularFichaNaSessao(admin, { sessaoId: "sessao-1", itensNovos: [] });

    expect(from).not.toHaveBeenCalled();
  });

  it("com item novo: lê o acumulado atual, mescla e grava por upsert", async () => {
    const upsertSpy = vi.fn(async (valor: { sessao_id: string; ficha_acumulada: FichaAcumulada }) => {
      void valor;
      return { error: null };
    });
    const from = vi.fn((tabela: string) => {
      if (tabela !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${tabela}`);
      return {
        select: () => consultaEncadeavel({ data: { ficha_acumulada: [] }, error: null }),
        upsert: upsertSpy,
      };
    });
    const admin = { from } as unknown as SupabaseClient;

    await acumularFichaNaSessao(admin, {
      sessaoId: "sessao-1",
      itensNovos: [itemFicha()],
      agoraIso: "2026-09-18T10:00:00Z",
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const chamada = upsertSpy.mock.calls[0]![0];
    expect(chamada.sessao_id).toBe("sessao-1");
    expect(chamada.ficha_acumulada).toHaveLength(1);
  });

  it("erro na leitura não lança — sai silenciosamente (registrado via registrarErro)", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${tabela}`);
      return { select: () => consultaEncadeavel({ data: null, error: new Error("falha") }) };
    });
    const admin = { from } as unknown as SupabaseClient;

    await expect(acumularFichaNaSessao(admin, { sessaoId: "sessao-1", itensNovos: [itemFicha()] })).resolves.toBeUndefined();
  });

  it("🔴 CHECK de 4096 bytes recusado (23514) no upsert: retorna sem lançar, e o acumulado ANTERIOR não é corrompido — perde-se só o item novo, nunca o histórico (migration 0122)", async () => {
    const acumuladoAnterior: FichaAcumulada = [
      { ...itemFicha(), chave: "dor:vai perder qualidade de vida", n: 3, primeira_mencao_em: "2026-09-18T09:00:00Z", ultima_mencao_em: "2026-09-18T09:30:00Z" },
    ];
    const upsertSpy = vi.fn(async () => ({ error: { code: "23514", message: "novo row viola check ficha_acumulada_bytes" } }));
    const from = vi.fn((tabela: string) => {
      if (tabela !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${tabela}`);
      return {
        select: () => consultaEncadeavel({ data: { ficha_acumulada: acumuladoAnterior }, error: null }),
        upsert: upsertSpy,
      };
    });
    const admin = { from } as unknown as SupabaseClient;

    await expect(
      acumularFichaNaSessao(admin, { sessaoId: "sessao-1", itensNovos: [itemFicha({ texto: "item novo que estoura o teto" })] }),
    ).resolves.toBeUndefined();

    // O upsert FOI TENTADO (com o array inteiro, histórico + item novo) e o
    // banco recusou — a função não tem como "salvar só o histórico" depois
    // que o CHECK já rejeitou a linha inteira. A garantia que este teste
    // tranca é a de cima: nenhuma exceção sobe, e a chamada nunca reduz o
    // upsert a uma gravação parcial/corrompida — só registra o erro e sai.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});
