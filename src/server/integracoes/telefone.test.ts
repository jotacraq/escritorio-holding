import { describe, expect, it } from "vitest";
import { normalizarTelefoneE164, telefoneParaLigacao, variantesTelefone } from "./telefone";

describe("normalizarTelefoneE164 (busca — permissiva de propósito)", () => {
  it("assume Brasil para 10 e 11 dígitos", () => {
    expect(normalizarTelefoneE164("(21) 98765-4321")).toBe("+5521987654321");
    expect(normalizarTelefoneE164("2132280635")).toBe("+552132280635");
  });

  it("preserva DDI quando veio com +", () => {
    expect(normalizarTelefoneE164("+351 912 345 678")).toBe("+351912345678");
  });

  it("devolve null em vez de casar com a pessoa errada", () => {
    expect(normalizarTelefoneE164("")).toBeNull();
    expect(normalizarTelefoneE164(null)).toBeNull();
    expect(normalizarTelefoneE164("12345")).toBeNull();
  });
});

describe("telefoneParaLigacao (discagem — estrita)", () => {
  it("celular já em E.164 passa intacto", () => {
    expect(telefoneParaLigacao("+5521987654321")).toEqual({ valido: true, e164: "+5521987654321", alterado: false });
  });

  it("celular com máscara vira E.164", () => {
    expect(telefoneParaLigacao("(21) 98765-4321")).toEqual({ valido: true, e164: "+5521987654321", alterado: true });
  });

  it("celular antigo de 8 dígitos ganha o nono dígito", () => {
    expect(telefoneParaLigacao("21 8765-4321")).toEqual({ valido: true, e164: "+5521987654321", alterado: true });
  });

  it("fixo de 8 dígitos é aceito como está (a IA também liga para fixo)", () => {
    expect(telefoneParaLigacao("(21) 3228-0635")).toEqual({ valido: true, e164: "+552132280635", alterado: true });
  });

  it("recusa DDD que não existe", () => {
    expect(telefoneParaLigacao("(20) 98765-4321")).toEqual({ valido: false, motivo: "ddd_inexistente" });
    expect(telefoneParaLigacao("+5523987654321")).toEqual({ valido: false, motivo: "ddd_inexistente" });
  });

  it("recusa assinante de 9 dígitos que não começa com 9", () => {
    expect(telefoneParaLigacao("+5521387654321")).toEqual({ valido: false, motivo: "assinante_invalido" });
  });

  it("recusa assinante de 8 dígitos começando em 0 ou 1", () => {
    expect(telefoneParaLigacao("2110234567")).toEqual({ valido: false, motivo: "assinante_invalido" });
  });

  it("recusa vazio e formato irreconhecível — nunca disca no escuro", () => {
    expect(telefoneParaLigacao("")).toEqual({ valido: false, motivo: "vazio" });
    expect(telefoneParaLigacao("   ")).toEqual({ valido: false, motivo: "vazio" });
    expect(telefoneParaLigacao(null)).toEqual({ valido: false, motivo: "vazio" });
    expect(telefoneParaLigacao("não tenho")).toEqual({ valido: false, motivo: "formato_desconhecido" });
    expect(telefoneParaLigacao("99999")).toEqual({ valido: false, motivo: "formato_desconhecido" });
  });

  it("aceita número estrangeiro já com DDI (não temos plano de numeração de fora)", () => {
    expect(telefoneParaLigacao("+351912345678")).toEqual({ valido: true, e164: "+351912345678", alterado: false });
  });

  it("é idempotente: normalizar o normalizado não muda nada", () => {
    const um = telefoneParaLigacao("21 8765-4321");
    expect(um.valido).toBe(true);
    if (!um.valido) return;
    expect(telefoneParaLigacao(um.e164)).toEqual({ valido: true, e164: um.e164, alterado: false });
  });
});

describe("variantesTelefone", () => {
  it("gera a forma com e sem o nono dígito para BUSCAR", () => {
    const v = variantesTelefone("+5521987654321");
    expect(v).toContain("+5521987654321");
    expect(v).toContain("+552187654321");
  });

  /**
   * Fase 9, CONFLITO C1. Medido no banco em 07/09/2026: a única pessoa
   * `origem_dado='real'` está gravada como `11988887777` — 11 dígitos, SEM
   * `+`. Antes disto o casamento por telefone acertava as 4 famílias de
   * demonstração e errava justamente quem é real.
   */
  it("cobre também as grafias sem `+` e sem DDI (é como o cadastro real está)", () => {
    const v = variantesTelefone("+5511988887777");
    expect(v).toContain("+5511988887777");
    expect(v).toContain("5511988887777");
    expect(v).toContain("11988887777");
    // e as mesmas três sem o nono dígito
    expect(v).toContain("+551188887777");
    expect(v).toContain("551188887777");
    expect(v).toContain("1188887777");
    expect(new Set(v).size).toBe(v.length);
  });

  it("número fora do Brasil não ganha variante inventada", () => {
    expect(variantesTelefone("+351912345678")).toEqual(["+351912345678", "351912345678"]);
  });
});
