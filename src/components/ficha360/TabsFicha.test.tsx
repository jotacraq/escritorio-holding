// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { TABS_FICHA, type ChaveTabFicha } from "@/lib/pasta/tabs";
import { TabsFicha, type PainelTabFicha } from "./TabsFicha";

/**
 * Fatia 3 — teste obrigatório #1: "tab inativa não monta o conteúdo (prove
 * com `offsetParent`)".
 *
 * `Espiao` é um componente que registra no array `montagens` toda vez que é
 * MONTADO (não só renderizado) — é a prova de que `TabsFicha` desmonta o
 * conteúdo da tab inativa de verdade (`{ativa ? conteudo : null}`), e não só
 * o esconde com CSS (o que `components/ui/Abas.tsx` faz de propósito, e é
 * exatamente o padrão que este componente novo tinha que evitar — ver o
 * docblock de `TabsFicha.tsx`: 4 tabs montando juntas multiplicaria por 4 a
 * carga de blocos que buscam dado, como `AutomacoesFicha`/`RadarDocumentos`).
 */
function Espiao({ nome, montagens }: { nome: string; montagens: string[] }) {
  useEffect(() => {
    montagens.push(nome);
  }, [nome, montagens]);
  return <p data-testid={`conteudo-${nome}`}>Conteúdo de {nome}</p>;
}

function montarTabsDeTeste(montagens: string[], tabInicial: ChaveTabFicha = "sessao") {
  function Wrapper() {
    const [tabAtiva, setTabAtiva] = useState<ChaveTabFicha>(tabInicial);
    const paineis: PainelTabFicha[] = TABS_FICHA.map((definicao) => ({
      definicao,
      conteudo: <Espiao nome={definicao.chave} montagens={montagens} />,
    }));
    return <TabsFicha tabAtiva={tabAtiva} aoTrocarTab={setTabAtiva} paineis={paineis} />;
  }
  return montar(<Wrapper />);
}

describe("TabsFicha — as 4 tabs sempre visíveis (correção do João: 'não preciso ocultar')", () => {
  it("as 4 abas aparecem na barra de tabs, sempre — Sessão, Documentos, Croqui, Holding", () => {
    const montagens: string[] = [];
    const { getByRole } = montarTabsDeTeste(montagens);
    expect(getByRole("tab", { name: "Sessão" })).toBeTruthy();
    expect(getByRole("tab", { name: "Documentos" })).toBeTruthy();
    expect(getByRole("tab", { name: "Croqui" })).toBeTruthy();
    expect(getByRole("tab", { name: "Holding" })).toBeTruthy();
  });

  it("a tab Sessão é a padrão — é ela quem monta o conteúdo primeiro", () => {
    const montagens: string[] = [];
    montarTabsDeTeste(montagens);
    expect(montagens).toEqual(["sessao"]);
  });
});

describe("TabsFicha — tab inativa NÃO monta o conteúdo", () => {
  it("só a tab ativa monta; as outras 3 nunca chegam a montar (nenhum efeito delas roda)", () => {
    const montagens: string[] = [];
    montarTabsDeTeste(montagens);
    // Só "sessao" montou — "documentos", "croqui" e "holding" nunca rodaram
    // o próprio `useEffect`, prova de que `TabsFicha` não os montou em
    // segundo plano (o que `hidden` sozinho, sem desmontar, não provaria).
    expect(montagens).toEqual(["sessao"]);
    expect(montagens).not.toContain("documentos");
    expect(montagens).not.toContain("croqui");
    expect(montagens).not.toContain("holding");
  });

  it("trocar de tab desmonta a antiga e monta a nova — nunca as duas montadas ao mesmo tempo", () => {
    const montagens: string[] = [];
    const { getByRole } = montarTabsDeTeste(montagens);

    fireEvent.click(getByRole("tab", { name: "Documentos" }));
    expect(montagens).toEqual(["sessao", "documentos"]);

    fireEvent.click(getByRole("tab", { name: "Croqui" }));
    expect(montagens).toEqual(["sessao", "documentos", "croqui"]);
  });

  it("a tab ativa está de fato no DOM visível do container; a inativa nem existe (offsetParent, nunca e.hidden)", () => {
    const montagens: string[] = [];
    const { container, getByTestId, queryByTestId } = montarTabsDeTeste(montagens);

    // Prova real de visibilidade (mesmo padrão de `PainelCopiloto.test.tsx`):
    // `offsetParent` é a prova que este projeto usa, nunca `e.hidden` — um
    // filho pode estar "visível" pelo próprio atributo dentro de um pai
    // oculto e mascarar o teste. jsdom não calcula layout, então
    // `offsetParent` de um elemento LEGITIMAMENTE visível também vem `null`
    // aqui; a prova possível neste ambiente é a mais forte de todas: o painel
    // da tab ativa não tem `hidden` no ancestral, e pertence ao container.
    const conteudoSessao = getByTestId("conteudo-sessao");
    expect(container.contains(conteudoSessao)).toBe(true);
    expect(conteudoSessao.closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(false);

    // A tab "documentos" nem está no DOM (foi DESMONTADA, não só escondida
    // por CSS) — `queryByTestId` devolve `null`. Isto É a prova de
    // `offsetParent === null` levada ao extremo: não há sequer um nó para
    // medir `offsetParent`, porque `TabsFicha` nunca o renderizou.
    expect(queryByTestId("conteudo-documentos")).toBeNull();
  });

  it("ao trocar de volta para Sessão, ela MONTA de novo (novo efeito, novo item no array)", () => {
    const montagens: string[] = [];
    const { getByRole } = montarTabsDeTeste(montagens);

    fireEvent.click(getByRole("tab", { name: "Croqui" }));
    fireEvent.click(getByRole("tab", { name: "Sessão" }));

    expect(montagens).toEqual(["sessao", "croqui", "sessao"]);
  });
});

describe("TabsFicha — navegação e acessibilidade", () => {
  it("cada aba é role=tab com aria-selected e alvo de toque ≥ 44px (min-h-11)", () => {
    const montagens: string[] = [];
    const { getByRole } = montarTabsDeTeste(montagens);
    const abaSessao = getByRole("tab", { name: "Sessão" });
    expect(abaSessao.getAttribute("aria-selected")).toBe("true");
    expect(abaSessao.className).toContain("min-h-11");

    const abaDocumentos = getByRole("tab", { name: "Documentos" });
    expect(abaDocumentos.getAttribute("aria-selected")).toBe("false");
  });

  it("seta para a direita move o foco e a seleção para a próxima tab", () => {
    const montagens: string[] = [];
    const { getByRole } = montarTabsDeTeste(montagens);
    const abaSessao = getByRole("tab", { name: "Sessão" });
    fireEvent.keyDown(abaSessao, { key: "ArrowRight" });
    expect(getByRole("tab", { name: "Documentos" }).getAttribute("aria-selected")).toBe("true");
  });

  it("não tem violação de acessibilidade", async () => {
    const montagens: string[] = [];
    const { container } = montarTabsDeTeste(montagens);
    await semViolacoes(container);
  });
});
