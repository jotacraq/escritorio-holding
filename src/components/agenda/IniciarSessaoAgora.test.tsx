// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { ApiError } from "@/lib/api";

/**
 * "Iniciar sessão agora" (15/09/2026). Três garantias exigidas pelo plano:
 *
 *  1. O redirecionamento usa o `jornada_id` (escolhido na busca), NUNCA o
 *     `sessao_id` que a rota devolve — é o erro fácil documentado em
 *     `LinhaAgendamento.tsx` (`/sessoes/[id]/conduzir` recebe id da JORNADA).
 *  2. Colisão de horário (409 `horario_indisponivel`, exclusion constraint)
 *     mostra mensagem ESPECÍFICA — nunca um erro genérico — e não navega.
 *  3. Sem link de sala, "Iniciar agora" funciona: `gravarLinkSala` não é
 *     chamada e o fluxo conclui do mesmo jeito.
 */

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const criarAgendamentoMock = vi.fn();
const listarJornadasMock = vi.fn();
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    criarAgendamento: (...a: unknown[]) => criarAgendamentoMock(...a),
    listarJornadas: (...a: unknown[]) => listarJornadasMock(...a),
  };
});

const gravarLinkSalaMock = vi.fn();
vi.mock("@/components/ficha360/api-sessao", async () => {
  const real = await vi.importActual<typeof import("@/components/ficha360/api-sessao")>("@/components/ficha360/api-sessao");
  return { ...real, gravarLinkSala: (...a: unknown[]) => gravarLinkSalaMock(...a) };
});

const { IniciarSessaoAgora } = await import("./IniciarSessaoAgora");

const JORNADA = { id: "jornada-42", nome: "Maria Souza", cidade: "Recife", uf: "PE", faixa_patrimonio_declarada: null, origem: "seminario" };

afterEach(() => {
  vi.clearAllMocks();
});

async function abrirEescolherCliente() {
  const utilitarios = montar(<IniciarSessaoAgora />);
  const { getByRole, findByRole } = utilitarios;
  fireEvent.click(getByRole("button", { name: "Iniciar sessão agora" }));
  const campoBusca = await findByRole("combobox");
  listarJornadasMock.mockResolvedValue({ itens: [JORNADA], total: 1 });
  fireEvent.change(campoBusca, { target: { value: "Maria" } });
  const opcao = await findByRole("option", { name: /Maria Souza/ });
  fireEvent.click(opcao);
  return utilitarios;
}

describe("IniciarSessaoAgora — não tem violação de acessibilidade", () => {
  it("estado fechado", async () => {
    const { container } = montar(<IniciarSessaoAgora />);
    await semViolacoes(container);
  });

  it("gaveta aberta, com a lista de resultados", async () => {
    const { container } = await abrirEescolherCliente();
    await semViolacoes(container);
  });
});

describe("IniciarSessaoAgora — redireciona pelo jornada_id, nunca pelo sessao_id", () => {
  it("agendamento criado com sessao_id diferente do jornada_id: o push usa o jornada_id", async () => {
    criarAgendamentoMock.mockResolvedValue({
      agendamento: { id: "agendamento-9", sessao_id: "sessao-99-NAO-EH-ISTO", jornada_id: JORNADA.id, inicio_em: new Date().toISOString(), fim_em: new Date().toISOString(), status: "agendado", origem: "equipe", observacoes: null },
    });

    const { getByRole } = await abrirEescolherCliente();
    fireEvent.click(getByRole("button", { name: "Iniciar sessão" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/sessoes/${JORNADA.id}/conduzir`));
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("sessao-99-NAO-EH-ISTO"));
    expect(criarAgendamentoMock).toHaveBeenCalledWith(JORNADA.id, expect.objectContaining({ inicio_em: expect.any(String) }));
  });
});

describe("IniciarSessaoAgora — colisão de horário (409)", () => {
  it("mostra a mensagem específica do servidor, sem navegar", async () => {
    criarAgendamentoMock.mockRejectedValue(new ApiError("Este horário já está ocupado para a advogada selecionada.", 409, "horario_indisponivel"));

    const { getByRole, findByRole } = await abrirEescolherCliente();
    fireEvent.click(getByRole("button", { name: "Iniciar sessão" }));

    const alerta = await findByRole("alert");
    expect(alerta.textContent).toContain("Este horário já está ocupado para a advogada selecionada.");
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("IniciarSessaoAgora — link de sala é opcional", () => {
  it("sem link, conclui sem chamar gravarLinkSala", async () => {
    criarAgendamentoMock.mockResolvedValue({
      agendamento: { id: "agendamento-1", sessao_id: "sessao-1", jornada_id: JORNADA.id, inicio_em: new Date().toISOString(), fim_em: new Date().toISOString(), status: "agendado", origem: "equipe", observacoes: null },
    });

    const { getByRole } = await abrirEescolherCliente();
    fireEvent.click(getByRole("button", { name: "Iniciar sessão" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/sessoes/${JORNADA.id}/conduzir`));
    expect(gravarLinkSalaMock).not.toHaveBeenCalled();
  });

  it("com link inválido, bloqueia ANTES de chamar criarAgendamento e mostra erro no campo", async () => {
    const { getByRole, getByLabelText } = await abrirEescolherCliente();
    fireEvent.change(getByLabelText(/Link da sala/), { target: { value: "não é um link" } });
    fireEvent.click(getByRole("button", { name: "Iniciar sessão" }));

    await waitFor(() => expect(getByRole("alert").textContent).toContain("https://"));
    expect(criarAgendamentoMock).not.toHaveBeenCalled();
  });
});
