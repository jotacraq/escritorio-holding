import { describe, expect, it } from "vitest";
import {
  MAPA_EVENTO_HOTMART,
  estadoDaCompraHotmart,
  mapearStatusHotmart,
  normalizarEventoHotmart,
  statusDoEventoHotmart,
  type EventoHotmartConhecido,
} from "./eventos";

/**
 * O que estes testes travam é UMA frase: **o estado da compra vem do evento**.
 * Sem isso, `PURCHASE_BILLET_PRINTED` com `purchase.status = "APPROVED"` (que a
 * Hotmart manda de verdade, segundo o vault do João) faria o sistema dizer que
 * a família pagou, avançar a etapa, disparar a régua e enfileirar a ligação.
 *
 * A prova do lado do BANCO é `scripts/verificacao-0083-0085.sql` (12 asserções
 * com rollback). Aqui é a lógica pura, sem rede — a divisão que o cabeçalho do
 * `vitest.config.ts` estabelece.
 */

describe("normalizarEventoHotmart", () => {
  it("tira o prefixo PURCHASE_ e sobe para maiúsculas", () => {
    expect(normalizarEventoHotmart("purchase_approved")).toBe("APPROVED");
    expect(normalizarEventoHotmart("  PURCHASE_EXPIRED  ")).toBe("EXPIRED");
    expect(normalizarEventoHotmart("PURCHASE-CANCELED")).toBe("CANCELED");
  });

  it("colapsa as duas grafias do padrão P4 do vault", () => {
    // COMPLETE(16) vs COMPLETED(94) e BILLET_PRINTED(3) vs PRINTED_BILLET(3)
    // no log real: filtro com uma grafia só perde a outra metade em silêncio.
    expect(normalizarEventoHotmart("PURCHASE_COMPLETED")).toBe("COMPLETE");
    expect(normalizarEventoHotmart("PURCHASE_PRINTED_BILLET")).toBe("BILLET_PRINTED");
    expect(normalizarEventoHotmart("PURCHASE_CANCELLED")).toBe("CANCELED");
    expect(normalizarEventoHotmart("PURCHASE_PROTESTED")).toBe("PROTEST");
    expect(normalizarEventoHotmart("PURCHASE_DISPUTE")).toBe("CHARGEBACK");
  });

  it("devolve null para ausente ou vazio — nunca uma string mentirosa", () => {
    expect(normalizarEventoHotmart(undefined)).toBeNull();
    expect(normalizarEventoHotmart(null)).toBeNull();
    expect(normalizarEventoHotmart("   ")).toBeNull();
  });
});

describe("statusDoEventoHotmart — o mapa da §A3", () => {
  const esperado: Record<EventoHotmartConhecido, string> = {
    APPROVED: "aprovado",
    COMPLETE: "aprovado",
    BILLET_PRINTED: "boleto_gerado",
    DELAYED: "atrasado",
    EXPIRED: "expirado",
    CANCELED: "cancelado",
    REFUNDED: "reembolsado",
    CHARGEBACK: "estornado",
    PROTEST: "estornado",
    OUT_OF_SHOPPING_CART: "em_analise",
  };

  for (const [evento, status] of Object.entries(esperado)) {
    it(`${evento} → ${status}`, () => {
      expect(statusDoEventoHotmart(evento)).toBe(status);
      expect(MAPA_EVENTO_HOTMART[evento as EventoHotmartConhecido]).toBe(status);
    });
  }

  it("evento fora do mapa devolve null — e null NUNCA vira aprovado", () => {
    expect(statusDoEventoHotmart("ALGO_QUE_A_HOTMART_INVENTOU")).toBeNull();
    expect(statusDoEventoHotmart("SUBSCRIPTION_CANCELLATION")).toBeNull();
    expect(statusDoEventoHotmart(null)).toBeNull();
  });

  it("nenhum evento do mapa que não seja APPROVED/COMPLETE aprova", () => {
    const aprovadores = Object.entries(MAPA_EVENTO_HOTMART)
      .filter(([, status]) => status === "aprovado")
      .map(([evento]) => evento)
      .sort();
    expect(aprovadores).toEqual(["APPROVED", "COMPLETE"]);
  });
});

describe("estadoDaCompraHotmart — a precedência que fecha o bug D1", () => {
  it("boleto emitido com purchase.status=APPROVED NÃO aprova", () => {
    const estado = estadoDaCompraHotmart("PURCHASE_BILLET_PRINTED", "APPROVED");
    expect(estado).toEqual({ evento: "BILLET_PRINTED", status: "boleto_gerado", fonte: "evento", conhecido: true });
  });

  it("COMPLETE aprova mesmo com purchase.status dizendo outra coisa", () => {
    // pix/boleto COMPENSADO: é o evento que o webhook do outro projeto do João
    // descartava, origem do "pagou e o sistema não viu".
    const estado = estadoDaCompraHotmart("PURCHASE_COMPLETE", "BILLET_PRINTED");
    expect(estado.status).toBe("aprovado");
    expect(estado.fonte).toBe("evento");
  });

  it("evento desconhecido cai em em_analise e marca conhecido=false", () => {
    const estado = estadoDaCompraHotmart("PURCHASE_ALGO_NOVO", "APPROVED");
    expect(estado).toEqual({ evento: "ALGO_NOVO", status: "em_analise", fonte: "evento", conhecido: false });
  });

  it("sem evento no payload, e só aí, purchase.status tem voz", () => {
    expect(estadoDaCompraHotmart(undefined, "APPROVED")).toEqual({
      evento: null,
      status: "aprovado",
      fonte: "purchase.status",
      conhecido: false,
    });
    expect(estadoDaCompraHotmart("", "BILLET_PRINTED").status).toBe("boleto_gerado");
  });

  it("payload completamente mudo não aprova nada", () => {
    expect(estadoDaCompraHotmart(undefined, undefined).status).toBe("em_analise");
    expect(estadoDaCompraHotmart(null, null).status).toBe("em_analise");
  });
});

describe("mapearStatusHotmart — fallback do reprocesso e do seed", () => {
  it("separa expirado de cancelado (antes os dois eram 'cancelado')", () => {
    expect(mapearStatusHotmart("EXPIRED")).toBe("expirado");
    expect(mapearStatusHotmart("CANCELED")).toBe("cancelado");
    expect(mapearStatusHotmart("CANCELLED")).toBe("cancelado");
  });

  it("boleto tem estado próprio (antes caía no balde 'pendente')", () => {
    expect(mapearStatusHotmart("BILLET_PRINTED")).toBe("boleto_gerado");
    expect(mapearStatusHotmart("PRINTED_BILLET")).toBe("boleto_gerado");
    expect(mapearStatusHotmart("PROCESSING_TRANSACTION")).toBe("pendente");
  });

  it("desconhecido nunca aprova", () => {
    expect(mapearStatusHotmart("XPTO")).toBe("em_analise");
    expect(mapearStatusHotmart(undefined)).toBe("em_analise");
  });
});
