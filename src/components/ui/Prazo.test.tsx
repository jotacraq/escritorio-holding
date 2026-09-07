// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "./a11y-teste";
import { Prazo, textoDoPrazo } from "./Prazo";

const HOJE = new Date(2026, 8, 7, 15, 0); // 07/09/2026

describe("Prazo", () => {
  it("mostra as duas leituras: a relativa que decide e a absoluta que se anota", () => {
    const { container } = montar(<Prazo vence="2026-09-09" agora={HOJE} />);
    expect(container.querySelector('[aria-hidden="true"].truncate')?.textContent).toBe("Vence em 2 dias · 09/09");
    const tempo = container.querySelector("time");
    expect(tempo?.getAttribute("datetime")).toBe("2026-09-09");
    expect(tempo?.textContent).toBe("vence em 2 dias, em 09 de setembro de 2026");
  });

  it("o separador só existe quando há data — nunca sobra um `·` órfão", () => {
    // Regressão do achado do CRQ: "Vence hoje·, em 07/09".
    const semData = montar(<Prazo vence="2026-09-07" agora={HOJE} mostrarAbsoluta={false} />);
    expect(semData.container.querySelector('[aria-hidden="true"].truncate')?.textContent).toBe("Vence hoje");
    expect(semData.container.textContent).not.toContain("·");
    const comData = montar(<Prazo vence="2026-09-07" agora={HOJE} />);
    expect(comData.container.textContent).not.toContain("·,");
  });

  it("o rótulo entra na frase do leitor de tela, não solto antes do texto", () => {
    const { container } = montar(<Prazo vence="2026-09-07" agora={HOJE} rotulo="Prazo" />);
    expect(container.querySelector("time")?.textContent).toBe("Prazo: vence hoje, em 07 de setembro de 2026");
  });

  it("não desloca o dia por causa do fuso (o `date` do Postgres em UTC−3)", () => {
    const { container } = montar(<Prazo vence="2026-09-07" agora={HOJE} />);
    expect(container.textContent).toContain("Vence hoje");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-07");
  });

  it("vencido, hoje e futuro têm textos diferentes — não só cores diferentes", () => {
    expect(textoDoPrazo("vencido", -3)).toBe("Vencido há 3 dias");
    expect(textoDoPrazo("vencido", -1)).toBe("Vencido ontem");
    expect(textoDoPrazo("hoje", 0)).toBe("Vence hoje");
    expect(textoDoPrazo("proximo", 1)).toBe("Vence amanhã");
    expect(textoDoPrazo("futuro", 20)).toBe("Vence em 20 dias");
  });

  it("sem data diz 'Sem prazo' — que não é o mesmo que estar em dia", () => {
    const { container } = montar(<Prazo vence={null} agora={HOJE} />);
    expect(container.querySelector('[aria-hidden="true"].truncate')?.textContent).toBe("Sem prazo");
    expect(container.querySelector("time")).toBeNull();
  });

  it("some quando a tela pede silêncio na ausência de data", () => {
    const { container } = montar(<Prazo vence={null} mostrarSemPrazo={false} agora={HOJE} />);
    expect(container.textContent).toBe("");
  });

  it("não tem violação de acessibilidade nos quatro estados", async () => {
    const { container } = montar(
      <div>
        <Prazo vence="2026-09-01" agora={HOJE} rotulo="Prazo" />
        <Prazo vence="2026-09-07" agora={HOJE} />
        <Prazo vence="2026-09-08" agora={HOJE} />
        <Prazo vence="2026-12-01" agora={HOJE} />
        <Prazo vence={null} agora={HOJE} />
      </div>,
    );
    await semViolacoes(container);
  });
});
