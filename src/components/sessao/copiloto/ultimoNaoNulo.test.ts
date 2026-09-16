import { describe, expect, it } from "vitest";
import type { SugestaoCopilotoPolling } from "@/types/copiloto";
import { ultimoNaoNulo } from "./ultimoNaoNulo";

/**
 * Extraído de `PainelCopiloto.test.tsx` na Fatia B da Fase 12 (tela vira
 * leitura) — função pura, movida junto com `ultimoNaoNulo` para
 * `src/components/sessao/copiloto/`, sem mudar nenhuma asserção.
 */
describe("ultimoNaoNulo — função pura", () => {
  const base = {
    ordem_evento: 0,
    gatilho: "intervalo" as const,
    confianca_geral: 0.8,
    sugestao: null,
    desfecho: null,
    criado_em: new Date().toISOString(),
  };

  it("devolve o valor mais recente quando existe e é visível", () => {
    const sugestoes: SugestaoCopilotoPolling[] = [
      { ...base, sugestao_id: "a", visivel: true, criado_em: "2026-09-15T10:00:00.000Z" },
      { ...base, sugestao_id: "b", visivel: true, criado_em: "2026-09-15T10:05:00.000Z" },
    ];
    const resultado = ultimoNaoNulo(sugestoes, (s) => (s.sugestao_id === "b" ? "valor-b" : null));
    expect(resultado).toEqual({ valor: "valor-b", sugestaoId: "b", criadoEm: "2026-09-15T10:05:00.000Z" });
  });

  it("percorre de trás para frente e devolve o PRIMEIRO não-nulo encontrado (o mais recente com dado)", () => {
    const sugestoes: SugestaoCopilotoPolling[] = [
      { ...base, sugestao_id: "a", visivel: true },
      { ...base, sugestao_id: "b", visivel: true },
      { ...base, sugestao_id: "c", visivel: true },
    ];
    // Só "a" e "c" têm valor — deve devolver "c" (o mais recente com dado), não "a".
    const resultado = ultimoNaoNulo(sugestoes, (s) => (s.sugestao_id === "a" || s.sugestao_id === "c" ? s.sugestao_id : null));
    expect(resultado?.sugestaoId).toBe("c");
  });

  it("ignora sugestão com visivel:false mesmo que ela tenha o dado — regra de confiança nunca é contornada", () => {
    const sugestoes: SugestaoCopilotoPolling[] = [
      { ...base, sugestao_id: "a", visivel: true, criado_em: "2026-09-15T10:00:00.000Z" },
      { ...base, sugestao_id: "b", visivel: false, criado_em: "2026-09-15T10:05:00.000Z" }, // mais recente, mas invisível
    ];
    const resultado = ultimoNaoNulo(sugestoes, () => "valor-qualquer");
    // Deveria pegar "a" (visível), nunca "b" (abaixo da confiança mínima).
    expect(resultado?.sugestaoId).toBe("a");
  });

  it("lista vazia ou nenhum valor encontrado: devolve null", () => {
    expect(ultimoNaoNulo([], () => "x")).toBeNull();
    const sugestoes: SugestaoCopilotoPolling[] = [{ ...base, sugestao_id: "a", visivel: true }];
    expect(ultimoNaoNulo(sugestoes, () => null)).toBeNull();
  });
});
