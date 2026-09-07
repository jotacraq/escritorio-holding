import { describe, expect, it } from "vitest";
import {
  eventoExternoIdDoPayload,
  instanteDoEvento,
  produtoIdDoPayload,
  transacaoDoPayload,
  type PayloadHotmart,
} from "./roteador";

/**
 * O roteador é o que permite UM endpoint servir os TRÊS produtos (C3/D2). Se
 * ele devolver o id errado — ou devolver `null` quando havia id —, o pagamento
 * cai em `produto_nao_mapeado` e a jornada não anda. Por isso ele é testado
 * separado da chamada ao banco.
 */

function payload(parcial: Partial<PayloadHotmart["data"]> & { id?: string; creation_date?: number | string } = {}): PayloadHotmart {
  const { id, creation_date, ...data } = parcial as Record<string, unknown>;
  return { id: id as string | undefined, creation_date: creation_date as number | undefined, data: data as PayloadHotmart["data"] };
}

describe("produtoIdDoPayload", () => {
  it("aceita número e texto — a Hotmart manda os dois", () => {
    expect(produtoIdDoPayload(payload({ product: { id: 5064314 } }))).toBe("5064314");
    expect(produtoIdDoPayload(payload({ product: { id: "5064314" } }))).toBe("5064314");
    expect(produtoIdDoPayload(payload({ product: { id: " 5064314 " } }))).toBe("5064314");
  });

  it("devolve null quando não há produto — nunca uma string vazia que casaria com nada", () => {
    expect(produtoIdDoPayload(payload({}))).toBeNull();
    expect(produtoIdDoPayload(payload({ product: {} }))).toBeNull();
    expect(produtoIdDoPayload(payload({ product: { id: "" } }))).toBeNull();
    expect(produtoIdDoPayload(null)).toBeNull();
    expect(produtoIdDoPayload(undefined)).toBeNull();
  });
});

describe("transacaoDoPayload e eventoExternoIdDoPayload", () => {
  it("transação é a chave da COMPRA; id é a chave do EVENTO", () => {
    const p = payload({ id: "evt-1", purchase: { transaction: "HP1699412937" } });
    expect(transacaoDoPayload(p)).toBe("HP1699412937");
    expect(eventoExternoIdDoPayload(p)).toBe("evt-1");
  });

  it("sem `id` no payload, o evento cai na transação (compatibilidade Fase 1)", () => {
    const p = payload({ purchase: { transaction: "HP1699412937" } });
    expect(eventoExternoIdDoPayload(p)).toBe("HP1699412937");
  });

  it("sem nenhum dos dois, devolve null — a rota responde 400 e nada é inventado", () => {
    expect(eventoExternoIdDoPayload(payload({}))).toBeNull();
    expect(transacaoDoPayload(payload({ purchase: {} }))).toBeNull();
  });
});

describe("instanteDoEvento — a chave de ORDEM que impede o rebaixamento (D7)", () => {
  it("prefere creation_date (epoch em MILISSEGUNDOS)", () => {
    const p = payload({ creation_date: 1_782_000_000_000, purchase: { approved_date: 1_700_000_000_000 } });
    expect(instanteDoEvento(p)).toBe(new Date(1_782_000_000_000).toISOString());
  });

  it("cai em approved_date e depois em order_date", () => {
    expect(instanteDoEvento(payload({ purchase: { approved_date: 1_700_000_000_000 } }))).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
    expect(instanteDoEvento(payload({ purchase: { order_date: 1_600_000_000_000 } }))).toBe(
      new Date(1_600_000_000_000).toISOString(),
    );
  });

  it("aceita epoch em texto", () => {
    expect(instanteDoEvento(payload({ creation_date: "1782000000000" }))).toBe(new Date(1_782_000_000_000).toISOString());
  });

  it("data ausente ou ilegível vira null — não vira now() disfarçado de dado da Hotmart", () => {
    expect(instanteDoEvento(payload({}))).toBeNull();
    expect(instanteDoEvento(payload({ creation_date: "ontem" }))).toBeNull();
    expect(instanteDoEvento(payload({ creation_date: 0 }))).toBeNull();
    expect(instanteDoEvento(null)).toBeNull();
  });

  it("a ordem entre duas entregas é comparável como string ISO", () => {
    const velho = instanteDoEvento(payload({ creation_date: 1_700_000_000_000 }))!;
    const novo = instanteDoEvento(payload({ creation_date: 1_782_000_000_000 }))!;
    expect(velho < novo).toBe(true);
  });
});
