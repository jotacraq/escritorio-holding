import { cleanup, render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, expect } from "vitest";
import type { ReactElement } from "react";

/**
 * Apoio dos testes de acessibilidade de COMPONENTE (Fase 8, camada 2 de 3).
 *
 * Arquivo de teste, não de produção: nada em `src/app` ou `src/components`
 * importa daqui, então ele não entra em bundle nenhum. Fica ao lado dos
 * componentes de propósito — o teste de um componente mora junto dele.
 *
 * Uso, no topo de todo `*.test.tsx` (o docblock é o que troca o ambiente do
 * arquivo para `jsdom`; ver `vitest.config.ts`):
 *
 * ```tsx
 * // @vitest-environment jsdom
 * import { montar, semViolacoes } from "./a11y-teste";
 *
 * it("não tem violação de acessibilidade", async () => {
 *   const { container } = montar(<SeloEstado dominio="croqui" estado="pronto" />);
 *   await semViolacoes(container);
 * });
 * ```
 *
 * **O que este teste NÃO prova.** O axe-core encontra por volta de um terço
 * dos problemas reais de acessibilidade, e em componente isolado enxerga menos
 * ainda: contraste ele só mede quando a cor está resolvida no DOM (aqui os
 * tokens do `globals.css` não estão carregados), e ordem de foco/sobreposição
 * dependem da página inteira. Verde aqui é piso, não prova — a prova de tela é
 * `scripts/a11y.mjs` mais o teclado e o grayscale à mão.
 */

afterEach(() => {
  cleanup();
});

/** Monta o componente em jsdom. Fina camada sobre `render`, para o teste ler curto. */
export function montar(elemento: ReactElement) {
  return render(elemento);
}

/**
 * Roda o axe-core e falha listando as violações pelo nome.
 *
 * A comparação é `["regra: explicação", …]` contra `[]` em vez do matcher
 * `toHaveNoViolations` do `vitest-axe`: a tipagem que aquele pacote publica
 * ainda estende o namespace `Vi` do Vitest 1, e no Vitest 3 ela não pega — o
 * `tsc` reprova. Assim o teste não depende de tipagem de terceiro e a falha
 * fica mais legível ("esperava [] e veio ['label: Form elements must have
 * labels']"), que é o que se lê às 2 da manhã.
 *
 * `color-contrast` fica desligado aqui, e é decisão consciente: em jsdom não
 * há folha de estilo aplicada, então a regra ou não roda ou acusa falso
 * positivo em cima de "preto sobre transparente". O contraste desta base é
 * medido de outro jeito — varredura do DOM real com as cores COMPUTADAS pelo
 * navegador (DS §6) e os números do §12, calculados na fórmula WCAG.
 */
export async function semViolacoes(container: Element) {
  const resultado = await axe(container, { rules: { "color-contrast": { enabled: false } } });
  expect(resultado.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}
