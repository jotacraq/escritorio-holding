import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDossieCliente, montarDossieCliente } from "./dossie";

describe("montarDossieCliente — função pura, sinal por byte", () => {
  it("faixa de patrimônio nula quando a jornada não tem faixa declarada", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.faixa_patrimonio).toBeNull();
  });

  it("faixa de patrimônio vem literal de jornadas.faixa_patrimonio_declarada", () => {
    const dossie = montarDossieCliente({
      jornada: { faixa_patrimonio_declarada: "5 a 10 milhões" },
      familiares: [],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.faixa_patrimonio).toBe("5 a 10 milhões");
  });

  it("familiar carrega papel + nome (liberado pela decisão de 17/09/2026)", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [{ parentesco: "filho", nome: "Tiago", regime_casamento: null }],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.familiares).toEqual([{ papel: "filho", nome: "Tiago", regime: null }]);
  });

  it("regime de casamento só aparece para cônjuge — nunca vazado para filho/outro parentesco", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [
        { parentesco: "conjuge", nome: "Elaine", regime_casamento: "comunhao_parcial" },
        { parentesco: "filho", nome: "Tiago", regime_casamento: "não deveria existir, mas se existisse não sai" },
      ],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.familiares[0]).toEqual({ papel: "conjuge", nome: "Elaine", regime: "comunhao_parcial" });
    expect(dossie.familiares[1]!.regime).toBeNull();
  });

  it("'cônjuge' com acento também é reconhecido (parentesco é texto livre, não enum)", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [{ parentesco: "cônjuge", nome: "Elaine", regime_casamento: "comunhao_universal" }],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.familiares[0]!.regime).toBe("comunhao_universal");
  });

  it("familiar sem nome cadastrado entra com nome null — nunca inventa rótulo", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [{ parentesco: "neto", nome: null, regime_casamento: null }],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.familiares[0]!.nome).toBeNull();
  });

  it("patrimonio_tipos deduplica e preserva ordem de 1ª ocorrência", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [],
      patrimonioItens: [{ tipo: "imovel" }, { tipo: "veiculo" }, { tipo: "imovel" }, { tipo: "empresa" }],
      documentos: [],
      documentosPedidos: [],
    });
    expect(dossie.patrimonio_tipos).toEqual(["imovel", "veiculo", "empresa"]);
  });

  it("documentos_recebidos vem de `documentos` (existe linha = recebido), deduplicado", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [],
      patrimonioItens: [],
      documentos: [{ tipo: "imposto_renda" }, { tipo: "imposto_renda" }, { tipo: "contrato_social" }],
      documentosPedidos: [],
    });
    expect(dossie.documentos_recebidos).toEqual(["imposto_renda", "contrato_social"]);
  });

  it("documentos_pendentes: só pedido, sem conferido_em E sem dispensado_em (mesmo critério do radar, 0065)", () => {
    const dossie = montarDossieCliente({
      jornada: null,
      familiares: [],
      patrimonioItens: [],
      documentos: [],
      documentosPedidos: [
        { tipo: "matricula_imovel", conferido_em: null, dispensado_em: null },
        { tipo: "certidao_casamento", conferido_em: "2026-09-01T00:00:00Z", dispensado_em: null },
        { tipo: "balanco", conferido_em: null, dispensado_em: "2026-09-02T00:00:00Z" },
      ],
    });
    expect(dossie.documentos_pendentes).toEqual(["matricula_imovel"]);
  });

  it("nenhum campo de valor monetário aparece no resultado — protege o orçamento de byte", () => {
    const dossie = montarDossieCliente({
      jornada: { faixa_patrimonio_declarada: "1 a 5 milhões" },
      familiares: [{ parentesco: "conjuge", nome: "Elaine", regime_casamento: "comunhao_parcial" }],
      patrimonioItens: [{ tipo: "imovel" }],
      documentos: [{ tipo: "imposto_renda" }],
      documentosPedidos: [],
    });
    const serializado = JSON.stringify(dossie);
    expect(serializado).not.toMatch(/valor|R\$|\d{4,}/);
  });
});

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    maybeSingle: terminal,
    returns: encadeavel,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

describe("buscarDossieCliente — I/O, 4 queries em paralelo, cada predicado usa índice provado", () => {
  function montarSupabase(respostas: Record<string, unknown>): SupabaseClient {
    const from = vi.fn((tabela: string) => {
      if (!(tabela in respostas)) throw new Error(`tabela não mockada: ${tabela}`);
      return consultaEncadeavel(respostas[tabela]);
    });
    return { from } as unknown as SupabaseClient;
  }

  it("compõe o dossiê a partir das 4 tabelas, sem lançar em resultado vazio", async () => {
    const supabase = montarSupabase({
      jornadas: { data: { faixa_patrimonio_declarada: "5 a 10 milhões" }, error: null },
      familiares: { data: [{ parentesco: "conjuge", nome: "Elaine", regime_casamento: "comunhao_parcial" }], error: null },
      patrimonio_itens: { data: [{ tipo: "imovel" }], error: null },
      documentos: { data: [{ tipo: "imposto_renda" }], error: null },
      documentos_pedidos: { data: [{ tipo: "contrato_social", conferido_em: null, dispensado_em: null }], error: null },
    });

    const dossie = await buscarDossieCliente(supabase, "pessoa-1", "jornada-1");

    expect(dossie).toEqual({
      faixa_patrimonio: "5 a 10 milhões",
      familiares: [{ papel: "conjuge", nome: "Elaine", regime: "comunhao_parcial" }],
      patrimonio_tipos: ["imovel"],
      documentos_recebidos: ["imposto_renda"],
      documentos_pendentes: ["contrato_social"],
    });
  });

  it("erro em qualquer uma das 5 idas ao banco propaga (lança), nunca mascara com dado vazio", async () => {
    const supabase = montarSupabase({
      jornadas: { data: null, error: new Error("falha_jornada") },
      familiares: { data: [], error: null },
      patrimonio_itens: { data: [], error: null },
      documentos: { data: [], error: null },
      documentos_pedidos: { data: [], error: null },
    });

    await expect(buscarDossieCliente(supabase, "pessoa-1", "jornada-1")).rejects.toThrow("falha_jornada");
  });

  it("jornada ausente (maybeSingle null) não lança — vira faixa_patrimonio null", async () => {
    const supabase = montarSupabase({
      jornadas: { data: null, error: null },
      familiares: { data: [], error: null },
      patrimonio_itens: { data: [], error: null },
      documentos: { data: [], error: null },
      documentos_pedidos: { data: [], error: null },
    });

    const dossie = await buscarDossieCliente(supabase, "pessoa-1", "jornada-1");
    expect(dossie.faixa_patrimonio).toBeNull();
  });
});
