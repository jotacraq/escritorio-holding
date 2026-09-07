// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "../ui/a11y-teste";
import { ITENS_NAVEGACAO } from "./Nav";
import { NavInferior } from "./NavInferior";

vi.mock("next/navigation", () => ({ usePathname: () => "/clientes" }));

describe("NavInferior", () => {
  it("mostra as MESMAS cinco áreas, na mesma ordem e com os mesmos rótulos da lateral", () => {
    const { container } = montar(<NavInferior />);
    const rotulos = [...container.querySelectorAll("nav a")].map((a) => a.textContent?.trim());
    expect(rotulos).toEqual(ITENS_NAVEGACAO.map((i) => i.rotulo));
  });

  it("todo item tem RÓTULO em texto, nunca só ícone", () => {
    const { container } = montar(<NavInferior />);
    for (const link of container.querySelectorAll("nav a")) {
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("a área atual é anunciada por `aria-current`, não só pela cor", () => {
    const { container } = montar(<NavInferior />);
    const atuais = [...container.querySelectorAll('[aria-current="page"]')];
    expect(atuais).toHaveLength(1);
    expect(atuais[0].getAttribute("href")).toBe("/clientes");
  });

  it("tem nome próprio de landmark — a lateral continua no DOM com o dela", () => {
    const { container } = montar(<NavInferior />);
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Áreas do sistema");
  });

  it("reserva a própria altura no fluxo e não vai para o papel", () => {
    const { container } = montar(<NavInferior />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelector("nav")?.className).toContain("nao-imprimir");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(<NavInferior />);
    await semViolacoes(container);
  });
});
