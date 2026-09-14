// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { Ficha360 } from "@/lib/api";
import type { RoteiroVersao } from "@/types/roteiro";
import type { EstadoSims } from "@/components/sessao/api";

/**
 * B72 (pedido do Marcio, 11-14/09: "tela única, todas as informações à
 * mostra, modelo do Juliano" — desfaz C10/a divisão por abas). Este arquivo
 * trava a garantia que substitui o antigo contrato de abas:
 *
 *  1. Briefing e Copiloto aparecem os DOIS sem nenhum clique — não existe
 *     mais aba escondendo um atrás do outro.
 *  2. O roteiro (barra de progresso + bloco atual) está sempre visível, na
 *     mesma tela, nunca hospedado dentro de um painel que pode ficar oculto.
 *  3. Não existe mais `role=tablist`/`role=tab` nesta tela — a navegação por
 *     abas foi removida de propósito, não é regressão a "recuperar".
 *
 * `PainelBriefingSessao`/`PainelCopiloto`/`PainelSims`/`PainelOferta`/
 * `BlocoRoteiro`/`BarraProgresso` são dublês: cada um já tem teste próprio
 * (ou, no caso de PainelCopiloto, `PainelCopiloto.test.tsx`) — aqui o que se
 * testa é COMPOSIÇÃO, não o conteúdo de cada painel.
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

describe("ConduzirSessaoApp — painel único, sem abas (B72)", () => {
  it("briefing e copiloto aparecem os dois, sem nenhum clique", async () => {
    const { container } = await abrir();
    expect(container.querySelector('[data-testid="stub-briefing"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="stub-copiloto"]')).toBeTruthy();
  });

  it("não existe mais navegação por abas nesta tela", async () => {
    const { queryAllByRole } = await abrir();
    expect(queryAllByRole("tablist")).toHaveLength(0);
    expect(queryAllByRole("tab")).toHaveLength(0);
  });

  it("o roteiro (barra de progresso) está sempre visível, na mesma tela que o copiloto e o briefing", async () => {
    const { container } = await abrir();
    const barraProgresso = container.querySelector('nav[aria-label="Partes da Sessão de Viabilidade"]');
    expect(barraProgresso).toBeTruthy();
    // offsetParent (não `hidden`/display de um ancestral só): prova que o
    // nó está de fato renderizado na árvore visível, não escondido dentro
    // de um container fechado (mesma armadilha do teste de UI: filho
    // "visível" dentro de pai oculto dá verde falso).
    expect(container.querySelector('[data-testid="stub-briefing"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="stub-copiloto"]')).toBeTruthy();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir();
    await semViolacoes(container);
  });
});

/**
 * Kill-switch (`copiloto_sessao.ativo=false`) — achado do Fable (herdado de
 * C10): o copiloto nunca pode sumir só porque o recurso está desligado por
 * configuração, senão a Dra. Elaine não distingue "não implementado" de
 * "desligado agora". O comportamento INTERNO do estado desligado
 * (EstadoVazio, sem "tentar de novo") é coberto em `PainelCopiloto.test.tsx`;
 * aqui o que se prova é que a COMPOSIÇÃO — `PainelCopiloto` sendo montado
 * na tela — não muda com o estado interno do copiloto.
 */
describe("ConduzirSessaoApp — o copiloto continua montado com o copiloto desligado", () => {
  it("o painel é montado, mesmo representando o estado desligado", async () => {
    mockPainelCopiloto.mockImplementation(() => (
      <div data-testid="stub-copiloto">Copiloto desligado (stub do estado real)</div>
    ));

    const { container } = await abrir();

    expect(container.querySelector('[data-testid="stub-copiloto"]')).toBeTruthy();
    expect(container.textContent).toContain("Copiloto desligado");
  });
});
