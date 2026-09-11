// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { Ficha360 } from "@/lib/api";
import type { RoteiroVersao } from "@/types/roteiro";
import type { EstadoSims } from "@/components/sessao/api";

/**
 * C10 (docs/ARQUITETURA-FASE-10.md §9): a coluna direita de 320px era só do
 * briefing e passou a ser dividida com o copiloto por abas. Este arquivo
 * trava as duas garantias que o plano exige:
 *
 *  1. Briefing é a aba default — quem abre a tela vê o briefing sem clicar
 *     em nada, exatamente como hoje.
 *  2. A aba Copiloto existe, é alcançável por teclado (`role=tab`) e troca o
 *     painel visível sem recarregar a página.
 *
 * U1 (herdado da Fase 3, `ConduzirSessaoApp.tsx:234-247`) não é testável por
 * jsdom (layout real não é calculado) — o teste que prova U1 é
 * `scripts/a11y.mjs` a 1366×768 e a inspeção visual. O que ESTE arquivo prova
 * é que a estrutura continua sendo grid de 2 colunas com o roteiro na coluna
 * PRINCIPAL (não dentro das abas), que é a pré-condição de U1: o roteiro
 * nunca fica hospedado dentro do componente de abas.
 *
 * `PainelBriefingSessao`/`PainelCopiloto`/`PainelSims`/`PainelOferta`/
 * `BlocoRoteiro`/`BarraProgresso` são dublês: cada um já tem teste próprio
 * (ou, no caso de PainelCopiloto, o teste ao lado deste arquivo) — aqui o que
 * se testa é COMPOSIÇÃO, não o conteúdo de cada painel.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    ficha: null as Ficha360 | null,
    roteiro: null as RoteiroVersao | null,
    sims: null as EstadoSims | null,
  },
}));

vi.mock("@/lib/api", () => ({
  buscarFicha360: () => Promise.resolve(estado.ficha),
}));

vi.mock("@/components/sessao/api", async () => {
  const real = await vi.importActual<typeof import("@/components/sessao/api")>("@/components/sessao/api");
  return {
    ...real,
    buscarRoteiroAtivo: () => Promise.resolve(estado.roteiro),
    buscarSims: () => Promise.resolve(estado.sims),
    listarOfertas: () => Promise.resolve({ itens: [], preco: null }),
  };
});

vi.mock("@/components/briefing/PainelBriefingSessao", () => ({
  PainelBriefingSessao: () => <div data-testid="stub-briefing">Briefing Estratégico (stub)</div>,
}));

// `vi.fn()` (não uma arrow function fixa): permite trocar a implementação
// por teste (`mockImplementationOnce`) sem um segundo `vi.mock` concorrente
// para o mesmo módulo — dois `vi.mock` do mesmo caminho no mesmo arquivo são
// hoisted e o ÚLTIMO silenciosamente vence em TODOS os testes do arquivo,
// mascarando qual mock está de fato ativo.
function stubCopilotoPadrao() {
  return <div data-testid="stub-copiloto">Copiloto (stub)</div>;
}
const mockPainelCopiloto = vi.fn(stubCopilotoPadrao);
vi.mock("@/components/sessao/PainelCopiloto", () => ({
  PainelCopiloto: () => mockPainelCopiloto(),
}));

const { ConduzirSessaoApp } = await import("./ConduzirSessaoApp");

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
      { id: "b0", titulo: "PARTE 00 — Abertura", objetivo: null, acao: null, falas: [], campos: [], observar: [], proibido: [] },
      { id: "b1", titulo: "PARTE 01 — Os 4 SIMs", objetivo: null, acao: null, falas: [], campos: [], observar: [], proibido: [] },
    ],
  },
};

const SIMS_VAZIOS: EstadoSims = { roteiro_versao_id: "r1", sims: {}, sigilo_gravacao: null };

const FICHA = {
  jornada: { id: "j1" },
  pessoa: { id: "p1", nome: "Maria Teste" },
  briefingAtual: null,
  sessao: { id: "s1", jornada_id: "j1" },
  agendamentos: [],
} as unknown as Ficha360;

async function abrir() {
  const montado = montar(<ConduzirSessaoApp jornadaId="j1" />);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return montado;
}

beforeEach(() => {
  estado.ficha = FICHA;
  estado.roteiro = ROTEIRO;
  estado.sims = SIMS_VAZIOS;
  mockPainelCopiloto.mockClear();
  mockPainelCopiloto.mockImplementation(stubCopilotoPadrao);
  try {
    window.sessionStorage.clear();
  } catch {
    /* jsdom sempre tem sessionStorage */
  }
});

describe("ConduzirSessaoApp — abas da coluna direita (C10)", () => {
  it("o briefing é a aba default: aparece sem nenhum clique", async () => {
    const { container } = await abrir();
    expect(container.querySelector('[data-testid="stub-briefing"]')).toBeTruthy();
  });

  it("a aba Copiloto existe e é navegável por role=tab", async () => {
    const { container, getByRole } = await abrir();
    const abaCopiloto = getByRole("tab", { name: /copiloto/i });
    expect(abaCopiloto).toBeTruthy();
    expect(abaCopiloto.getAttribute("aria-selected")).toBe("false");

    const abaBriefing = getByRole("tab", { name: /briefing/i });
    expect(abaBriefing.getAttribute("aria-selected")).toBe("true");

    abaCopiloto.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    // Checa o TEXTO do stub (não só o data-testid): garante que este teste
    // está de fato exercitando a implementação default do mock, e não uma
    // implementação trocada por outro teste do arquivo.
    expect(container.querySelector('[data-testid="stub-copiloto"]')?.textContent).toBe("Copiloto (stub)");
  });

  it("a coluna de abas fica ao LADO do roteiro, não hospeda o roteiro (pré-condição de U1)", async () => {
    const { getAllByRole, container } = await abrir();
    // O roteiro (barra de progresso) vive fora dos `tabpanel` — nunca dentro
    // de uma aba, senão ficaria oculto quando a aba Copiloto for aberta.
    const barraProgresso = container.querySelector('nav[aria-label="Partes da Sessão de Viabilidade"]');
    expect(barraProgresso).toBeTruthy();
    const tabpanels = getAllByRole("tabpanel", { hidden: true });
    expect(tabpanels.length).toBeGreaterThan(0);
    for (const painel of tabpanels) expect(painel.contains(barraProgresso)).toBe(false);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir();
    await semViolacoes(container);
  });
});

/**
 * Kill-switch (`copiloto_sessao.ativo=false`) — achado do Fable: a aba nunca
 * pode sumir só porque o recurso está desligado por configuração, senão a
 * Dra. Elaine não distingue "não implementado" de "desligado agora". O
 * comportamento INTERNO do estado desligado (EstadoVazio, sem "tentar de
 * novo") é coberto em `PainelCopiloto.test.tsx`; aqui o que se prova é que a
 * COMPOSIÇÃO — a aba em si, no `tablist`, e o `PainelCopiloto` sendo
 * montado dentro dela — não muda com o estado interno do copiloto.
 *
 * `mockImplementationOnce` no `mockPainelCopiloto` já declarado (não um 2º
 * `vi.mock` do mesmo caminho — dois mocks estáticos do mesmo módulo no
 * mesmo arquivo são hoisted e o último vence silenciosamente em TODOS os
 * testes do arquivo, mascarando qual mock está de fato ativo em cada um).
 */
describe("ConduzirSessaoApp — aba Copiloto continua montada com o copiloto desligado", () => {
  it("a aba Copiloto aparece no tablist e o painel é montado, mesmo representando o estado desligado", async () => {
    mockPainelCopiloto.mockImplementation(() => (
      <div data-testid="stub-copiloto">Copiloto desligado (stub do estado real)</div>
    ));

    const { getByRole, container } = await abrir();
    const abaCopiloto = getByRole("tab", { name: /copiloto/i });
    expect(abaCopiloto).toBeTruthy();

    abaCopiloto.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    // A aba não sumiu, e o painel (ainda que representando "desligado") foi
    // montado dentro dela — nunca a ausência silenciosa da aba inteira.
    expect(getByRole("tab", { name: /copiloto/i })).toBeTruthy();
    expect(container.querySelector('[data-testid="stub-copiloto"]')).toBeTruthy();
    expect(container.textContent).toContain("Copiloto desligado");
  });
});
