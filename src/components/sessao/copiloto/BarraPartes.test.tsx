// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { BlocoAtualResolvido } from "@/types/copiloto";
import { BarraPartes } from "./BarraPartes";

/**
 * Fase 12, Fatia 4 — a linha de comando vira andamento das 13 partes. Este
 * arquivo trava:
 *
 *  1. 13 segmentos no DOM (ou o `totalBlocos` recebido).
 *  2. O segmento ATUAL é distinguível dos demais (classe própria) — nunca
 *     por cor sozinha, sempre também por posição/altura.
 *  3. `origem === "indisponivel"`: todos os segmentos vazados, rótulo
 *     "— de N", nunca "01 de N"/"parte 0" (nada de dado inventado).
 *  4. `sr-only` explica a posição por extenso para quem não vê a barra.
 *  5. Segmentos NÃO são botões (nem têm `onClick`) — alvo de 13px não é
 *     controle (lição do "link de 11px").
 */

function resolvido(overrides: Partial<BlocoAtualResolvido>): BlocoAtualResolvido {
  return {
    bloco_id: "b1",
    indice: 3,
    titulo: "PARTE 04 — Radiografia patrimonial",
    origem: "inferido",
    confianca: 0.8,
    decidido_em: "2026-09-17T12:00:00Z",
    fixacao_expira_em: null,
    ...overrides,
  };
}

describe("BarraPartes — Fase 12, Fatia 4", () => {
  it("desenha 13 segmentos para um roteiro de 13 blocos", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({})} totalBlocos={13} />);
    const segmentos = container.querySelectorAll('[aria-hidden="true"].flex.h-2 > span');
    expect(segmentos).toHaveLength(13);
  });

  it("não hardcoda 13 — respeita o totalBlocos recebido", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 1 })} totalBlocos={2} />);
    const segmentos = container.querySelectorAll('[aria-hidden="true"].flex.h-2 > span');
    expect(segmentos).toHaveLength(2);
  });

  it("o segmento ATUAL é o único com a cor --latao; os percorridos usam border-linha-forte, os restantes border-linha", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    const segmentos = Array.from(container.querySelectorAll('[aria-hidden="true"].flex.h-2 > span'));
    expect(segmentos).toHaveLength(13);

    // Percorridos: índices 0,1,2 (< 3).
    for (let i = 0; i < 3; i++) {
      expect(segmentos[i].className).toContain("border-linha-forte");
      expect(segmentos[i].className).not.toContain("--latao");
    }
    // Atual: índice 3.
    expect(segmentos[3].className).toContain("--latao");
    // Restantes: índices 4..12.
    for (let i = 4; i < 13; i++) {
      expect(segmentos[i].className).not.toContain("--latao");
      expect(segmentos[i].className).not.toContain("border-linha-forte");
    }
  });

  it("rótulo mostra a POSIÇÃO ('04 de 13'), nunca 'cobertura' — e o título do bloco por extenso", () => {
    const { getByText } = montar(<BarraPartes resolvido={resolvido({ indice: 3, titulo: "PARTE 04 — Radiografia patrimonial" })} totalBlocos={13} />);
    expect(getByText(/04 de 13/)).toBeTruthy();
    expect(getByText(/PARTE 04 — Radiografia patrimonial/)).toBeTruthy();
  });

  it("origem indisponível: todos os segmentos vazados, rótulo '— de N', nunca '01 de N' nem 'parte 0'", () => {
    const { container, getByText } = montar(
      <BarraPartes resolvido={{ bloco_id: null, indice: null, titulo: null, origem: "indisponivel", confianca: null, decidido_em: null, fixacao_expira_em: null }} totalBlocos={13} />,
    );
    expect(getByText(/— de 13/)).toBeTruthy();
    expect(container.textContent).not.toContain("01 de 13");
    expect(container.textContent).not.toContain("parte 0");

    const segmentos = Array.from(container.querySelectorAll('[aria-hidden="true"].flex.h-2 > span'));
    expect(segmentos).toHaveLength(13);
    for (const seg of segmentos) {
      expect(seg.className).not.toContain("--latao");
      expect(seg.className).not.toContain("border-linha-forte");
    }
  });

  it("resolvido null (antes da 1ª resposta do servidor) tem o MESMO tratamento de indisponível", () => {
    const { getByText } = montar(<BarraPartes resolvido={null} totalBlocos={13} />);
    expect(getByText(/— de 13/)).toBeTruthy();
  });

  it("sr-only descreve a posição por extenso para quem não vê a barra", () => {
    const { getByText } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    expect(getByText("parte 4 de 13")).toBeTruthy();
  });

  it("sr-only no caso indisponível explica a ausência, nunca inventa uma posição", () => {
    const { getByText } = montar(
      <BarraPartes resolvido={{ bloco_id: null, indice: null, titulo: null, origem: "indisponivel", confianca: null, decidido_em: null, fixacao_expira_em: null }} totalBlocos={13} />,
    );
    expect(getByText("posição na sessão ainda não identificada")).toBeTruthy();
  });

  it("segmentos NÃO são botões nem têm onClick — alvo de 13px não é controle", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    await semViolacoes(container);
  });

  it("não tem violação de acessibilidade no caso indisponível", async () => {
    const { container } = montar(
      <BarraPartes resolvido={{ bloco_id: null, indice: null, titulo: null, origem: "indisponivel", confianca: null, decidido_em: null, fixacao_expira_em: null }} totalBlocos={13} />,
    );
    await semViolacoes(container);
  });
});
