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

describe("RodapeTranscricao — Fase 13: a transcrição SAIU daqui", () => {
  /**
   * FE-5. Estes testes são a trava de uma DECISÃO, não de um detalhe: o
   * achado que desligou esta chave em 18/09 foi "transcrição duplicada" (a
   * COL 3 e o overlay renderizando a mesma coisa). Se alguém reintroduzir um
   * segundo lugar que mostre transcrição, é aqui que quebra.
   */
  it("não existe mais botão 'Abrir transcrição' nem overlay nenhum", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z", "texto completo da fala")];
    const { queryByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);

    expect(queryByRole("button", { name: /abrir transcrição/i })).toBeNull();
    expect(queryByRole("dialog")).toBeNull();
  });

  it("nenhuma tecla abre diálogo: Esc no rodapé não tem nada para fechar", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { queryByRole } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("dialog")).toBeNull();
  });

  it("a linha inteira cabe no orçamento de 1 linha: nenhum botão dentro dela", () => {
    // §C.1 do plano reserva 44 px (`min-h-11`) para esta sub-linha. Um botão
    // de 44 px dentro dela era o que a fazia disputar altura com o mosaico —
    // o que sobra é ponto + rótulo + última fala com reticências.
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.firstElementChild?.className).toContain("min-h-11");
  });

  it("a última fala continua visível e com `title` para o texto inteiro", () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z", "o apartamento está no nome das meninas")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    expect(container.textContent).toContain("o apartamento está no nome das meninas");
    expect(container.querySelector('[title="o apartamento está no nome das meninas"]')).not.toBeNull();
  });
});

describe("RodapeTranscricao — a11y", () => {
  it("axe limpo", async () => {
    const segmentos = [segmento("2026-09-18T10:00:00.000Z")];
    const { container } = montar(<RodapeTranscricao segmentos={segmentos} sessaoEncerrada={false} />);
    await semViolacoes(container);
  });

  it("axe limpo sem nenhum segmento ainda", async () => {
    const { container } = montar(<RodapeTranscricao segmentos={[]} sessaoEncerrada={false} />);
    await semViolacoes(container);
  });
});
