// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { ComparacaoDecisoresPresentes } from "@/types/copiloto";
import { ApresentacaoComparacaoDecisores, resumoAusentesLinhaFina } from "./ApresentacaoComparacaoDecisores";

/**
 * Movido de `PainelCopiloto.test.tsx` na Fase 12, Fatia B (tela vira
 * leitura) — `ApresentacaoComparacaoDecisores` deixou de ser um dos quadros
 * do mosaico e foi extraído para arquivo próprio; a trava vale igual no
 * destino, nenhuma asserção mudou. `ApresentacaoComparacaoDecisores` —
 * componente PURO (Fatia 4, camada 1 do §5, ZERO IA).
 */
describe("ApresentacaoComparacaoDecisores — fato participantes x decisores, sem IA", () => {
  it("apresenta como FATO, com as duas fontes visíveis (briefing x sala)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("O briefing esperava 2 decisores: Terezinha, Cleison");
    expect(container.textContent).toContain("Na sala: Terezinha");
  });

  it("ausentes: FATO afirmado diretamente — 'não entrou na sala'", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    expect(container.textContent).toContain("Não entrou na sala");
    expect(container.textContent).toContain("Cleison");
  });

  it("ambiguos: NUNCA 'ausente' — sempre 'não foi possível confirmar'", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Cleison"],
      participantes_presentes: ["Cleison Roberto"],
      presentes: [],
      ausentes: [],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("Não foi possível confirmar");
    expect(container.textContent).toContain("Cleison");
    // A palavra "ausente"/"Não entrou" NUNCA aparece para um nome ambíguo —
    // é a garantia central do achado: falso "decisor ausente" faz a
    // advogada agir errado com a família na frente dela.
    expect(container.textContent).not.toContain("Não entrou na sala");
    expect(container.textContent).not.toMatch(/ausente/i);
  });

  it("ausentes e ambiguos ao mesmo tempo: cada um com seu próprio tratamento, nunca misturados", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison", "Maria"],
      participantes_presentes: ["Terezinha", "Cleison Roberto"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Maria"],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("Não entrou na sala");
    expect(container.textContent).toContain("Maria");
    expect(container.textContent).toContain("Não foi possível confirmar");
    expect(container.textContent).toContain("Cleison");
    // "Maria" nunca aparece na frase de ambíguo, "Cleison" nunca na de ausente.
    const blocoAusente = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.includes("Não entrou na sala"))?.parentElement;
    expect(blocoAusente?.textContent).not.toContain("Cleison");
  });

  it("sem decisores esperados: não renderiza nada (nunca um card vazio confuso)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: [],
      participantes_presentes: [],
      presentes: [],
      ausentes: [],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    expect(container.textContent).toBe("");
  });

  it("nome de participante é texto puro — nunca interpretado como HTML (defesa contra XSS via nome)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ['<img src=x onerror="window.__pwned=true">'],
      participantes_presentes: [],
      presentes: [],
      ausentes: ['<img src=x onerror="window.__pwned=true">'],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    // O nome aparece como TEXTO — nenhum elemento <img> foi criado a partir dele.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("axe limpo: fato com ausentes e ambiguos", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison", "Maria"],
      participantes_presentes: ["Terezinha", "Cleison Roberto"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Maria"],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    await semViolacoes(container);
  });
});

/**
 * `resumoAusentesLinhaFina` — Fase 12, Fatia B: a linha fina do topo de
 * `ConduzirSessaoApp.tsx` resume a mesma comparação em UMA frase, só quando
 * há alguém ausente. `ambiguos` nunca vira afirmação de ausência aqui
 * também — mesma garantia do componente cheio, aplicada ao resumo curto.
 */
describe("resumoAusentesLinhaFina — resumo de uma linha para a linha fina", () => {
  it("null quando não há comparação", () => {
    expect(resumoAusentesLinhaFina(null)).toBeNull();
  });

  it("null quando ninguém está ausente (só ambíguo, ou todos presentes)", () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Cleison"],
      participantes_presentes: ["Cleison Roberto"],
      presentes: [],
      ausentes: [],
      ambiguos: ["Cleison"],
    };
    expect(resumoAusentesLinhaFina(comparacao)).toBeNull();
  });

  it("um ausente: frase no singular", () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    expect(resumoAusentesLinhaFina(comparacao)).toBe("Cleison não está na sala");
  });

  it("mais de um ausente: frase no plural", () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison", "Maria"],
      participantes_presentes: [],
      presentes: [],
      ausentes: ["Cleison", "Maria"],
      ambiguos: [],
    };
    expect(resumoAusentesLinhaFina(comparacao)).toBe("Cleison, Maria não estão na sala");
  });
});
