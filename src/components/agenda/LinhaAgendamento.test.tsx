// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { LinhaAgendamento } from "./LinhaAgendamento";
import type { AgendamentoAgenda } from "@/types/agenda";

/**
 * "Realizada" passou a confirmar (15/09/2026).
 *
 * POR QUE ESTE TESTE EXISTE: o efeito é **irreversível pela UI**. Ao sair de
 * `agendado`/`confirmado`, a linha perde o botão "Conduzir" e a sessão some
 * das DUAS views do painel — nem `vw_sessoes_do_dia` nem `vw_sessoes_em_aberto`
 * (0104) trazem status `realizado`. Não há caminho de volta na tela: só por
 * SQL. E os dois botões ficam lado a lado, então o clique errado é a poucos
 * pixels do certo.
 *
 * Sem estes testes, alguém "simplifica" o fluxo de volta para um clique só e
 * ninguém percebe até a Dra. Elaine perder o atalho no meio de um dia cheio.
 */

const atualizarAgendamentoMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/api")>();
  return { ...original, atualizarAgendamento: atualizarAgendamentoMock };
});
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: vi.fn() }) }));

const AGENDAMENTO: AgendamentoAgenda = {
  id: "ag-1",
  sessao_id: "sessao-1",
  jornada_id: "jornada-1",
  pessoa_nome: "Cláudia Bittencourt",
  inicio_em: "2026-09-15T13:00:00.000Z",
  fim_em: "2026-09-15T14:00:00.000Z",
  status: "confirmado",
  origem: "equipe",
  observacoes: null,
};

function abrir(agendamento: AgendamentoAgenda = AGENDAMENTO) {
  return montar(
    <ul>
      <LinhaAgendamento agendamento={agendamento} aoAtualizar={vi.fn()} />
    </ul>,
  );
}

describe("LinhaAgendamento — 'Realizada' confirma antes de agir (15/09)", () => {
  it("clicar em 'Realizada' NÃO muda o status de imediato — abre a confirmação", async () => {
    atualizarAgendamentoMock.mockClear();
    abrir();

    fireEvent.click(screen.getByRole("button", { name: /^realizada$/i }));

    // A trava: nenhuma chamada de API acontece só por clicar no botão.
    expect(atualizarAgendamentoMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("a confirmação diz o EFEITO por extenso, incluindo a perda do atalho de conduzir", async () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /^realizada$/i }));

    const dialogo = await screen.findByRole("alertdialog");
    // Regra do `ConfirmarAcao`: o efeito por extenso, nunca "tem certeza?".
    expect(dialogo.textContent).not.toMatch(/tem certeza/i);
    // A parte que surpreende — e que não tem volta pela tela.
    expect(dialogo.textContent).toMatch(/conduzir/i);
    expect(dialogo.textContent).toMatch(/Cláudia Bittencourt/);
  });

  it("'Ainda não' cancela sem tocar no status", async () => {
    atualizarAgendamentoMock.mockClear();
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /^realizada$/i }));

    // `ConfirmarAcao` dá o mesmo `aria-label` ao véu clicável e ao botão de
    // cancelar (dois caminhos para a MESMA saída segura, por desenho). Busca
    // dentro do diálogo para pegar o botão, não o véu.
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /ainda não/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(atualizarAgendamentoMock).not.toHaveBeenCalled();
  });

  it("confirmar é o ÚNICO caminho que marca como realizada", async () => {
    atualizarAgendamentoMock.mockClear();
    atualizarAgendamentoMock.mockResolvedValue({ ...AGENDAMENTO, status: "realizado" });
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /^realizada$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /marcar como realizada/i }));

    await waitFor(() => expect(atualizarAgendamentoMock).toHaveBeenCalledTimes(1));
    expect(atualizarAgendamentoMock.mock.calls[0]?.[1]).toMatchObject({ status: "realizado" });
  });

  it("não tem violação de acessibilidade com a confirmação aberta", async () => {
    const { container } = abrir();
    fireEvent.click(screen.getByRole("button", { name: /^realizada$/i }));
    await screen.findByRole("alertdialog");
    await semViolacoes(container);
  });
});
