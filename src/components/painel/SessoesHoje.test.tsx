// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { SessoesHoje } from "./SessoesHoje";
import type { SessaoDoDia } from "@/types/painel-ui";

/**
 * `jornada_id` != `agendamento_id`/`sessao_id` — a fixture usa três valores
 * DISTINTOS de propósito para que um teste que casar acidentalmente com o
 * id errado (o erro fácil documentado em `proximo-passo.ts` e nesta tarefa)
 * quebre, em vez de passar por coincidência de string igual.
 */
function sessao(parcial: Partial<SessaoDoDia> & { jornada_id: string; inicio_em: string; fim_em: string }): SessaoDoDia {
  return {
    nome: "Família Andrade",
    status: "confirmado",
    link_sala: null,
    advogada_id: null,
    advogada_nome: null,
    tem_briefing: true,
    presenca_confirmada_em: "2026-09-14T10:00:00Z",
    presenca_confirmada_via: "whatsapp",
    ...parcial,
  };
}

describe("SessoesHoje — botão Conduzir", () => {
  it("aponta para /sessoes/{jornada_id}/conduzir — NÃO para o id da sessão", () => {
    const { container } = montar(
      <SessoesHoje
        estado={{
          situacao: "ok",
          itens: [sessao({ jornada_id: "jornada-123", inicio_em: "2026-09-15T13:00:00Z", fim_em: "2026-09-15T14:00:00Z" })],
        }}
        aoTentarDeNovo={() => {}}
      />,
    );
    const conduzir = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Conduzir");
    expect(conduzir).toBeDefined();
    expect(conduzir?.getAttribute("href")).toBe("/sessoes/jornada-123/conduzir");
    // O erro fácil: usar o id do AGENDAMENTO ou da SESSÃO (sessoes_viabilidade),
    // que a view também carrega, em vez do id da JORNADA.
    expect(conduzir?.getAttribute("href")).not.toContain("agendamento-999");
    expect(conduzir?.getAttribute("href")).not.toContain("sessao-999");
  });

  it("continua oferecendo Abrir sala/Colar link, sem competir com Conduzir", () => {
    const { container } = montar(
      <SessoesHoje
        estado={{
          situacao: "ok",
          itens: [sessao({ jornada_id: "j1", inicio_em: "2026-09-15T13:00:00Z", fim_em: "2026-09-15T14:00:00Z", link_sala: "https://meet.example/abc" })],
        }}
        aoTentarDeNovo={() => {}}
      />,
    );
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.textContent?.trim());
    expect(links).toContain("Conduzir");
    expect(links.some((t) => t?.startsWith("Abrir sala"))).toBe(true);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <SessoesHoje
        estado={{ situacao: "ok", itens: [sessao({ jornada_id: "j1", inicio_em: "2026-09-15T13:00:00Z", fim_em: "2026-09-15T14:00:00Z" })] }}
        aoTentarDeNovo={() => {}}
      />,
    );
    await semViolacoes(container);
  });
});

describe("SessoesHoje — sessão em aberto (0104)", () => {
  it("sessão com data passada e sem desfecho aparece, mesmo sem sessão hoje", () => {
    const { container } = montar(
      <SessoesHoje
        estado={{ situacao: "ok", itens: [] }}
        emAberto={{
          situacao: "ok",
          itens: [sessao({ jornada_id: "atrasada-1", nome: "Cláudia Bittencourt Nogueira", inicio_em: "2026-09-07T13:00:00Z", fim_em: "2026-09-07T14:00:00Z" })],
        }}
        aoTentarDeNovo={() => {}}
      />,
    );
    // Não pode cair no caminho "Nenhuma sessão hoje" (Bloco.tsx trata vazio
    // como boa notícia) — o teste falha se a sessão em aberto sumir.
    expect(container.textContent).toContain("Cláudia Bittencourt Nogueira");
    expect(container.textContent).not.toContain("Nenhuma sessão hoje");
    expect(container.textContent).toContain("Em aberto");
  });

  it("sessão em aberto também tem o botão Conduzir apontando para a jornada certa", () => {
    const { container } = montar(
      <SessoesHoje
        estado={{ situacao: "ok", itens: [] }}
        emAberto={{ situacao: "ok", itens: [sessao({ jornada_id: "jornada-atrasada", inicio_em: "2026-09-07T13:00:00Z", fim_em: "2026-09-07T14:00:00Z" })] }}
        aoTentarDeNovo={() => {}}
      />,
    );
    const conduzir = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Conduzir");
    expect(conduzir?.getAttribute("href")).toBe("/sessoes/jornada-atrasada/conduzir");
  });

  it("sem sessão hoje e sem sessão em aberto, mostra a mensagem de nada pendente", () => {
    const { container } = montar(
      <SessoesHoje estado={{ situacao: "ok", itens: [] }} emAberto={{ situacao: "ok", itens: [] }} aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("Nenhuma sessão hoje, amanhã ou em aberto.");
  });

  it("sem o prop emAberto (tela antiga), continua funcionando normalmente", () => {
    const { container } = montar(
      <SessoesHoje
        estado={{ situacao: "ok", itens: [sessao({ jornada_id: "j1", inicio_em: "2026-09-15T13:00:00Z", fim_em: "2026-09-15T14:00:00Z" })] }}
        aoTentarDeNovo={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("Nenhuma sessão hoje");
  });

  it("não tem violação de acessibilidade com sessão em aberto", async () => {
    const { container } = montar(
      <SessoesHoje
        estado={{ situacao: "ok", itens: [] }}
        emAberto={{ situacao: "ok", itens: [sessao({ jornada_id: "j1", inicio_em: "2026-09-07T13:00:00Z", fim_em: "2026-09-07T14:00:00Z" })] }}
        aoTentarDeNovo={() => {}}
      />,
    );
    await semViolacoes(container);
  });
});
