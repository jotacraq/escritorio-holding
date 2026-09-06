import { describe, expect, it } from "vitest";
import { rotuloOpcao } from "./vocabulario";

describe("rotuloOpcao", () => {
  it("traduz os slugs de estado civil do formulário", () => {
    expect(rotuloOpcao("viuvo")).toBe("Viúvo(a)");
    expect(rotuloOpcao("uniao_estavel")).toBe("União estável");
    expect(rotuloOpcao("casado")).toBe("Casado(a)");
  });
  it("capitaliza slug desconhecido e deixa texto humano como está", () => {
    expect(rotuloOpcao("outro_valor")).toBe("Outro valor");
    expect(rotuloOpcao("Até 34")).toBe("Até 34");
    expect(rotuloOpcao("Decido sozinho(a)")).toBe("Decido sozinho(a)");
    expect(rotuloOpcao("Imóveis")).toBe("Imóveis");
  });
  it("nunca devolve nada do protótipo (opção maliciosa/errada na definição do formulário)", () => {
    expect(rotuloOpcao("constructor")).toBe("Constructor");
    expect(rotuloOpcao("__proto__")).toBe("__proto__");
    expect(rotuloOpcao("toString")).toBe("toString");
    expect(rotuloOpcao(undefined as unknown as string)).toBe("");
  });
});
