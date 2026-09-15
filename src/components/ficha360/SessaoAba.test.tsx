// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { SessaoAba } from "./SessaoAba";
import type { Ficha360 } from "@/lib/api";

/**
 * "Conduzir sessão" saiu de dentro do passo 4 (15/09/2026).
 *
 * A INVERSÃO QUE ISTO CORRIGE, e por que ela era invisível:
 * `feitos.presenca = Boolean(sessao.realizada_em)` e o passo aceso é o
 * primeiro NÃO concluído. Logo, o passo "Presença" — que continha o ÚNICO
 * botão de conduzir da Ficha — só acendia sozinho **depois** de a sessão já
 * ter sido realizada. No momento em que a advogada precisa conduzir, o botão
 * estava escondido atrás de um clique deliberado no stepper.
 *
 * Nenhum teste pegava isso porque o botão *existia* — só não estava
 * alcançável. "Já funciona" ≠ "está alcançável" é regra registrada da casa.
 */

vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: vi.fn() }) }));
vi.mock("@/lib/api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/api")>();
  return { ...original, listarFamiliares: vi.fn().mockResolvedValue([]), adicionarFamiliar: vi.fn(), criarAgendamento: vi.fn() };
});

const AGENDAMENTO_FUTURO = {
  id: "ag-1",
  sessao_id: "sessao-1",
  inicio_em: "2026-09-20T13:00:00.000Z",
  fim_em: "2026-09-20T14:00:00.000Z",
  status: "confirmado",
  origem: "equipe",
  observacoes: null,
};

/** Fixture mínimo: só o que `SessaoAba` lê. O resto da Ficha360 não é tocado. */
function ficha(overrides: Partial<Ficha360> = {}): Ficha360 {
  return {
    jornada: { id: "jornada-1" },
    pessoa: { id: "p1", nome: "Cláudia Bittencourt" },
    sessao: null,
    agendamentos: [],
    documentos: [],
    timeline: [],
    tarefasAbertas: [],
    // `SessaoAba:176` lê isto direto (sem `??`): sem o campo, o componente
    // quebra antes de renderizar qualquer coisa. `false` = ligação por IA
    // desligada, que é o estado de produção hoje.
    configuracoesUi: { ligacaoIaAtiva: false },
    ...overrides,
  } as unknown as Ficha360;
}

function abrir(f: Ficha360) {
  return montar(<SessaoAba jornadaId="jornada-1" ficha={f} aoAtualizar={vi.fn()} />);
}

describe("SessaoAba — 'Conduzir sessão' não depende do passo aceso (15/09)", () => {
  it("🔴 sessão marcada e NÃO realizada: o botão está na tela sem nenhum clique no stepper", () => {
    // Este é exatamente o estado do dia da sessão — e o que estava quebrado:
    // o passo aceso aqui é "Sala" ou "Confirmação", nunca "Presença".
    abrir(ficha({ agendamentos: [AGENDAMENTO_FUTURO] as Ficha360["agendamentos"] }));

    const link = screen.getByRole("link", { name: /conduzir sessão/i });
    expect(link.getAttribute("href")).toBe("/sessoes/jornada-1/conduzir");
  });

  it("usa o id da JORNADA, nunca o da sessão (erro fácil da rota `/sessoes/[id]/conduzir`)", () => {
    abrir(ficha({ agendamentos: [AGENDAMENTO_FUTURO] as Ficha360["agendamentos"] }));

    const href = screen.getByRole("link", { name: /conduzir sessão/i }).getAttribute("href");
    expect(href).toContain("jornada-1");
    expect(href).not.toContain("sessao-1");
  });

  it("aparece UMA vez só — o botão antigo do passo 'Presença' não ficou duplicado", () => {
    abrir(ficha({ agendamentos: [AGENDAMENTO_FUTURO] as Ficha360["agendamentos"] }));

    expect(screen.getAllByRole("link", { name: /conduzir sessão/i })).toHaveLength(1);
  });

  it("sem agendamento nenhum: NÃO oferece conduzir — `/conduzir` cairia em 'sem-sessão'", () => {
    abrir(ficha());

    expect(screen.queryByRole("link", { name: /conduzir sessão/i })).toBeNull();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = abrir(ficha({ agendamentos: [AGENDAMENTO_FUTURO] as Ficha360["agendamentos"] }));
    await semViolacoes(container);
  });
});
