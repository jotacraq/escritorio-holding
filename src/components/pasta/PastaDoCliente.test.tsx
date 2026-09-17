// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { ItemPasta } from "@/lib/pasta/derivar";
import { PastaDoCliente } from "./PastaDoCliente";

/**
 * T3/T4 (16/09/2026) — `LinhaAindaNao` trocou N cartões-fantasma tracejados
 * por uma linha de texto ("N itens ainda não — Rótulo, Rótulo…"), com a nota
 * de cada item no `title`. Nada some do DOM: é a MESMA lista, só sem cartão.
 */

function item(parcial: Partial<ItemPasta> & Pick<ItemPasta, "chave" | "rotulo">): ItemPasta {
  return { procedencia: "produzido", estado: "ainda_nao", dono: "equipe", ...parcial };
}

describe("PastaDoCliente — LinhaAindaNao", () => {
  it("lista os N itens 'ainda não' numa linha, com a nota de cada um no title", () => {
    // `formulario` e `ligacao` são os dois itens de `SESSAO_POR_ITEM` na
    // sessão "viabilidade" (`lib/pasta/catalogo.ts`) — precisam estar no
    // MESMO grupo para renderizarem juntos no mesmo `<details>`.
    const itens: ItemPasta[] = [
      item({ chave: "formulario", rotulo: "Formulário", nota: "Depende da sessão acontecer" }),
      item({ chave: "ligacao", rotulo: "Contato", nota: "Depende do croqui iniciar" }),
    ];
    const { getByText } = montar(<PastaDoCliente itens={itens} aoAbrirGaveta={vi.fn()} sessaoAtual="viabilidade" />);

    const linha = getByText(/2 itens ainda não/);
    expect(linha.textContent).toContain("Formulário");
    expect(linha.textContent).toContain("Contato");

    // O item e a vírgula separadora dividem o mesmo `<span title>` (ver
    // `LinhaAindaNao`) — o texto do nó é "Formulário, ", não só o rótulo.
    const rotuloFormulario = getByText((_conteudo, elemento) => elemento?.tagName === "SPAN" && elemento.textContent === "Formulário, ");
    expect(rotuloFormulario.getAttribute("title")).toBe("Depende da sessão acontecer");
  });

  it("singular: '1 item ainda não'", () => {
    const itens: ItemPasta[] = [item({ chave: "formulario", rotulo: "Formulário", nota: "Depende da sessão acontecer" })];
    const { getByText } = montar(<PastaDoCliente itens={itens} aoAbrirGaveta={vi.fn()} sessaoAtual="viabilidade" />);
    expect(getByText(/1 item ainda não/)).toBeTruthy();
  });

  it("nenhum item 'ainda não' — a linha não aparece", () => {
    const itens: ItemPasta[] = [item({ chave: "formulario", rotulo: "Formulário", estado: "pronto", nota: undefined })];
    const { queryByText } = montar(<PastaDoCliente itens={itens} aoAbrirGaveta={vi.fn()} sessaoAtual="viabilidade" />);
    expect(queryByText(/ainda não/)).toBeNull();
  });

  it("não tem violação de acessibilidade", async () => {
    const itens: ItemPasta[] = [
      item({ chave: "ligacao", rotulo: "Contato", nota: "Depende da sessão acontecer" }),
      item({ chave: "formulario", rotulo: "Formulário", estado: "pronto", nota: undefined }),
    ];
    const { container } = montar(<PastaDoCliente itens={itens} aoAbrirGaveta={vi.fn()} sessaoAtual="viabilidade" />);
    await semViolacoes(container);
  });
});
