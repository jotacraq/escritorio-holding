import { describe, expect, it } from "vitest";
import { CONFIANCA_MINIMA, MAX_RESPOSTA, validarSaidaIa } from "./schema";

/**
 * O parser da saída da IA é o teste mais barato desta fase e o que impede que
 * um modelo criativo vire mensagem no WhatsApp de um cliente do escritório.
 * "Não sei" NUNCA vira texto plausível (D13).
 */

const saida = (campos: Partial<Parameters<typeof validarSaidaIa>[0]> = {}) => ({
  intencao: "duvida_uso_sistema",
  resposta: "Você abre o link e envia o arquivo por lá.",
  acao: "nenhuma" as const,
  confianca: 0.9,
  ...campos,
});

describe("validarSaidaIa", () => {
  it("aceita a saída bem formada", () => {
    const r = validarSaidaIa(saida());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intencao).toBe("duvida_uso_sistema");
  });

  it("recusa intenção que o modelo inventou", () => {
    expect(validarSaidaIa(saida({ intencao: "vender_holding" }))).toEqual({ ok: false, motivo: "intencao_invalida" });
  });

  it("`desconhecida` nunca vira texto — é o próprio pedido de socorro", () => {
    expect(validarSaidaIa(saida({ intencao: "desconhecida" }))).toEqual({ ok: false, motivo: "intencao_invalida" });
  });

  it("recusa confiança abaixo do mínimo", () => {
    expect(validarSaidaIa(saida({ confianca: CONFIANCA_MINIMA - 0.01 }))).toEqual({ ok: false, motivo: "confianca_baixa" });
    expect(validarSaidaIa(saida({ confianca: 0 }))).toEqual({ ok: false, motivo: "confianca_baixa" });
  });

  it("recusa confiança fora de [0,1] e NaN", () => {
    expect(validarSaidaIa(saida({ confianca: 1.4 }))).toEqual({ ok: false, motivo: "confianca_baixa" });
    expect(validarSaidaIa(saida({ confianca: Number.NaN }))).toEqual({ ok: false, motivo: "confianca_baixa" });
  });

  it("resposta vazia é recusa, não frase de preenchimento", () => {
    expect(validarSaidaIa(saida({ resposta: "   " }))).toEqual({ ok: false, motivo: "resposta_vazia" });
  });

  it("resposta longa demais é recusada inteira — cortar no meio da frase é pior", () => {
    expect(validarSaidaIa(saida({ resposta: "a".repeat(MAX_RESPOSTA + 1) }))).toEqual({ ok: false, motivo: "resposta_longa" });
  });

  it("aceita exatamente no teto", () => {
    expect(validarSaidaIa(saida({ resposta: "a".repeat(MAX_RESPOSTA) })).ok).toBe(true);
    expect(validarSaidaIa(saida({ confianca: CONFIANCA_MINIMA })).ok).toBe(true);
  });
});
