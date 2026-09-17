// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { Coluna } from "./Coluna";

/**
 * Fatia 1 (17/09/2026) — prova de GEOMETRIA, não de pigmento. O bug real
 * (transcrição vazando por cima do rodapé com 31 segmentos) só existe porque
 * a CÉLULA do grid era `display: block` (`<div className="min-h-0">`), o
 * que deixa o `flex-1` do filho INERTE — sem flex context, o filho cresce
 * até caber o conteúdo e estoura o `max-h` do avô, que não tinha `overflow`
 * para recortar.
 *
 * ⚠️ jsdom NÃO calcula layout de verdade, e a primeira tentativa deste
 * arquivo tentava provar isso por `getComputedStyle` — TAMBÉM não serve: sem
 * nenhuma folha de estilo carregada (Tailwind não roda em jsdom), todo
 * elemento devolve os defaults do navegador simulado (`display: block` para
 * `<div>`, sempre), não importa a classe aplicada. Rodado de verdade: essa
 * asserção FALHAVA mesmo com `Coluna` correta ("expected 'block' to be
 * 'flex'") — reportando aqui em vez de deixar um teste falso-verde ou
 * quebrado.
 *
 * jsdom também não mede `scrollHeight`/`clientHeight` reais (ambos vêm `0`
 * para todo elemento, sempre) — uma asserção `scrollHeight <= clientHeight +
 * 1` passaria com `0 <= 1` mesmo se `Coluna` fosse revertida para `display:
 * block` amanhã, verde que não prova nada.
 *
 * A prova real e honesta neste ambiente é ESTRUTURAL, não computada: a
 * CÉLULA (elemento retornado por `Coluna`) carrega as classes Tailwind
 * corretas no atributo `class` (`overflow-hidden`, `min-h-0`, `min-w-0`,
 * `flex`, `flex-col`) e é o PAI IMEDIATO do conteúdo — sem nenhum wrapper
 * `display:block` entre os dois, que era a FORMA exata do defeito original
 * (`<div className="min-h-0">` sem `flex`). Confiar que essas classes really
 * produzem a geometria certa é responsabilidade do Tailwind (testado por
 * quem mantém o framework) — o que este teste prende é que `Coluna` nunca
 * pare de aplicá-las.
 *
 * A prova de CONTENÇÃO visual de verdade (200 segmentos não vazando por cima
 * do rodapé, medida em pixel) é de screenshot/E2E, fora do escopo de um
 * teste de componente em jsdom — não fingir aqui que se mediu isso.
 */

describe("Coluna", () => {
  it("aplica as 5 classes de contenção (flex, flex-col, overflow-hidden, min-h-0, min-w-0) na célula", () => {
    const { container } = montar(
      <Coluna>
        <div data-testid="conteudo">conteúdo qualquer</div>
      </Coluna>,
    );

    const celula = container.firstElementChild as HTMLElement;
    expect(celula).toBeTruthy();
    // As 5 classes que fazem `Coluna` diferente do antigo `<div className="min-h-0">`
    // (que só tinha `min-h-0`, sem `flex` — o `flex-1` do filho ficava inerte).
    for (const classe of ["flex", "flex-col", "overflow-hidden", "min-h-0", "min-w-0"]) {
      expect(celula.className.split(/\s+/)).toContain(classe);
    }
  });

  it("não introduz nenhum wrapper 'display: block' entre a célula e o conteúdo — é o próprio conteúdo, direto", () => {
    const { getByTestId } = montar(
      <Coluna>
        <div data-testid="filho">x</div>
      </Coluna>,
    );
    const filho = getByTestId("filho");
    // `Coluna` é o PAI IMEDIATO do filho — nenhum `<div>` intermediário sem
    // classe (que nasceria `display: block` por default) entre os dois, que
    // era exatamente a forma do defeito original.
    expect(filho.parentElement?.className).toContain("overflow-hidden");
  });

  it("aceita className extra (ex.: gap-2 da COL 1) sem perder a trava de contenção", () => {
    const { container } = montar(<Coluna className="gap-2" data-testid="col" />);
    const celula = container.firstElementChild as HTMLElement;
    expect(celula.className).toContain("gap-2");
    expect(celula.className).toContain("overflow-hidden");
    expect(celula.className).toContain("min-h-0");
    expect(celula.className).toContain("min-w-0");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <Coluna>
        <p>conteúdo</p>
      </Coluna>,
    );
    await semViolacoes(container);
  });

  // ---------------------------------------------------------------------
  // F3 (17/09) — `rolavel`: achado do dono ("duplo scroll" — `BlocoFaleAgora`
  // tinha `max-h`/`overflow-y-auto` PRÓPRIO dentro da célula que já cortava
  // com `overflow-hidden`). `rolavel=true` faz a CÉLULA virar a única
  // superfície de rolagem (WCAG 2.1.1: `role="region"` + `tabIndex`).
  // ---------------------------------------------------------------------

  it("F3 — rolavel=false (default) mantém overflow-hidden, sem role/tabIndex de rolagem", () => {
    const { container } = montar(<Coluna data-testid="col" />);
    const celula = container.firstElementChild as HTMLElement;
    expect(celula.className).toContain("overflow-hidden");
    expect(celula.className).not.toContain("overflow-y-auto");
    expect(celula.getAttribute("role")).toBeNull();
    expect(celula.getAttribute("tabindex")).toBeNull();
  });

  it("F3 — rolavel=true troca overflow-hidden por overflow-y-auto e ganha role=region + tabIndex (WCAG 2.1.1)", () => {
    const { container } = montar(<Coluna rolavel rotulo="Fale agora" />);
    const celula = container.firstElementChild as HTMLElement;
    expect(celula.className).toContain("overflow-y-auto");
    expect(celula.className).not.toContain("overflow-hidden");
    expect(celula.getAttribute("role")).toBe("region");
    expect(celula.getAttribute("tabindex")).toBe("0");
    expect(celula.getAttribute("aria-label")).toBeTruthy();
  });

  // 🔴 Fable, 17/09 — `rotulo` era `aria-label="Fale agora"` hardcodado
  // dentro de `Coluna` (célula GENÉRICA das 3 colunas do mosaico). Agora é
  // prop explícita, obrigatória (tipo) quando `rolavel`: este teste prende
  // que o rótulo vem do CHAMADOR, não de um valor fixo do componente.
  it("F3 — aria-label vem de `rotulo`, não de um valor fixo do componente", () => {
    const { container } = montar(<Coluna rolavel rotulo="Cuidado" />);
    const celula = container.firstElementChild as HTMLElement;
    expect(celula.getAttribute("aria-label")).toBe("Cuidado");
  });

  it("F3 — rolavel=true não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <Coluna rolavel rotulo="Fale agora">
        <p>conteúdo rolável</p>
      </Coluna>,
    );
    await semViolacoes(container);
  });
});
