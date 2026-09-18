// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { SegmentoCopiloto } from "@/types/copiloto";
import { RodapeTranscricao } from "./RodapeTranscricao";

/**
 * F4 (18/09/2026) — indicador tricolor (limiares 12s/25s, medidos na sessão
 * real citada no plano: fala a cada 2,9s em média, p99 8,7s, maior silêncio
 * real 15,8s) + overlay da transcrição completa.
 */

function segmento(criadoEm: string, texto = "fala qualquer"): SegmentoCopiloto {
  return {
    id: `seg-${criadoEm}`,
    sessao_id: "s1",
    ordem: 1,
    falante: null,
    falante_confianca: null,
    texto,
    iniciado_ms: null,
    origem: "bot",
    criado_em: criadoEm,
  };
}

describe("RodapeTranscricao — indicador tricolor", () => {
  it("sem nenhum segmento ainda: 'ouvindo', nunca timer nenhum registrado (sem necessidade de relógio)", () => {
    const { container } = montar(<RodapeTranscricao segmentos={[]} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("ouvindo");
    expect(container.textContent).toContain("Aguardando a fala da sessão.");
  });

  it("última fala há poucos segundos: nível 'ouvindo' (verde)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:05.000Z"));
    const segmentos = [segmento("2026-09-18T10:00:00.000Z", "apartamento já está no nome das meninas")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("ouvindo");
    expect(container.textContent).toContain("apartamento já está no nome das meninas");
    vi.useRealTimers();
  });

  it("15s de silêncio (entre os limiares 12/25): nível 'atenção' (âmbar), rótulo com segundos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:15.000Z"));
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("sem áudio");
    vi.useRealTimers();
  });

  it("30s de silêncio (acima de 25): nível 'alerta' (vermelho), 'sem captura'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:30.000Z"));
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("sem captura");
    vi.useRealTimers();
  });

  it("cor nunca é o único portador: cada nível tem palavra por extenso (grayscale-safe)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:30.000Z"));
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { getAllByText } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    // Duas ocorrências de propósito: o rótulo VISÍVEL curto ("sem captura")
    // e o `sr-only role="status"` com a versão completa ("sem captura há
    // 30s") — as duas carregam o mesmo fato por extenso, nunca só cor.
    expect(getAllByText(/sem captura/i).length).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

describe("RodapeTranscricao — overlay da transcrição completa", () => {
  it("botão 'Abrir transcrição' abre o overlay em role=dialog, sem tirar o conteúdo do rodapé da tela", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z", "texto completo da fala")];
    const { getByRole, queryByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(queryByRole("dialog")).toBeNull();

    fireEvent.click(getByRole("button", { name: /abrir transcrição/i }));

    const dialogo = getByRole("dialog");
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
  });

  it("Esc fecha o overlay e devolve o foco ao botão que abriu", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { getByRole, queryByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    const botaoAbrir = getByRole("button", { name: /abrir transcrição/i });
    fireEvent.click(botaoAbrir);
    expect(getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(botaoAbrir);
  });

  it("botão 'Fechar' também fecha o overlay", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { getByRole, queryByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    fireEvent.click(getByRole("button", { name: /abrir transcrição/i }));
    fireEvent.click(getByRole("button", { name: /fechar/i }));
    expect(queryByRole("dialog")).toBeNull();
  });
});

describe("RodapeTranscricao — a11y", () => {
  it("axe limpo: rodapé fechado", async () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    await semViolacoes(container);
  });

  it("axe limpo: overlay aberto", async () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container, getByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    fireEvent.click(getByRole("button", { name: /abrir transcrição/i }));
    await semViolacoes(container);
  });
});
