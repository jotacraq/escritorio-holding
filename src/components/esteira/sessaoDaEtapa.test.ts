import { describe, expect, it } from "vitest";
import { ORDEM_FASES, ROTULO_FASE, SESSAO_POR_ETAPA, agruparColunasPorSessao, faseDaEtapa } from "./sessaoDaEtapa";
import type { EtapaJornada } from "@/types/banco";

const ETAPAS: EtapaJornada[] = [
  "captado",
  "qualificado",
  "sessao_contratada",
  "sessao_agendada",
  "sessao_realizada",
  "croqui_contratado",
  "croqui_apresentado",
  "holding_contratada",
];

describe("faseDaEtapa", () => {
  it("cobre TODAS as etapas do enum — etapa nova sem fase é coluna sem casa", () => {
    for (const etapa of ETAPAS) expect(SESSAO_POR_ETAPA[etapa]).toBeDefined();
  });

  it("mapeia cada etapa para a sessão que o produto vende", () => {
    expect(faseDaEtapa("sessao_agendada")).toBe("viabilidade");
    expect(faseDaEtapa("croqui_apresentado")).toBe("croqui");
    expect(faseDaEtapa("holding_contratada")).toBe("entrega");
  });

  it("etapa desconhecida cai na primeira fase, e não some da tela", () => {
    expect(faseDaEtapa("etapa_que_o_banco_inventou")).toBe("viabilidade");
  });
});

describe("ROTULO_FASE", () => {
  it("tem rótulo para as três fases, na ordem do produto", () => {
    expect(ORDEM_FASES).toEqual(["viabilidade", "croqui", "entrega"]);
    for (const fase of ORDEM_FASES) expect(ROTULO_FASE[fase].length).toBeGreaterThan(0);
  });

  it("não usa jargão de funil em nenhum rótulo", () => {
    const proibidas = /pipeline|funil|\bdeal\b|lead/i;
    for (const fase of ORDEM_FASES) expect(ROTULO_FASE[fase]).not.toMatch(proibidas);
  });
});

describe("agruparColunasPorSessao", () => {
  it("não perde coluna nenhuma", () => {
    const colunas = ETAPAS.map((etapa) => ({ etapa }));
    const grupos = agruparColunasPorSessao(colunas);
    expect(grupos.flatMap((g) => g.colunas)).toHaveLength(ETAPAS.length);
  });

  it("omite a faixa que ficou sem coluna (é o que o filtro por fase produz)", () => {
    const grupos = agruparColunasPorSessao([{ etapa: "croqui_contratado" }]);
    expect(grupos.map((g) => g.chave)).toEqual(["croqui"]);
  });
});
