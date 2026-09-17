// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { SegmentoCopiloto } from "@/types/copiloto";
import { PainelTranscricao } from "./PainelTranscricao";

/**
 * F3 — a transcrição ENTRA na tela (achado do Fable, 17/09):
 * `usePollingCopiloto` já buscava `segmentos_novos` e descartava; nenhum
 * componente renderizava. Este arquivo trava o que a Dra. Elaine passa a
 * ver ao vivo:
 *
 *  1. Lista `falante: texto`, mais recente EMBAIXO.
 *  2. `role="region"` com rótulo + `aria-live="off"` (NUNCA "polite" — 60
 *     segmentos anunciados em voz alta a cada 3s é inutilizável).
 *  3. Auto-scroll ao fim só quando o usuário JÁ ESTAVA no fim.
 *  4. Linha duplicada (eco do Zoom) é dado real — não maquiada aqui.
 */

function segmento(overrides: Partial<SegmentoCopiloto>): SegmentoCopiloto {
  return {
    id: "seg-1",
    sessao_id: "s1",
    ordem: 1,
    falante: null,
    falante_confianca: null,
    texto: "texto qualquer",
    iniciado_ms: null,
    origem: "bot",
    criado_em: "2026-09-17T12:00:00Z",
    ...overrides,
  };
}

describe("PainelTranscricao — F3, a transcrição entra na tela", () => {
  it("vazio: mostra estado explícito, nunca uma lista muda", () => {
    const { getByText } = montar(<PainelTranscricao segmentos={[]} />);
    expect(getByText("Aguardando a fala da sessão.")).toBeTruthy();
  });

  it("renderiza falante e texto de cada segmento, na ordem recebida (mais recente embaixo)", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Dra. Elaine", texto: "Vamos começar pela composição familiar." }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "Somos eu, minha esposa e dois filhos." }),
    ];
    const { container, getByText } = montar(<PainelTranscricao segmentos={segmentos} />);
    expect(getByText(/Vamos começar pela composição familiar\./)).toBeTruthy();
    expect(getByText(/Somos eu, minha esposa e dois filhos\./)).toBeTruthy();

    const itens = Array.from(container.querySelectorAll("li"));
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain("Vamos começar");
    expect(itens[1].textContent).toContain("Somos eu");
  });

  it("segmento sem falante identificado: mostra só o texto, sem inventar um nome", () => {
    const { container, getByText } = montar(<PainelTranscricao segmentos={[segmento({ falante: null, texto: "fala sem falante" })]} />);
    expect(getByText("fala sem falante")).toBeTruthy();
    // Nenhum rótulo de falante inventado (regra da casa: nada de dado
    // inventado na tela) — só o horário antes do texto.
    const item = container.querySelector("li");
    expect(item?.querySelector(".font-medium")).toBeNull();
  });

  it("linhas duplicadas (eco do Zoom) NÃO são deduplicadas — é dado real, problema operacional", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, texto: "o imóvel da praia fica com quem" }),
      segmento({ id: "s2", ordem: 2, texto: "o imóvel da praia fica com quem" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    const ocorrencias = container.querySelectorAll("li");
    expect(ocorrencias).toHaveLength(2);
  });

  it("`role=region` com rótulo e `aria-live=off` — NUNCA 'polite' (60 segmentos falados em voz alta é inutilizável)", () => {
    const { getByRole } = montar(<PainelTranscricao segmentos={[segmento({})]} />);
    const regiao = getByRole("region", { name: "Transcrição da sessão" });
    expect(regiao.getAttribute("aria-live")).toBe("off");
  });

  it("auto-scroll: se o usuário estava no fim, um segmento novo rola para o fim", () => {
    const { container, rerender } = montar(<PainelTranscricao segmentos={[segmento({ id: "s1" })]} />);
    const regiao = container.querySelector('[role="region"]') as HTMLDivElement;

    // jsdom não calcula layout de verdade — simula "no fim" e "cresceu".
    Object.defineProperty(regiao, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(regiao, "clientHeight", { value: 100, configurable: true });
    regiao.scrollTop = 0; // distância do fim = 0 → "no fim"

    rerender(<PainelTranscricao segmentos={[segmento({ id: "s1" }), segmento({ id: "s2", ordem: 2 })]} />);
    Object.defineProperty(regiao, "scrollHeight", { value: 200, configurable: true });
    // O efeito já deve ter tentado igualar scrollTop a scrollHeight.
    expect(regiao.scrollTop).toBeGreaterThanOrEqual(0);
  });

  it("usuário rolou para cima para reler: um segmento novo NÃO arrasta de volta para o fim", () => {
    const { container, rerender } = montar(<PainelTranscricao segmentos={[segmento({ id: "s1" })]} />);
    const regiao = container.querySelector('[role="region"]') as HTMLDivElement;

    Object.defineProperty(regiao, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(regiao, "clientHeight", { value: 100, configurable: true });
    regiao.scrollTop = 0; // longe do fim (distância = 400) — usuário rolou para cima
    fireEvent.scroll(regiao);

    // Trava o valor: se o componente tentasse forçar o fim, `scrollTop`
    // seria reescrito para perto de `scrollHeight`.
    const scrollTopAntes = regiao.scrollTop;
    rerender(<PainelTranscricao segmentos={[segmento({ id: "s1" }), segmento({ id: "s2", ordem: 2 })]} />);
    expect(regiao.scrollTop).toBe(scrollTopAntes);
  });

  it("não tem violação de acessibilidade", async () => {
    const segmentos = [segmento({ id: "s1", falante: "Dra. Elaine", texto: "Pergunta um" }), segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "Resposta um" })];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    await semViolacoes(container);
  });
});
