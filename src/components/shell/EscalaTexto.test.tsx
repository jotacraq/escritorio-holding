// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { montar, semViolacoes } from "../ui/a11y-teste";
import { CHAVE_ESCALA, EscalaTexto } from "./EscalaTexto";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-escala");
});

describe("EscalaTexto", () => {
  it("nasce em Padrão (B55: é a escala que o João aprovou)", () => {
    const { container } = montar(<EscalaTexto />);
    const marcado = container.querySelector<HTMLInputElement>("input:checked");
    expect(marcado?.value).toBe("padrao");
  });

  it("troca o atributo do <html> e guarda a escolha", () => {
    const { getByLabelText } = montar(<EscalaTexto />);
    fireEvent.click(getByLabelText("Grande"));
    expect(document.documentElement.getAttribute("data-escala")).toBe("grande");
    expect(window.localStorage.getItem(CHAVE_ESCALA)).toBe("grande");
  });

  it("respeita a escolha já aplicada pelo script antes do primeiro paint", () => {
    document.documentElement.setAttribute("data-escala", "media");
    const { container } = montar(<EscalaTexto />);
    expect(container.querySelector<HTMLInputElement>("input:checked")?.value).toBe("media");
  });

  it("localStorage indisponível não derruba a tela — a escolha vale para a sessão", () => {
    const guardar = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage bloqueado (janela anônima)");
    });
    const { getByLabelText } = montar(<EscalaTexto />);
    expect(() => fireEvent.click(getByLabelText("Média"))).not.toThrow();
    expect(document.documentElement.getAttribute("data-escala")).toBe("media");
    guardar.mockRestore();
  });

  it("valor estranho no armazenamento cai no padrão, não numa escala inventada", () => {
    document.documentElement.setAttribute("data-escala", "gigante");
    const { container } = montar(<EscalaTexto />);
    expect(container.querySelector<HTMLInputElement>("input:checked")?.value).toBe("padrao");
  });

  it("é um grupo de rádios com nome — teclado e leitor de tela de graça", () => {
    const { container } = montar(<EscalaTexto />);
    expect(container.querySelector("legend")?.textContent).toBe("Tamanho do texto");
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(<EscalaTexto />);
    await semViolacoes(container);
  });
});
