// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { ErroSessao } from "@/components/sessao/api";
import { PainelBot } from "./PainelBot";

/**
 * Movido de `PainelCopiloto.test.tsx` na Fase 12, Fatia B (tela vira
 * leitura) — `PainelBot` deixou de ser um bloco da tela ao vivo (pedir o bot
 * é OPERAÇÃO, sobe para o cabeçalho de `ConduzirSessaoApp.tsx`) e foi
 * extraído para arquivo próprio. A trava vale igual no destino: as mesmas
 * asserções, agora montando `PainelBot` direto em vez de via
 * `PainelCopiloto`.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    pedirBotChamadas: 0,
    pedirBotResposta: null as { sessao_id: string; bot_id: string } | null,
    erroPedirBot: null as Error | null,
  },
}));

vi.mock("@/components/sessao/api", async () => {
  const real = await vi.importActual<typeof import("@/components/sessao/api")>("@/components/sessao/api");
  return {
    ...real,
    pedirBotCopiloto: (sessaoId: string) => {
      estado.pedirBotChamadas += 1;
      if (estado.erroPedirBot) return Promise.reject(estado.erroPedirBot);
      return Promise.resolve(estado.pedirBotResposta ?? { sessao_id: sessaoId, bot_id: "bot-1" });
    },
  };
});

beforeEach(() => {
  estado.pedirBotChamadas = 0;
  estado.pedirBotResposta = null;
  estado.erroPedirBot = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PainelBot — Fatia 4, bot na sala", () => {
  it("botão 'Pedir bot na sala' existe e pede o bot ao ser clicado", async () => {
    const { getByRole } = montar(<PainelBot sessaoId="s1" />);
    const botao = getByRole("button", { name: /pedir bot na sala/i });
    fireEvent.click(botao);
    await waitFor(() => expect(estado.pedirBotChamadas).toBe(1));
  });

  it("sucesso: mostra que o bot foi pedido, visível para o cliente", async () => {
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Bot pedido"));
    expect(container.textContent).toContain("visível para o cliente");
  });

  it("sala_invalida com sub_codigo=meeting_not_found: mensagem ESPECÍFICA citando o link, nunca 'erro ao iniciar'", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Não encontrei uma reunião nesse link");
    expect(container.textContent).toContain("Confira o link da sala na Ficha");
    expect(container.textContent).not.toContain("erro ao iniciar");
    expect(container.textContent).not.toContain("Não foi possível pedir o bot");
  });

  it("sala_invalida com sub_codigo DESCONHECIDO: mostrado CRU, não engolido", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "bot_removed_by_admin",
    });
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("bot_removed_by_admin");
  });

  it("sala_invalida SEM detalhes (defesa): mensagem genérica de sala, ainda assim específica sobre o link", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Confira o link da sala");
  });

  it("bot_ja_pedido: ESTADO (idempotência), não erro — sem role=alert, sem botão de tentar de novo", async () => {
    estado.erroPedirBot = new ErroSessao("Já existe um bot pedido para esta sessão.", 409, "bot_ja_pedido");
    const { getByRole, container, queryByRole } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.textContent).toContain("Já existe um bot pedido"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(queryByRole("button", { name: /tentar de novo/i })).toBeNull();
  });

  it("audio_ao_vivo_desligado: bot não configurado é ESTADO EXPLÍCITO, mesmo padrão do CopilotoDesligado (sóbrio, sem alarme)", async () => {
    estado.erroPedirBot = new ErroSessao("Desligado.", 409, "audio_ao_vivo_desligado");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    // Correção do Marcio (14/09): quadro que passa a sessão inteira vazio
    // não ocupa espaço fixo — some por completo (`null`).
    await waitFor(() => expect(container.textContent).not.toContain("Bot na sala"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("provedor_audio_nao_configurado: mesmo estado explícito — o quadro some", async () => {
    estado.erroPedirBot = new ErroSessao("Sem provedor.", 409, "provedor_audio_nao_configurado");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.textContent).not.toContain("Bot na sala"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("copiloto_ao_vivo_bloqueado: erro de verdade, role=alert, mensagem própria", async () => {
    estado.erroPedirBot = new ErroSessao("Bloqueado.", 409, "copiloto_ao_vivo_bloqueado");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Copiloto ao vivo bloqueado");
  });

  it("retencao_infinita_detectada: mensagem própria, nunca confundida com sala inválida", async () => {
    estado.erroPedirBot = new ErroSessao("Retenção infinita.", 409, "retencao_infinita_detectada");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("encerrado por segurança");
  });

  it("botão não pode ser clicado duas vezes enquanto o bot é pedido", async () => {
    let resolver!: (v: { sessao_id: string; bot_id: string }) => void;
    const pendente = new Promise<{ sessao_id: string; bot_id: string }>((r) => {
      resolver = r;
    });
    const apiModulo = await import("@/components/sessao/api");
    const spy = vi.spyOn(apiModulo, "pedirBotCopiloto").mockImplementation(() => pendente);

    const { getByRole } = montar(<PainelBot sessaoId="s1" />);
    const botao = getByRole("button", { name: /pedir bot na sala/i }) as HTMLButtonElement;
    fireEvent.click(botao);
    await waitFor(() => expect(botao.disabled).toBe(true));
    fireEvent.click(botao);

    resolver({ sessao_id: "s1", bot_id: "bot-1" });
    await waitFor(() => expect(botao.disabled).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("axe limpo: sucesso ao pedir o bot", async () => {
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Bot pedido"));
    await semViolacoes(container);
  });

  it("axe limpo: sala_invalida com sub_codigo conhecido", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    await semViolacoes(container);
  });

  it("axe limpo: bot_ja_pedido", async () => {
    estado.erroPedirBot = new ErroSessao("Já existe um bot pedido para esta sessão.", 409, "bot_ja_pedido");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Já existe um bot pedido"));
    await semViolacoes(container);
  });

  it("axe limpo: bot não configurado — quadro ausente, sem violação no resto da tela", async () => {
    estado.erroPedirBot = new ErroSessao("Desligado.", 409, "audio_ao_vivo_desligado");
    const { getByRole, container } = montar(<PainelBot sessaoId="s1" />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).not.toContain("Bot na sala"));
    await semViolacoes(container);
  });

  it("aoMudarEstado notifica o código de erro corrente (Fase 12: a linha fina do topo lê o mesmo código)", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const codigos: (string | undefined)[] = [];
    const { getByRole } = montar(<PainelBot sessaoId="s1" aoMudarEstado={(c) => codigos.push(c)} />);
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(codigos).toContain("sala_invalida"));
  });
});
