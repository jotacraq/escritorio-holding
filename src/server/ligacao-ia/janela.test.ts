import { describe, expect, it } from "vitest";
import { JANELA_PADRAO, dentroDaJanela, proximaAbertura, rotuloAbertura, sanitizarJanela, type JanelaDiscagem } from "./janela";

/**
 * A janela existe para o telefone do cliente não tocar às 3 da manhã. Todo
 * teste aqui fixa o instante em UTC e confere o efeito no fuso da janela —
 * nunca no fuso da máquina que roda o teste (o CI e o Windows do João não estão
 * no mesmo lugar).
 */

/** 2026-09-08 é uma TERÇA-FEIRA. -03:00 em São Paulo (sem horário de verão desde 2019). */
const TERCA_12H_SP = new Date("2026-09-08T15:00:00Z"); // 12:00 em SP
const TERCA_03H_SP = new Date("2026-09-08T06:00:00Z"); // 03:00 em SP
const TERCA_22H_SP = new Date("2026-09-08T01:00:00Z"); // 22:00 de SEGUNDA 07/09 em SP
const SABADO_12H_SP = new Date("2026-09-12T15:00:00Z"); // sábado 12:00 em SP

describe("sanitizarJanela", () => {
  it("aceita a janela bem formada como está", () => {
    const j: JanelaDiscagem = { dias: [1, 3, 5], inicio: "08:30", fim: "18:00", fuso: "America/Sao_Paulo" };
    expect(sanitizarJanela(j)).toEqual(j);
  });

  it("cai para o padrão quando o valor não é objeto (chave ausente, 0073 não aplicada)", () => {
    expect(sanitizarJanela(null)).toEqual(JANELA_PADRAO);
    expect(sanitizarJanela("09:00-19:00")).toEqual(JANELA_PADRAO);
    expect(sanitizarJanela([1, 2, 3])).toEqual(JANELA_PADRAO);
  });

  it("descarta dia fora de 0..6, duplicado e não inteiro, e ordena", () => {
    expect(sanitizarJanela({ ...JANELA_PADRAO, dias: [5, 1, 1, 9, -2, 3.5] }).dias).toEqual([1, 5]);
  });

  it("hora malformada cai para a do padrão, sem derrubar o resto", () => {
    const j = sanitizarJanela({ dias: [2], inicio: "9h", fim: "25:00", fuso: "America/Sao_Paulo" });
    expect(j).toEqual({ dias: [2], inicio: "09:00", fim: "19:00", fuso: "America/Sao_Paulo" });
  });

  it("fuso desconhecido cai para America/Sao_Paulo", () => {
    expect(sanitizarJanela({ ...JANELA_PADRAO, fuso: "Marte/Olympus" }).fuso).toBe("America/Sao_Paulo");
  });

  it("janela sem dia nenhum vira o padrão — nunca 'não liga nunca' em silêncio", () => {
    expect(sanitizarJanela({ ...JANELA_PADRAO, dias: [] }).dias).toEqual([1, 2, 3, 4, 5]);
  });

  it("fim <= inicio é impossível: mantém os dias e volta ao horário padrão", () => {
    expect(sanitizarJanela({ dias: [0], inicio: "19:00", fim: "09:00", fuso: "America/Sao_Paulo" })).toEqual({
      dias: [0],
      inicio: "09:00",
      fim: "19:00",
      fuso: "America/Sao_Paulo",
    });
  });
});

describe("dentroDaJanela", () => {
  it("terça ao meio-dia está dentro do padrão seg–sex 9h–19h", () => {
    expect(dentroDaJanela(TERCA_12H_SP, JANELA_PADRAO)).toBe(true);
  });

  it("terça às 3h da manhã está fora", () => {
    expect(dentroDaJanela(TERCA_03H_SP, JANELA_PADRAO)).toBe(false);
  });

  it("segunda às 22h está fora", () => {
    expect(dentroDaJanela(TERCA_22H_SP, JANELA_PADRAO)).toBe(false);
  });

  it("sábado ao meio-dia está fora (dia não permitido)", () => {
    expect(dentroDaJanela(SABADO_12H_SP, JANELA_PADRAO)).toBe(false);
  });

  it("o fim é exclusivo e o início inclusivo", () => {
    expect(dentroDaJanela(new Date("2026-09-08T12:00:00Z"), JANELA_PADRAO)).toBe(true); // 09:00 em SP
    expect(dentroDaJanela(new Date("2026-09-08T11:59:00Z"), JANELA_PADRAO)).toBe(false); // 08:59
    expect(dentroDaJanela(new Date("2026-09-08T22:00:00Z"), JANELA_PADRAO)).toBe(false); // 19:00
    expect(dentroDaJanela(new Date("2026-09-08T21:59:00Z"), JANELA_PADRAO)).toBe(true); // 18:59
  });

  it("respeita o fuso configurado: a MESMA hora UTC dá dentro em Lisboa e fora em SP", () => {
    const instante = new Date("2026-09-08T08:00:00Z"); // 05:00 SP · 09:00 Lisboa
    expect(dentroDaJanela(instante, JANELA_PADRAO)).toBe(false);
    expect(dentroDaJanela(instante, { ...JANELA_PADRAO, fuso: "Europe/Lisbon" })).toBe(true);
  });

  it("data inválida nunca é 'dentro'", () => {
    expect(dentroDaJanela(new Date("nada"), JANELA_PADRAO)).toBe(false);
  });
});

describe("proximaAbertura", () => {
  it("dentro da janela devolve o próprio instante (não empurra a retentativa)", () => {
    expect(proximaAbertura(TERCA_12H_SP, JANELA_PADRAO).toISOString()).toBe(TERCA_12H_SP.toISOString());
  });

  it("de madrugada abre às 9h do mesmo dia", () => {
    expect(proximaAbertura(TERCA_03H_SP, JANELA_PADRAO).toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });

  it("depois do fim abre às 9h do dia seguinte útil", () => {
    // terça 20:00 em SP -> quarta 09:00 em SP
    expect(proximaAbertura(new Date("2026-09-08T23:00:00Z"), JANELA_PADRAO).toISOString()).toBe("2026-09-09T12:00:00.000Z");
  });

  it("sexta à noite pula o fim de semana e abre na segunda", () => {
    // sexta 11/09/2026 20:00 SP -> segunda 14/09 09:00 SP
    expect(proximaAbertura(new Date("2026-09-11T23:00:00Z"), JANELA_PADRAO).toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  it("janela de um dia só volta em uma semana", () => {
    const soQuarta: JanelaDiscagem = { dias: [3], inicio: "09:00", fim: "10:00", fuso: "America/Sao_Paulo" };
    // quarta 09/09 11:00 SP (já passou das 10h) -> quarta 16/09 09:00 SP
    expect(proximaAbertura(new Date("2026-09-09T14:00:00Z"), soQuarta).toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });

  it("é idempotente: aplicar duas vezes não muda o resultado", () => {
    const uma = proximaAbertura(TERCA_03H_SP, JANELA_PADRAO);
    expect(proximaAbertura(uma, JANELA_PADRAO).toISOString()).toBe(uma.toISOString());
  });

  it("o resultado devolvido está sempre dentro da janela", () => {
    for (const inicio of ["2026-09-05T04:00:00Z", "2026-09-08T06:00:00Z", "2026-09-12T15:00:00Z", "2026-09-13T23:00:00Z"]) {
      expect(dentroDaJanela(proximaAbertura(new Date(inicio), JANELA_PADRAO), JANELA_PADRAO)).toBe(true);
    }
  });
});

describe("rotuloAbertura", () => {
  it("fala como gente, no fuso da janela", () => {
    expect(rotuloAbertura(new Date("2026-09-14T12:00:00Z"), "America/Sao_Paulo")).toBe("segunda-feira, 14 de setembro, às 9h");
  });

  it("mostra os minutos quando não são zero", () => {
    expect(rotuloAbertura(new Date("2026-09-14T12:30:00Z"), "America/Sao_Paulo")).toBe("segunda-feira, 14 de setembro, às 9h30");
  });
});
