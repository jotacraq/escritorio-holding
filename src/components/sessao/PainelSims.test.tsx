// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { PainelSims } from "@/components/sessao/PainelSims";
import type { EstadoSims } from "@/components/sessao/api";
import type { RoteiroVersao } from "@/types/roteiro";

/**
 * Tarefa 1 (pedido do dono, 15/09): o `<details>` do 1º SIM (Sigilo e
 * Gravação) continua aberto por padrão — é requisito de condução, a
 * advogada precisa ler o texto em voz alta antes de registrar. O que este
 * teste trava é o TETO: o `<blockquote>` ganha `max-h-32 overflow-y-auto`
 * (a fala do roteiro v4 chega a 4.274 caracteres, medido em
 * `BlocoRoteiro.tsx:8-20`) e, por ser um container com rolagem própria,
 * precisa de `tabIndex={0}` + rótulo acessível para não cair na regra do
 * axe `scrollable-region-focusable` — mesmo padrão de `TabelaCroqui.tsx`.
 */

const FALA_LONGA = "x".repeat(4274);

const ROTEIRO: RoteiroVersao = {
  id: "r1",
  chave: "sessao_viabilidade",
  versao: 4,
  titulo: "Script padrão",
  ativo: true,
  notas: null,
  criado_em: "2026-01-01T00:00:00Z",
  criado_por: null,
  definicao: {
    blocos: [
      {
        id: "b1",
        titulo: "PARTE 01 — Os 4 SIMs",
        objetivo: null,
        acao: null,
        falas: [
          { id: "f1", locutor: null, texto: FALA_LONGA, sim: "sigilo_gravacao" },
          { id: "f2", locutor: null, texto: "Fala curta da licitude.", sim: "licitude" },
          { id: "f3", locutor: null, texto: "Fala curta dos decisores.", sim: "decisores" },
          { id: "f4", locutor: null, texto: "Fala curta do próximo passo.", sim: "proximo_passo" },
        ],
        campos: [],
        observar: [],
        proibido: [],
      },
    ],
  },
};

const SIMS_VAZIOS: EstadoSims = { roteiro_versao_id: "r1", sims: {}, sigilo_gravacao: null };

function propsBase() {
  return {
    roteiro: ROTEIRO,
    sessaoId: "s1",
    estado: SIMS_VAZIOS,
    aoAtualizar: () => {},
  };
}

describe("PainelSims — teto no texto de consentimento (Tarefa 1, 15/09)", () => {
  it("o blockquote do 1º SIM continua visível por padrão (details aberto)", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote).toBeTruthy();
    expect(blockquote?.textContent).toContain("x");
  });

  it("o blockquote tem teto de altura com rolagem interna, não a parede inteira", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.className).toContain("max-h-32");
    expect(blockquote?.className).toContain("overflow-y-auto");
  });

  it("o container rolável é alcançável por teclado (axe: scrollable-region-focusable)", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.getAttribute("tabindex")).toBe("0");
    expect(blockquote?.getAttribute("aria-label")).toBeTruthy();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    await semViolacoes(container);
  });
});

/**
 * Faixa horizontal abaixo de `xl` (pedido do dono, 15/09, 2ª rodada): os 4
 * SIMs saem da coluna lateral de 260px e viram uma faixa de largura cheia,
 * só por CSS — é a MESMA instância de `PainelSims`/`<ul>`/`<li>`, cujas
 * classes mudam por breakpoint (`grid` abaixo de `xl`, `flex flex-col` em
 * `xl`+). Nunca duas árvores, uma escondida: isso duplicaria conteúdo para
 * leitor de tela (falha de axe) e mascararia o teste de `offsetParent`
 * (um SIM "visível" dentro de um container oculto dá verde falso).
 */
describe("PainelSims — faixa horizontal abaixo de xl, sem duplicar DOM (15/09, 2ª rodada)", () => {
  it("cada um dos 4 SIMs aparece exatamente uma vez no DOM", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const itens = container.querySelectorAll("ul > li");
    expect(itens).toHaveLength(4);
    expect(container.querySelectorAll('[aria-label="Texto de consentimento apresentado ao cliente"]')).toHaveLength(1);
  });

  it("a ordem de leitura no DOM é 1-2-3-4 (Sigilo, Licitude, Decisores, Próximo passo)", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const rotulos = Array.from(container.querySelectorAll("ul > li")).map((li) => li.textContent ?? "");
    expect(rotulos[0]).toContain("Sigilo e Gravação");
    expect(rotulos[1]).toContain("Ética e Licitude");
    expect(rotulos[2]).toContain("Presença dos Decisores");
    expect(rotulos[3]).toContain("O Próximo Passo");
  });

  it("nenhum item usa CSS `order` para se mover — DOM e ordem visual não descasam", () => {
    const { container } = montar(<PainelSims {...propsBase()} />);
    const itens = container.querySelectorAll("ul > li");
    itens.forEach((li) => {
      expect((li as HTMLElement).className).not.toMatch(/(^|\s)order-/);
    });
  });
});
