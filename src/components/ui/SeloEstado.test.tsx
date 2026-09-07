// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "./a11y-teste";
import { SeloEstado } from "./SeloEstado";

describe("SeloEstado", () => {
  it("mostra rótulo em TEXTO, não só cor", () => {
    const { getByText } = montar(<SeloEstado dominio="croqui" estado="pronto" />);
    expect(getByText("Pronto para apresentar")).toBeTruthy();
  });

  it("traz um glifo, e o glifo é escondido do leitor de tela", () => {
    // A leitura do estado é o rótulo. Um `<svg>` com nome próprio faria o
    // leitor de tela anunciar a mesma informação duas vezes.
    const { container } = montar(<SeloEstado dominio="pagamento" estado="aprovado" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("estado que o catálogo não conhece vira 'Sem informação', nunca um rótulo plausível", () => {
    const { getByText } = montar(<SeloEstado dominio="pagamento" estado="quase_pago" />);
    expect(getByText("Sem informação")).toBeTruthy();
  });

  it("não renderiza nada quando o estado é desconhecido e a tela pediu silêncio", () => {
    const { container } = montar(<SeloEstado dominio="pagamento" estado={null} mostrarDesconhecido={false} />);
    expect(container.textContent).toBe("");
  });

  it("só vira região viva quando a troca é assíncrona", () => {
    const { container: parado } = montar(<SeloEstado dominio="processo" estado="aberta" />);
    expect(parado.querySelector('[role="status"]')).toBeNull();
    const { container: vivo } = montar(<SeloEstado dominio="processo" estado="aberta" anunciar />);
    expect(vivo.querySelector('[role="status"]')).toBeTruthy();
  });

  it("não tem violação de acessibilidade em nenhum tom", async () => {
    const { container } = montar(
      <div>
        <SeloEstado dominio="croqui" estado="rascunho" />
        <SeloEstado dominio="pagamento" estado="reembolsado" />
        <SeloEstado dominio="processo" estado="congelada" />
        <SeloEstado dominio="mensagem" estado="enviada" />
        <SeloEstado dominio="presenca" estado="nao_compareceu" />
        <SeloEstado dominio="pagamento" estado="o_que_e_isso" />
      </div>,
    );
    await semViolacoes(container);
  });

  it("os domínios novos da rodada FIX renderizam e não têm violação", async () => {
    const { container, getByText } = montar(
      <div>
        <SeloEstado dominio="agendamento" estado="confirmado" />
        <SeloEstado dominio="integracao" estado="parcial" />
        <SeloEstado dominio="integracao" estado="desconhecida" />
      </div>,
    );
    // C23: o rótulo é do HORÁRIO escolhido, não de presença confirmada.
    expect(getByText("Horário marcado")).toBeTruthy();
    expect(getByText("Estado desconhecido")).toBeTruthy();
    await semViolacoes(container);
  });
});
