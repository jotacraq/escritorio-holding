import { describe, expect, it } from "vitest";
import { SEM_DADO, formatarData, formatarDataHora, formatarDataPura } from "./formatar";

/**
 * O furo que estes testes trancam (Fase 8, rodada FIX): uma coluna `date` do
 * Postgres não tem instante e, portanto, não tem fuso. Mandá-la para
 * `new Date("2026-09-07")` produz meia-noite **UTC**, que em São Paulo é 21h
 * do dia **anterior** — a edição que começa em 07/09 aparecia como 06/09 em
 * Admin → Edições, e o mesmo em Parâmetros e no Repertório. Cada tela
 * consertou por fora; agora o conserto é da função.
 */
describe("formatarDataPura", () => {
  it("formata `date` do Postgres sem passar por fuso nenhum", () => {
    expect(formatarDataPura("2026-09-07")).toBe("07/09/2026");
    expect(formatarDataPura("2026-01-01")).toBe("01/01/2026");
    expect(formatarDataPura("2026-12-31")).toBe("31/12/2026");
  });

  it("aceita `date` com hora colada (o que algumas views devolvem)", () => {
    expect(formatarDataPura("2026-09-07T00:00:00")).toBe("07/09/2026");
  });

  it("sem dado devolve o travessão, nunca uma data plausível", () => {
    expect(formatarDataPura(null)).toBe(SEM_DADO);
    expect(formatarDataPura(undefined)).toBe(SEM_DADO);
    expect(formatarDataPura("")).toBe(SEM_DADO);
    expect(formatarDataPura("amanhã")).toBe(SEM_DADO);
  });
});

describe("formatarData", () => {
  it("coluna `date` NÃO volta um dia (a regressão que motivou o conserto)", () => {
    expect(formatarData("2026-09-07")).toBe("07/09/2026");
    expect(formatarData("2026-01-01")).toBe("01/01/2026");
  });

  it("timestamp continua convertido para America/Sao_Paulo", () => {
    // 00:30 UTC de 08/09 é 21:30 de 07/09 em São Paulo — aqui a conversão é
    // certa, porque o valor É um instante.
    expect(formatarData("2026-09-08T00:30:00Z")).toBe("07/09/2026");
    expect(formatarData("2026-09-07T15:00:00Z")).toBe("07/09/2026");
    expect(formatarDataHora("2026-09-08T00:30:00Z")).toBe("07/09/2026, 21:30");
  });

  it("sem dado e lixo devolvem travessão", () => {
    expect(formatarData(null)).toBe(SEM_DADO);
    expect(formatarData("qualquer coisa")).toBe(SEM_DADO);
  });
});
