// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { AbasColuna3, type AbaColuna3 } from "./AbasColuna3";

/**
 * Fase 13, FE-1 — a faixa de abas da COL 3 (`Ficha · Transcrição ·
 * Inventário`).
 *
 * O que estes testes travam, e por quê:
 *
 *  1. **A aba inativa não existe no DOM.** É a propriedade que justifica não
 *     usar `ui/Abas` (que só a esconde com `hidden`, mantendo poller,
 *     `onScroll` e `ResizeObserver` vivos fora de vista numa tela que fica 2
 *     horas aberta).
 *  2. **Nada troca de aba sozinho.** Só o clique dela — ou as setas do
 *     teclado. A única exceção é anterior à primeira interação: enquanto ela
 *     não escolheu nada, a aba de estreia acompanha `idPadrao`, que muda de
 *     `transcricao` para `ficha` no primeiro tick de polling.
 *  3. **Contagem só quando há o que contar.** Vazio é vazio, nunca
 *     `Inventário 0`.
 *  4. **Custo vertical.** A faixa é 28 px por linha e `flex-wrap`: quebra
 *     para 2 linhas em vez de estourar a célula.
 */

function aba(id: string, rotulo: string, contagem?: number | null): AbaColuna3 {
  return { id, rotulo, contagem, conteudo: () => <p>conteúdo de {rotulo}</p> };
}

const TRES = [aba("ficha", "Ficha", 4), aba("transcricao", "Transcrição"), aba("inventario", "Inventário", 70)];

describe("AbasColuna3 — a aba inativa não existe no DOM", () => {
  it("só o painel ATIVO é montado; o conteúdo dos outros não é sequer chamado", () => {
    const conteudoDaTranscricao = vi.fn(() => <p>conteúdo de Transcrição</p>);
    const abas: AbaColuna3[] = [aba("ficha", "Ficha", 4), { id: "transcricao", rotulo: "Transcrição", conteudo: conteudoDaTranscricao }];
    const { queryByText } = montar(<AbasColuna3 abas={abas} idPadrao="ficha" />);

    expect(queryByText("conteúdo de Ficha")).toBeTruthy();
    expect(queryByText("conteúdo de Transcrição")).toBeNull();
    // Não é só "não renderizou": a função nem foi chamada — nenhum efeito,
    // nenhum hook, nenhuma query da aba inativa.
    expect(conteudoDaTranscricao).not.toHaveBeenCalled();
  });

  it("clicar troca o painel inteiro: o anterior desmonta, o novo monta", () => {
    const { getByRole, queryByText } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    fireEvent.click(getByRole("tab", { name: "Transcrição" }));
    expect(queryByText("conteúdo de Ficha")).toBeNull();
    expect(queryByText("conteúdo de Transcrição")).toBeTruthy();
  });
});

describe("AbasColuna3 — aba de estreia", () => {
  it("estreia na Ficha quando ela existe", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    expect(getByRole("tab", { name: "Ficha, 4 itens" }).getAttribute("aria-selected")).toBe("true");
  });

  it("estreia na Transcrição quando a Ficha não está na faixa (kill-switch desligado)", () => {
    const semFicha = [aba("transcricao", "Transcrição"), aba("inventario", "Inventário", 70)];
    const { getByRole } = montar(<AbasColuna3 abas={semFicha} idPadrao="transcricao" />);
    expect(getByRole("tab", { name: "Transcrição" }).getAttribute("aria-selected")).toBe("true");
  });

  it("a Ficha chegando no 1º tick assume a estreia — mas NUNCA depois de ela já ter escolhido", () => {
    const semFicha = [aba("transcricao", "Transcrição"), aba("inventario", "Inventário", 70)];
    const { getByRole, rerender } = montar(<AbasColuna3 abas={semFicha} idPadrao="transcricao" />);
    expect(getByRole("tab", { name: "Transcrição" }).getAttribute("aria-selected")).toBe("true");

    // 1º tick do polling: a Ficha existe e vira a estreia (ela ainda não
    // tocou em nada).
    rerender(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    expect(getByRole("tab", { name: "Ficha, 4 itens" }).getAttribute("aria-selected")).toBe("true");

    // Agora ela escolhe. Daqui em diante NADA pode tirá-la de onde ela está.
    fireEvent.click(getByRole("tab", { name: "Inventário, 70 itens" }));
    rerender(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    expect(getByRole("tab", { name: "Inventário, 70 itens" }).getAttribute("aria-selected")).toBe("true");
  });

  it("a aba escolhida some do payload: cai na primeira, nunca numa tela em branco", () => {
    const { getByRole, queryByText, rerender } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    fireEvent.click(getByRole("tab", { name: "Inventário, 70 itens" }));

    rerender(<AbasColuna3 abas={[aba("ficha", "Ficha", 4), aba("transcricao", "Transcrição")]} idPadrao="ficha" />);

    expect(queryByText("conteúdo de Ficha")).toBeTruthy();
  });

  it("lista vazia não quebra (e não desenha faixa nenhuma)", () => {
    const { container } = montar(<AbasColuna3 abas={[]} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe("AbasColuna3 — contagem no rótulo", () => {
  it("mostra o número da aba INATIVA: nada fica escondido em silêncio", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    const inventario = getByRole("tab", { name: "Inventário, 70 itens" });
    expect(inventario.getAttribute("aria-selected")).toBe("false");
    expect(inventario.textContent).toContain("70");
  });

  it("vazio é vazio: contagem 0 (ou ausente) não vira 'Inventário 0'", () => {
    const abas = [aba("transcricao", "Transcrição"), aba("inventario", "Inventário", 0)];
    const { getByRole, queryByRole } = montar(<AbasColuna3 abas={abas} idPadrao="transcricao" />);
    expect(getByRole("tab", { name: "Inventário" }).textContent).not.toContain("0");
    expect(queryByRole("tab", { name: /Inventário, 0/ })).toBeNull();
  });
});

describe("AbasColuna3 — teclado e semântica", () => {
  it("setas ←/→ circulam pelas abas e levam o foco junto", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    const ficha = getByRole("tab", { name: "Ficha, 4 itens" });

    fireEvent.keyDown(ficha, { key: "ArrowRight" });
    const transcricao = getByRole("tab", { name: "Transcrição" });
    expect(transcricao.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(transcricao);

    fireEvent.keyDown(transcricao, { key: "ArrowLeft" });
    expect(getByRole("tab", { name: "Ficha, 4 itens" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Home e End vão para a primeira e a última", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="transcricao" />);
    fireEvent.keyDown(getByRole("tab", { name: "Transcrição" }), { key: "End" });
    expect(getByRole("tab", { name: "Inventário, 70 itens" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(getByRole("tab", { name: "Inventário, 70 itens" }), { key: "Home" });
    expect(getByRole("tab", { name: "Ficha, 4 itens" }).getAttribute("aria-selected")).toBe("true");
  });

  it("roving tabindex: uma única parada de Tab na faixa", () => {
    const { getAllByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    const tabs = getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "-1")).toHaveLength(2);
  });

  it("o painel aponta para a aba que o rotula (e vice-versa)", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    const painel = getByRole("tabpanel");
    expect(painel.getAttribute("aria-labelledby")).toBe("aba-col3-ficha");
    expect(getByRole("tab", { name: "Ficha, 4 itens" }).getAttribute("aria-controls")).toBe(painel.id);
  });

  it("axe limpo", async () => {
    const { container } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    await semViolacoes(container);
  });
});

describe("AbasColuna3 — custo vertical e contenção", () => {
  it("a faixa é `flex-wrap` e `shrink-0`: quebra para 2 linhas, nunca estoura a célula", () => {
    const { getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    const faixa = getByRole("tablist");
    expect(faixa.className).toContain("flex-wrap");
    expect(faixa.className).toContain("shrink-0");
  });

  it("cada aba tem 28 px de altura declarada e 44 px de alvo (o `::after` não conta no layout)", () => {
    const { getAllByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    for (const t of getAllByRole("tab")) {
      expect(t.className).toContain("min-h-7");
      expect(t.className).toContain("after:-inset-y-2");
    }
  });

  it("o painel é `min-h-0 flex-1`: é ele que absorve o que sobra, e o `AbasColuna3` não rola", () => {
    const { container, getByRole } = montar(<AbasColuna3 abas={TRES} idPadrao="ficha" />);
    expect(getByRole("tabpanel").className).toContain("min-h-0");
    expect(getByRole("tabpanel").className).toContain("flex-1");
    expect((container.firstElementChild as HTMLElement).className).not.toContain("overflow-y-auto");
  });
});
