// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { ItemFichaParaPainel } from "@/types/copiloto";
import { FichaCliente } from "./FichaCliente";

/**
 * Fase 12, F1 (18/09/2026) — prova de GEOMETRIA MEDIDA, não estimada.
 *
 * jsdom NÃO calcula layout real: `getBoundingClientRect()`/`clientHeight`
 * sempre devolvem `0` para todo elemento, sempre, não importa a classe
 * aplicada (mesma ressalva já registrada em `Coluna.test.tsx`). Para provar
 * a LÓGICA de recorte (não a geometria do navegador, que só o olho real
 * confirma), estes testes MOCKAM `getBoundingClientRect`/`clientHeight` com
 * os valores que o plano cita como medidos (768p, escala 18px: 566px
 * disponíveis contra ~118px por item de 5 itens = ~590px) — o componente é
 * exercitado com números de verdade, só a MEDIÇÃO do navegador é simulada.
 *
 * Prova por `offsetParent` (nunca por `e.hidden`): um filho "visível" dentro
 * de um pai `display:none` daria verde falso — `offsetParent` é `null`
 * quando o elemento (ou um ancestral) não está renderizado no fluxo visual.
 *
 * `ResizeObserver` não existe no ambiente jsdom desta suíte (sem
 * `setupFiles` global que o exponha) — mock mínimo local, só o suficiente
 * para o `useLayoutEffect` de `FichaCliente` poder registrar/desregistrar
 * sem lançar `ReferenceError`. A maioria dos testes chama `medir()`
 * indiretamente via a 1ª execução síncrona dentro do `useLayoutEffect`
 * (que já roda com a geometria mockada abaixo) e nunca precisa de um
 * disparo de resize de verdade.
 *
 * F-3 (18/09, Fable rodada 2 — catraca que só descia): o teste do ciclo
 * encolher→crescer PRECISA de um resize real (mudar a geometria mockada
 * sozinha não reexecuta `medir()` — as deps do efeito são `itens.length`/
 * `teto`/`podeTerRegua`, nunca a geometria). `dispararResizeGlobal()`
 * chama o callback de TODAS as instâncias observadas — suficiente aqui
 * porque cada teste monta só uma `FichaCliente` por vez.
 */
const callbacksResize: ResizeObserverCallback[] = [];
class ResizeObserverMock {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    callbacksResize.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

function dispararResizeGlobal() {
  // `entries`/`observer` não são lidos por `FichaCliente::medir` (ele lê
  // as refs próprias) — array vazio e `this` bastam para o contrato do tipo.
  for (const callback of callbacksResize) callback([], {} as ResizeObserver);
}

function itens(n: number, categoria: ItemFichaParaPainel["categoria"] = "objecao"): ItemFichaParaPainel[] {
  return Array.from({ length: n }, (_, i) => ({
    categoria,
    texto: `Item ${i}`,
    evidencia: `Evidência literal do item ${i}`,
    n: 1,
    ultima_mencao_em: new Date(2026, 8, 18, 10, i).toISOString(),
  }));
}

/**
 * Mocka a altura do container RAIZ (`clientHeight`) e de cada item fixo
 * (`getBoundingClientRect().height`) — é exatamente o par que
 * `FichaCliente::medir` consome. `alturaItemPx` uniforme simplifica a conta
 * (todos os itens de teste têm o mesmo texto/tamanho).
 */
function mockarGeometria({ alturaRaizPx, alturaItemPx }: { alturaRaizPx: number; alturaItemPx: number }) {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      // Só a raiz da Ficha (identificada pelo próprio papel de "flex-1
      // min-h-0" único nesta árvore) precisa de um valor não-zero — os
      // demais elementos (itens, régua) usam getBoundingClientRect, não
      // clientHeight, então devolver o mesmo valor para todos é inofensivo:
      // ninguém mais lê `clientHeight` neste componente.
      return alturaRaizPx;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      // A régua (`<p aria-hidden>`) é rasa — usa uma fração da altura de
      // item para não distorcer a conta do teste (jsdom não mede de
      // verdade; aqui é só o número que o teste decide).
      const ehRegua = this.getAttribute("aria-hidden") === "true" && this.textContent?.includes("mais");
      return { height: ehRegua ? 20 : alturaItemPx, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    },
  });
}

function restaurarGeometria() {
  // @ts-expect-error -- remove o mock, volta ao comportamento jsdom padrão (0)
  delete HTMLElement.prototype.clientHeight;
  // @ts-expect-error -- idem
  delete HTMLElement.prototype.getBoundingClientRect;
}

afterEach(() => {
  restaurarGeometria();
  callbacksResize.length = 0;
});

describe("FichaCliente — vazio e piso", () => {
  it("sem nenhum item: mensagem sóbria, sem área fixa nem rolável no DOM", () => {
    const { container, queryByRole } = montar(<FichaCliente itens={[]} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("Nenhum fato relevante identificado ainda nesta sessão.");
    expect(queryByRole("region")).toBeNull();
  });

  it("PISO: com espaço só para 1 item (raiz rasa), a área fixa mostra exatamente 1 — nunca 0, nunca a lista inteira despejada", async () => {
    mockarGeometria({ alturaRaizPx: 50, alturaItemPx: 200 }); // 1 item já estoura sozinho
    const { container } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});

    const cardsFixos = container.querySelectorAll('[style*="border-left-color"]');
    // 1 fixo + os 4 restantes na rolável = 5 cards no total, mas só 1 deles
    // é o primeiro elemento do container "raiz" (fixo) — a prova real é a
    // contagem da régua abaixo.
    expect(cardsFixos.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("── mais 4 · role para ver ──");
  });

  it("teto 0 (sessão encerrada): a área fixa inteira SOME do DOM — precedente BlocoCuidado, nunca um card vazio", async () => {
    mockarGeometria({ alturaRaizPx: 1000, alturaItemPx: 50 });
    const { container } = montar(<FichaCliente itens={itens(3)} sessaoEncerrada />);
    await act(async () => {});

    // Pós-sessão: sem teto de fixos, TUDO rolável — nenhum card deveria estar
    // fora da região rolável (offsetParent não é útil aqui porque jsdom não
    // calcula layout, mas a REGIÃO rolável é que carrega os 3 itens).
    const regiao = container.querySelector('[role="region"]');
    expect(regiao).not.toBeNull();
    expect(regiao!.textContent).toContain("Item 0");
    expect(regiao!.textContent).toContain("Item 2");
    // D-5: o nome "Ficha do cliente" agora é o rótulo da ABA (`AbasColuna3`);
    // aqui sobrevive só o que a aba não diz — que a sessão acabou.
    expect(container.textContent).toContain("Sessão encerrada");
    expect(container.textContent).not.toContain("Ficha do cliente");
  });
});

describe("FichaCliente — recorte medido (768p, escala 18px — exemplo citado no plano)", () => {
  it("768p × 18px: espaço para 4 itens inteiros, o 5º vai para a rolável com contador — NÃO é bug", async () => {
    // Medida citada no plano: ~566px disponíveis, 5 itens de ~118px cada
    // exigiriam ~590px — só 4 cabem sem cortar linha.
    mockarGeometria({ alturaRaizPx: 566, alturaItemPx: 118 });
    const { container } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});

    expect(container.textContent).toContain("── mais 1 · role para ver ──");
  });

  it("1080p (espaço amplo): os 5 itens cabem todos na área fixa, sem régua nem rolável", async () => {
    mockarGeometria({ alturaRaizPx: 2000, alturaItemPx: 118 });
    const { container, queryByRole } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});

    expect(container.textContent).not.toContain("role para ver");
    expect(queryByRole("region")).toBeNull();
  });

  it("768p × 14px (itens mais baixos): os 5 cabem — o recorte reage à ALTURA REAL, não a um número fixo de itens", async () => {
    mockarGeometria({ alturaRaizPx: 566, alturaItemPx: 90 });
    const { container } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});

    expect(container.textContent).not.toContain("role para ver");
  });
});

describe("FichaCliente — F-3 (Fable, rodada 2, 18/09): a catraca sobe de novo depois de encolher", () => {
  it("encolher (fonte grande) e depois crescer (fonte normal de volta) recupera os 5 fixos — antes ficava preso no mínimo já visto", async () => {
    // 1º: espaço generoso, os 5 itens cabem inteiros na área fixa.
    mockarGeometria({ alturaRaizPx: 2000, alturaItemPx: 118 });
    const { container, rerender } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});
    expect(container.textContent).not.toContain("role para ver");

    // 2º: "Tamanho do texto" sobe para Grande — cada item fica mais alto e
    // o mesmo espaço (rerender com a MESMA prop `itens`, só a geometria
    // mockada muda) só cabe 1 fixo. Sem disparar o resize, `medir()` nunca
    // reexecuta — as deps do efeito não incluem geometria.
    mockarGeometria({ alturaRaizPx: 200, alturaItemPx: 118 });
    rerender(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => dispararResizeGlobal());
    expect(container.textContent).toContain("── mais 4 · role para ver ──");

    // 3º — a PROVA do F-3: "Tamanho do texto" volta a Normal (o espaço
    // disponível volta a caber os 5). Antes da correção, `itemRefs` só
    // tinha entrada para o item[0] (o único montado como fixo no passo
    // anterior) — `medir()` dava `break` no item[1] (`undefined`) e
    // `cabeDeFato` ficava travado em 1 para sempre, mesmo com espaço de
    // sobra. Com o container-sombra (sempre monta até `efetivoOtimista`),
    // a medição consegue testar os 5 de novo.
    mockarGeometria({ alturaRaizPx: 2000, alturaItemPx: 118 });
    await act(async () => dispararResizeGlobal());
    expect(container.textContent).not.toContain("role para ver");
  });
});

describe("FichaCliente — hierarquia recebida, nunca reordenada", () => {
  it("não ordena nada — mantém a ordem exata em que os itens chegam (a ordenação é do servidor)", async () => {
    mockarGeometria({ alturaRaizPx: 2000, alturaItemPx: 50 });
    const lista: ItemFichaParaPainel[] = [
      { categoria: "objecao", texto: "Objeção X", evidencia: "e1", n: 1, ultima_mencao_em: new Date().toISOString() },
      { categoria: "dor", texto: "Dor Y", evidencia: "e2", n: 1, ultima_mencao_em: new Date().toISOString() },
      { categoria: "patrimonio", texto: "Imóvel Z", evidencia: "e3", n: 1, ultima_mencao_em: new Date().toISOString() },
    ];
    const { container } = montar(<FichaCliente itens={lista} sessaoEncerrada={false} />);
    await act(async () => {});

    const posObjecao = container.textContent!.indexOf("Objeção X");
    const posDor = container.textContent!.indexOf("Dor Y");
    const posPatrimonio = container.textContent!.indexOf("Imóvel Z");
    expect(posObjecao).toBeGreaterThanOrEqual(0);
    expect(posObjecao).toBeLessThan(posDor);
    expect(posDor).toBeLessThan(posPatrimonio);
  });

  it("cada categoria mostra o rótulo por extenso (cor nunca é o único portador) — grayscale-safe", async () => {
    mockarGeometria({ alturaRaizPx: 2000, alturaItemPx: 50 });
    const { container } = montar(<FichaCliente itens={itens(1, "objecao")} sessaoEncerrada={false} />);
    await act(async () => {});
    expect(container.textContent).toContain("Objeção");
  });
});

describe("FichaCliente — F3-1 (Fable, rodada 3, 18/09): a sombra de medição não pode herdar a largura da viewport", () => {
  it("o container-sombra tem `absolute inset-x-0`, e a raiz que o engloba tem `relative` — sem os dois, `absolute` mede na largura do 1º ancestral posicionado (viewport, se nenhum for `relative`)", async () => {
    mockarGeometria({ alturaRaizPx: 566, alturaItemPx: 118 });
    const { container } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});

    const sombra = container.querySelector('[aria-hidden="true"].absolute');
    expect(sombra).not.toBeNull();
    expect(sombra!.className).toContain("absolute");
    expect(sombra!.className).toContain("inset-x-0");

    // A raiz medida é o pai direto da sombra (`raizRef`, `flex-1 min-h-0`) —
    // é ELE quem precisa ser o ancestral posicionado mais próximo, senão o
    // `absolute` da sombra escapa para o próximo ancestral `relative`/
    // `fixed`/`absolute` (ou a viewport, se não houver nenhum).
    const raiz = sombra!.parentElement;
    expect(raiz).not.toBeNull();
    expect(raiz!.className).toContain("relative");
  });
});

describe("FichaCliente — a11y", () => {
  it("axe limpo: com itens fixos + rolável", async () => {
    mockarGeometria({ alturaRaizPx: 200, alturaItemPx: 118 });
    const { container } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});
    await semViolacoes(container);
  });

  it("axe limpo: vazio", async () => {
    const { container } = montar(<FichaCliente itens={[]} sessaoEncerrada={false} />);
    await semViolacoes(container);
  });

  it("região rolável tem role+label e é alcançável por teclado (tabIndex=0)", async () => {
    mockarGeometria({ alturaRaizPx: 200, alturaItemPx: 118 });
    const { getByRole } = montar(<FichaCliente itens={itens(5)} sessaoEncerrada={false} />);
    await act(async () => {});
    const regiao = getByRole("region");
    expect(regiao.getAttribute("tabindex")).toBe("0");
    expect(regiao.getAttribute("aria-label")).toMatch(/mais \d+ itens/i);
  });
});
