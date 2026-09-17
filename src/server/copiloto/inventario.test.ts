import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acumularInventario, acumularInventarioNaSessao, resumirInventario } from "./inventario";
import type { InventarioAcumulado, ItemInventarioMencionado } from "@/types/copiloto";

function itemMencionado(overrides: Partial<ItemInventarioMencionado> = {}): ItemInventarioMencionado {
  return {
    categoria: "imovel",
    descricao: "sala comercial no centro",
    titularidade: null,
    posse: "propria",
    valor_mencionado: null,
    evidencia: "temos uma sala comercial no centro",
    ...overrides,
  };
}

describe("acumularInventario — dedupe por categoria + descrição normalizada", () => {
  it("item novo entra no fim, preservando ordem de 1ª ocorrência", () => {
    const resultado = acumularInventario([], [itemMencionado()], "2026-09-17T10:00:00Z");
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({
      categoria: "imovel",
      descricao: "sala comercial no centro",
      chave: "imovel:sala comercial no centro",
      primeira_mencao_em: "2026-09-17T10:00:00Z",
      ultima_mencao_em: "2026-09-17T10:00:00Z",
    });
  });

  it("mesma descrição com grafia diferente (maiúscula/espaço duplo) casa na MESMA chave", () => {
    const primeira = acumularInventario([], [itemMencionado({ descricao: "Sala Comercial no Centro" })], "2026-09-17T10:00:00Z");
    const segunda = acumularInventario(primeira, [itemMencionado({ descricao: "sala  comercial  no centro" })], "2026-09-17T10:05:00Z");
    expect(segunda).toHaveLength(1);
  });

  it("categorias diferentes com a mesma descrição são itens DISTINTOS", () => {
    const resultado = acumularInventario(
      [],
      [itemMencionado({ categoria: "imovel", descricao: "renda" }), itemMencionado({ categoria: "investimento", descricao: "renda" })],
      "2026-09-17T10:00:00Z",
    );
    expect(resultado).toHaveLength(2);
  });

  it("item repetido na janela seguinte NÃO duplica — atualiza ultima_mencao_em, preserva primeira_mencao_em", () => {
    const primeira = acumularInventario([], [itemMencionado()], "2026-09-17T10:00:00Z");
    const segunda = acumularInventario(primeira, [itemMencionado()], "2026-09-17T10:05:00Z");
    expect(segunda).toHaveLength(1);
    expect(segunda[0]!.primeira_mencao_em).toBe("2026-09-17T10:00:00Z");
    expect(segunda[0]!.ultima_mencao_em).toBe("2026-09-17T10:05:00Z");
  });

  it("🔴 ANTI-PISCADA: item que sai da janela de 90s (não repetido) NÃO SOME — upsert, nunca delete", () => {
    const acumulado = acumularInventario([], [itemMencionado({ descricao: "apartamento na praia" })], "2026-09-17T10:00:00Z");
    // Chamada seguinte menciona só um item DIFERENTE — o antigo não está na lista de "novos".
    const resultado = acumularInventario(acumulado, [itemMencionado({ descricao: "sítio na serra" })], "2026-09-17T10:05:00Z");
    expect(resultado).toHaveLength(2);
    expect(resultado.map((i) => i.descricao)).toEqual(["apartamento na praia", "sítio na serra"]);
  });

  it("titularidade e valor_mencionado são preenchidos quando a menção seguinte esclarece o que antes era null", () => {
    const acumulado = acumularInventario([], [itemMencionado({ titularidade: null, valor_mencionado: null })], "2026-09-17T10:00:00Z");
    const resultado = acumularInventario(
      acumulado,
      [itemMencionado({ titularidade: "do casal", valor_mencionado: "uns 800 mil" })],
      "2026-09-17T10:05:00Z",
    );
    expect(resultado[0]!.titularidade).toBe("do casal");
    expect(resultado[0]!.valor_mencionado).toBe("uns 800 mil");
  });

  it("titularidade já preenchida NÃO é apagada por uma menção seguinte que não a repete", () => {
    const acumulado = acumularInventario([], [itemMencionado({ titularidade: "do casal" })], "2026-09-17T10:00:00Z");
    const resultado = acumularInventario(acumulado, [itemMencionado({ titularidade: null })], "2026-09-17T10:05:00Z");
    expect(resultado[0]!.titularidade).toBe("do casal");
  });

  it("posse 'propria' já estabelecida NÃO regride para 'incerta' numa menção subsequente mais vaga", () => {
    const acumulado = acumularInventario([], [itemMencionado({ posse: "propria" })], "2026-09-17T10:00:00Z");
    const resultado = acumularInventario(acumulado, [itemMencionado({ posse: "incerta" })], "2026-09-17T10:05:00Z");
    expect(resultado[0]!.posse).toBe("propria");
  });

  it("posse 'terceiro' explícito VENCE sobre 'propria' anterior — é correção do próprio decisor", () => {
    const acumulado = acumularInventario([], [itemMencionado({ posse: "propria" })], "2026-09-17T10:00:00Z");
    const resultado = acumularInventario(acumulado, [itemMencionado({ posse: "terceiro" })], "2026-09-17T10:05:00Z");
    expect(resultado[0]!.posse).toBe("terceiro");
  });
});

describe("resumirInventario — só posse 'propria' soma no total (pedido do dono: 'de fato')", () => {
  it("array vazio devolve resumo vazio, nunca lança", () => {
    expect(resumirInventario([])).toEqual({ por_categoria: [], total_itens_proprios: 0, total_itens_incertos: 0 });
  });

  it("item de posse 'terceiro' NUNCA entra em nenhum total nem na lista de categorias", () => {
    const acumulado: InventarioAcumulado = [
      {
        ...itemMencionado({ categoria: "empresa", descricao: "construtora do genro", posse: "terceiro" }),
        chave: "empresa:construtora do genro",
        primeira_mencao_em: "2026-09-17T10:00:00Z",
        ultima_mencao_em: "2026-09-17T10:00:00Z",
      },
    ];
    const resumo = resumirInventario(acumulado);
    expect(resumo.por_categoria).toEqual([]);
    expect(resumo.total_itens_proprios).toBe(0);
    expect(resumo.total_itens_incertos).toBe(0);
  });

  it("item 'incerta' conta separado — nunca somado ao total de 'propria'", () => {
    const acumulado: InventarioAcumulado = [
      { ...itemMencionado({ posse: "propria" }), chave: "imovel:a", primeira_mencao_em: "t", ultima_mencao_em: "t" },
      {
        ...itemMencionado({ descricao: "empresa mencionada sem clareza", posse: "incerta" }),
        chave: "imovel:b",
        primeira_mencao_em: "t",
        ultima_mencao_em: "t",
      },
    ];
    const resumo = resumirInventario(acumulado);
    expect(resumo.total_itens_proprios).toBe(1);
    expect(resumo.total_itens_incertos).toBe(1);
  });

  it("sem_titularidade conta só itens de posse própria SEM titularidade preenchida", () => {
    const acumulado: InventarioAcumulado = [
      { ...itemMencionado({ posse: "propria", titularidade: null }), chave: "imovel:a", primeira_mencao_em: "t", ultima_mencao_em: "t" },
      {
        ...itemMencionado({ descricao: "b", posse: "propria", titularidade: "do casal" }),
        chave: "imovel:b",
        primeira_mencao_em: "t",
        ultima_mencao_em: "t",
      },
    ];
    const resumo = resumirInventario(acumulado);
    expect(resumo.por_categoria[0]).toEqual({ categoria: "imovel", contagem_propria: 2, contagem_incerta: 0, sem_titularidade: 1 });
  });

  it("categorias diferentes geram entradas separadas em por_categoria", () => {
    const acumulado: InventarioAcumulado = [
      { ...itemMencionado({ categoria: "imovel" }), chave: "imovel:a", primeira_mencao_em: "t", ultima_mencao_em: "t" },
      { ...itemMencionado({ categoria: "empresa", descricao: "b" }), chave: "empresa:b", primeira_mencao_em: "t", ultima_mencao_em: "t" },
    ];
    const resumo = resumirInventario(acumulado);
    expect(resumo.por_categoria).toHaveLength(2);
    expect(resumo.total_itens_proprios).toBe(2);
  });
});

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, { select: encadeavel, eq: encadeavel, maybeSingle: terminal });
  return builder;
}

describe("acumularInventarioNaSessao — I/O, caminho comum sem query", () => {
  it("itensNovos vazio: NÃO consulta o banco (zero query no caminho quente do ciclo)", async () => {
    const from = vi.fn();
    const admin = { from } as unknown as SupabaseClient;

    await acumularInventarioNaSessao(admin, { sessaoId: "sessao-1", itensNovos: [] });

    expect(from).not.toHaveBeenCalled();
  });

  it("com item novo: lê o acumulado atual, mescla e grava por upsert", async () => {
    const upsertSpy = vi.fn(async (valor: { sessao_id: string; inventario_acumulado: InventarioAcumulado }) => {
      void valor;
      return { error: null };
    });
    const from = vi.fn((tabela: string) => {
      if (tabela !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${tabela}`);
      return {
        select: () => consultaEncadeavel({ data: { inventario_acumulado: [] }, error: null }),
        upsert: upsertSpy,
      };
    });
    const admin = { from } as unknown as SupabaseClient;

    await acumularInventarioNaSessao(admin, {
      sessaoId: "sessao-1",
      itensNovos: [itemMencionado()],
      agoraIso: "2026-09-17T10:00:00Z",
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const chamada = upsertSpy.mock.calls[0]![0];
    expect(chamada.sessao_id).toBe("sessao-1");
    expect(chamada.inventario_acumulado).toHaveLength(1);
  });

  it("erro na leitura não lança — sai silenciosamente (registrado via registrarErro)", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela !== "sessoes_copiloto") throw new Error(`tabela não mockada: ${tabela}`);
      return { select: () => consultaEncadeavel({ data: null, error: new Error("falha") }) };
    });
    const admin = { from } as unknown as SupabaseClient;

    await expect(acumularInventarioNaSessao(admin, { sessaoId: "sessao-1", itensNovos: [itemMencionado()] })).resolves.toBeUndefined();
  });
});
