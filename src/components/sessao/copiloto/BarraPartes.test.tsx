// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { BlocoAtualResolvido } from "@/types/copiloto";
import { BarraPartes } from "./BarraPartes";

/**
 * Fase 12, Fatia 4 (redesenho F1, 17/09 — pílulas em trilho fixo, corrige o
 * defeito relatado: segmentos vazados eram invisíveis por construção). Este
 * arquivo trava:
 *
 *  1. 13 segmentos no DOM (ou o `totalBlocos` recebido).
 *  2. O segmento ATUAL é distinguível dos demais por ALTURA/LARGURA (classe
 *     própria), nunca só por cor — percorrido e atual usam a MESMA cor
 *     preenchida (`--acento`/fallback `--latao`); o restante usa o trilho.
 *  3. `origem === "indisponivel"`: todos os segmentos no tom do trilho
 *     (nenhum preenchido), rótulo "— de N", nunca "01 de N"/"parte 0" (nada
 *     de dado inventado).
 *  4. `sr-only` explica a posição por extenso para quem não vê a barra.
 *  5. Segmentos NÃO são botões (nem têm `onClick`) — alvo de 13px não é
 *     controle (lição do "link de 11px").
 *  6. (F7, correção do Fable) o destaque do trilho na troca de parte é
 *     TEMPORÁRIO — presente após 1 frame, ausente após 1,5 s — nunca uma
 *     classe permanente (que, com o bloco estático de `prefers-reduced-motion`,
 *     deixaria o trilho verde-claro fixo a sessão inteira).
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

const INDISPONIVEL: BlocoAtualResolvido = { bloco_id: null, indice: null, titulo: null, origem: "indisponivel", confianca: null, decidido_em: null, fixacao_expira_em: null };

describe("BarraPartes — Fase 12, Fatia 4", () => {
  const SELETOR_TRILHO = '[aria-hidden="true"].flex.w-\\[13rem\\] > span';

  it("desenha 13 segmentos (pílulas) para um roteiro de 13 blocos", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({})} totalBlocos={13} />);
    const segmentos = container.querySelectorAll(SELETOR_TRILHO);
    expect(segmentos).toHaveLength(13);
  });

  it("não hardcoda 13 — respeita o totalBlocos recebido", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 1 })} totalBlocos={2} />);
    const segmentos = container.querySelectorAll(SELETOR_TRILHO);
    expect(segmentos).toHaveLength(2);
  });

  it("o trilho tem largura FIXA (w-[13rem]) — nunca some com segmentos finos demais (defeito relatado, F1)", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    expect(container.querySelector(SELETOR_TRILHO.replace(" > span", ""))).toBeTruthy();
  });

  it("percorridos e atual usam a mesma cor preenchida (--acento/fallback --latao); só o ATUAL tem a classe de largura maior (flex-[1.6]) — distinção por altura/posição, nunca só cor", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    const segmentos = Array.from(container.querySelectorAll(SELETOR_TRILHO));
    expect(segmentos).toHaveLength(13);

    // Percorridos: índices 0,1,2 (< 3) — preenchidos, largura normal.
    for (let i = 0; i < 3; i++) {
      expect(segmentos[i].className).toContain("--acento");
      expect(segmentos[i].className).not.toContain("flex-[1.6]");
    }
    // Atual: índice 3 — preenchido, largura maior (2ª diferença não cromática).
    expect(segmentos[3].className).toContain("--acento");
    expect(segmentos[3].className).toContain("flex-[1.6]");
    // Restantes: índices 4..12 — trilho, nunca preenchidos.
    for (let i = 4; i < 13; i++) {
      expect(segmentos[i].className).not.toContain("var(--acento,");
      expect(segmentos[i].className).not.toContain("flex-[1.6]");
      expect(segmentos[i].className).toContain("acento-trilho");
    }
  });

  it("rótulo mostra a POSIÇÃO ('04 de 13'), nunca 'cobertura' — e o título do bloco por extenso", () => {
    const { getByText } = montar(<BarraPartes resolvido={resolvido({ indice: 3, titulo: "PARTE 04 — Radiografia patrimonial" })} totalBlocos={13} />);
    expect(getByText(/04 de 13/)).toBeTruthy();
    expect(getByText(/PARTE 04 — Radiografia patrimonial/)).toBeTruthy();
  });

  it("origem indisponível: todos os segmentos no tom do trilho (nenhum preenchido), rótulo '— de N', nunca '01 de N' nem 'parte 0'", () => {
    const { container, getByText } = montar(<BarraPartes resolvido={INDISPONIVEL} totalBlocos={13} />);
    expect(getByText(/— de 13/)).toBeTruthy();
    expect(container.textContent).not.toContain("01 de 13");
    expect(container.textContent).not.toContain("parte 0");

    const segmentos = Array.from(container.querySelectorAll(SELETOR_TRILHO));
    expect(segmentos).toHaveLength(13);
    for (const seg of segmentos) {
      expect(seg.className).not.toContain("var(--acento,");
      expect(seg.className).not.toContain("flex-[1.6]");
      expect(seg.className).toContain("acento-trilho");
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
    const { getByText } = montar(<BarraPartes resolvido={INDISPONIVEL} totalBlocos={13} />);
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
    const { container } = montar(<BarraPartes resolvido={INDISPONIVEL} totalBlocos={13} />);
    await semViolacoes(container);
  });
});

/**
 * F7 — correção do Fable (17/09, 3ª rodada): o trilho carregava
 * `anim-decair-destaque-curta` PERMANENTEMENTE no `className`. Com o bloco
 * estático de `prefers-reduced-motion` (que pinta fundo/borda enquanto a
 * classe existir), o trilho ficaria verde-claro fixo a sessão inteira — um
 * sinal "preso". Agora a classe vem de `useRealceUmaVez(…, 1500)` e SAI ao
 * fim da duração. Relógio falso: asserção síncrona após montar prova nada
 * (é exatamente o verde falso que deixou 6 gatilhos mortos em produção);
 * a prova é "presente após 1 frame, ausente após a duração".
 */
describe("BarraPartes — F7, destaque do trilho é temporário (nunca preso em reduced-motion)", () => {
  const SELETOR_TRILHO_DIV = '[aria-hidden="true"].flex.w-\\[13rem\\]';
  const classe = (container: HTMLElement) => container.querySelector(SELETOR_TRILHO_DIV)!.classList.contains("anim-decair-destaque-curta");

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classe PRESENTE após 1 frame e AUSENTE após 1,5 s — casa com `.anim-decair-destaque-curta` (1.5s)", () => {
    const { container } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(classe(container)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(classe(container)).toBe(false);
  });

  it("troca de parte REACENDE o destaque; a mesma parte re-renderizada NÃO repete", () => {
    const { container, rerender } = montar(<BarraPartes resolvido={resolvido({ indice: 3 })} totalBlocos={13} />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(classe(container)).toBe(false);

    rerender(<BarraPartes resolvido={resolvido({ indice: 4 })} totalBlocos={13} />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(classe(container)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(classe(container)).toBe(false);
    // Mesma parte, outro re-render (ex.: confiança mudou): nada reacende.
    rerender(<BarraPartes resolvido={resolvido({ indice: 4, confianca: 0.9 })} totalBlocos={13} />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(classe(container)).toBe(false);
  });

  it("indisponível: NUNCA destaca — não há troca de parte a sinalizar", () => {
    const { container } = montar(<BarraPartes resolvido={INDISPONIVEL} totalBlocos={13} />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(classe(container)).toBe(false);
  });
});
