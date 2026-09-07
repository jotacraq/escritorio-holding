// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "./a11y-teste";
import { Tabela, type ColunaTabela } from "./Tabela";

interface Linha {
  id: string;
  nome: string;
  situacao: string;
  valor: string;
}

const LINHAS: Linha[] = [
  { id: "a", nome: "Família Andrade", situacao: "Pago", valor: "R$ 7.200,00" },
  { id: "b", nome: "Família Bueno", situacao: "Boleto gerado", valor: "R$ 4.500,00" },
];

const COLUNAS: ColunaTabela<Linha>[] = [
  { chave: "nome", cabecalho: "Cliente", celula: (l) => l.nome },
  { chave: "situacao", cabecalho: "Situação", celula: (l) => l.situacao },
  { chave: "valor", cabecalho: "Valor", numerica: true, celula: (l) => l.valor },
];

describe("Tabela", () => {
  it("declara o que lista — tabela sem legenda é grade anônima", () => {
    const { container } = montar(
      <Tabela legenda="Compras do processo" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} />,
    );
    expect(container.querySelector("caption")?.textContent).toBe("Compras do processo");
  });

  it("todo cabeçalho tem `scope` — é o que faz o leitor de tela dizer 'Situação: Pago'", () => {
    const { container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} />,
    );
    const ths = [...container.querySelectorAll("th")];
    expect(ths).toHaveLength(3);
    expect(ths.every((th) => th.getAttribute("scope") === "col")).toBe(true);
  });

  it("desenha as DUAS formas a partir de uma fonte só: grade e cartões", () => {
    const { container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    // O mesmo rótulo de coluna vira o rótulo do par no cartão: desktop e
    // celular não podem chamar a mesma coisa por nomes diferentes.
    const rotulosDoCartao = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(rotulosDoCartao).toContain("Situação");
    expect(rotulosDoCartao).toContain("Valor");
  });

  it("com `hrefDaLinha`, cada linha tem UM ponto de Tab, não a linha inteira clicável", () => {
    const { container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} hrefDaLinha={(l) => `/clientes/${l.id}`} />,
    );
    const links = [...container.querySelectorAll("a")];
    // 2 na grade + 2 nos cartões (as duas formas coexistem no DOM; o CSS mostra uma).
    expect(links).toHaveLength(4);
    expect(links.every((a) => a.getAttribute("href")?.startsWith("/clientes/"))).toBe(true);
  });

  it("lista vazia mostra o estado vazio de quem chamou, nunca uma grade piscando", () => {
    const { getByText, container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={[]} chaveDaLinha={(l) => l.id} vazio={<p>Nenhuma compra registrada.</p>} />,
    );
    expect(getByText("Nenhuma compra registrada.")).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });

  it("carregando mostra esqueleto", () => {
    const { container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={[]} chaveDaLinha={(l) => l.id} carregando />,
    );
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("`acoes` desenha as mesmas ações nos dois lugares: coluna na grade, rodapé no cartão", () => {
    const { container } = montar(
      <Tabela
        legenda="Compras"
        colunas={COLUNAS}
        linhas={LINHAS}
        chaveDaLinha={(l) => l.id}
        acoes={(l) => <button type="button">Reprocessar {l.nome}</button>}
      />,
    );
    // grade: uma coluna a mais que `COLUNAS`, com cabeçalho só para leitor de tela
    const ths = [...container.querySelectorAll("thead th")];
    expect(ths).toHaveLength(COLUNAS.length + 1);
    expect(ths.at(-1)?.textContent).toBe("Ações");
    expect(ths.at(-1)?.querySelector(".sr-only")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr td:last-child button")).toHaveLength(2);
    // cartão: as mesmas ações, no rodapé
    expect(container.querySelectorAll("ul > li button")).toHaveLength(2);
  });

  it("sem `acoes` não existe coluna vazia sobrando na grade", () => {
    const { container } = montar(
      <Tabela legenda="Compras" colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} />,
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(COLUNAS.length);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <Tabela
        legenda="Compras do processo"
        colunas={COLUNAS}
        linhas={LINHAS}
        chaveDaLinha={(l) => l.id}
        hrefDaLinha={(l) => `/clientes/${l.id}`}
        acoes={(l) => <button type="button">Reprocessar {l.nome}</button>}
      />,
    );
    await semViolacoes(container);
  });
});
