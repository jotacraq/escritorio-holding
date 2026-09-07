// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "./a11y-teste";
import { BarraAcaoMobile } from "./BarraAcaoMobile";

describe("BarraAcaoMobile", () => {
  it("reserva no fluxo a altura que ocupa por cima — senão tapa a última linha e o foco", () => {
    const { container } = montar(
      <BarraAcaoMobile>
        <button type="button">Ligar para a cliente</button>
      </BarraAcaoMobile>,
    );
    const espacador = container.querySelector('[aria-hidden="true"]');
    expect(espacador).toBeTruthy();
    expect(espacador?.className).toContain("h-24");
  });

  it("não vai para o papel", () => {
    const { container } = montar(
      <BarraAcaoMobile>
        <button type="button">Enviar</button>
      </BarraAcaoMobile>,
    );
    expect(container.querySelector(".nao-imprimir")).toBeTruthy();
  });

  it("fica acima da barra de navegação, nunca em cima dela", () => {
    const { container } = montar(
      <BarraAcaoMobile>
        <button type="button">Enviar</button>
      </BarraAcaoMobile>,
    );
    const barra = container.querySelector(".nao-imprimir") as HTMLElement;
    expect(barra.style.bottom).toContain("var(--altura-nav-inferior)");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <BarraAcaoMobile contexto="Passo de agora" secundaria={<button type="button">Adiar</button>}>
        <button type="button">Ligar para a cliente</button>
      </BarraAcaoMobile>,
    );
    await semViolacoes(container);
  });
});
