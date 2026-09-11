import { describe, expect, it } from "vitest";
import { aplicarEventoParticipante, compararComDecisores, normalizarNome } from "./participantes";

describe("normalizarNome", () => {
  it("remove acento, baixa caixa e colapsa espaço duplo", () => {
    expect(normalizarNome("  Terezinha   Sá ")).toBe("terezinha sa");
    expect(normalizarNome("CLEISON")).toBe("cleison");
  });
});

describe("aplicarEventoParticipante", () => {
  it("join acrescenta entrada nova com saiu_em nulo", () => {
    const resultado = aplicarEventoParticipante([], { tipo: "join", nome: "Terezinha", quando: "2026-09-11T10:00:00Z" });
    expect(resultado).toEqual([{ nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: null }]);
  });

  it("leave fecha a entrada aberta mais recente com o mesmo nome normalizado", () => {
    const atuais = [{ nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: null }];
    const resultado = aplicarEventoParticipante(atuais, { tipo: "leave", nome: "terezinha", quando: "2026-09-11T10:30:00Z" });
    expect(resultado).toEqual([{ nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: "2026-09-11T10:30:00Z" }]);
  });

  it("leave sem join correspondente é ignorado (silêncio, não erro)", () => {
    const resultado = aplicarEventoParticipante([], { tipo: "leave", nome: "Ninguém", quando: "2026-09-11T10:30:00Z" });
    expect(resultado).toEqual([]);
  });

  it("mesma pessoa pode entrar, sair e entrar de novo — histórico, não estado único", () => {
    let lista: unknown = [];
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Terezinha", quando: "10:00" });
    lista = aplicarEventoParticipante(lista, { tipo: "leave", nome: "Terezinha", quando: "10:05" });
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Terezinha", quando: "10:10" });
    expect(lista).toEqual([
      { nome: "Terezinha", entrou_em: "10:00", saiu_em: "10:05" },
      { nome: "Terezinha", entrou_em: "10:10", saiu_em: null },
    ]);
  });

  it("entrada não reconhecida no jsonb (formato inválido) é descartada, nunca lança", () => {
    const resultado = aplicarEventoParticipante([{ lixo: true }, "string solta", null], {
      tipo: "join",
      nome: "Cleison",
      quando: "10:00",
    });
    expect(resultado).toEqual([{ nome: "Cleison", entrou_em: "10:00", saiu_em: null }]);
  });
});

describe("compararComDecisores — camada 1 do §5, SEM IA", () => {
  it("caso do plano: 2 decisores esperados, só 1 presente — Cleison ausente é FATO", () => {
    const participantes = [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }];
    const resultado = compararComDecisores(["Terezinha", "Cleison"], participantes);

    expect(resultado.presentes).toEqual([{ nomeBriefing: "Terezinha", nomeParticipante: "Terezinha" }]);
    expect(resultado.ausentes).toEqual(["Cleison"]);
    expect(resultado.ambiguos).toEqual([]);
  });

  it("casamento é por nome NORMALIZADO (acento/caixa/espaço não impedem casar)", () => {
    const participantes = [{ nome: "TEREZINHA   SÁ", entrou_em: "10:00", saiu_em: null }];
    const resultado = compararComDecisores(["Terezinha Sá"], participantes);
    expect(resultado.presentes).toEqual([{ nomeBriefing: "Terezinha Sá", nomeParticipante: "TEREZINHA   SÁ" }]);
  });

  it("quem entrou e JÁ SAIU não conta como presente", () => {
    const participantes = [{ nome: "Cleison", entrou_em: "10:00", saiu_em: "10:05" }];
    const resultado = compararComDecisores(["Cleison"], participantes);
    expect(resultado.ausentes).toEqual(["Cleison"]);
    expect(resultado.presentes).toEqual([]);
  });

  it("AMBÍGUO NÃO CASA: 2 participantes presentes com o mesmo nome normalizado do decisor", () => {
    const participantes = [
      { nome: "João Silva", entrou_em: "10:00", saiu_em: null },
      { nome: "joão silva", entrou_em: "10:01", saiu_em: null },
    ];
    const resultado = compararComDecisores(["João Silva"], participantes);

    expect(resultado.ambiguos).toEqual(["João Silva"]);
    expect(resultado.presentes).toEqual([]);
    expect(resultado.ausentes).toEqual([]);
  });

  it("sem decisores esperados (briefing sem processo_decisorio.decisores) devolve listas vazias, nunca lança", () => {
    const resultado = compararComDecisores([], [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }]);
    expect(resultado.presentes).toEqual([]);
    expect(resultado.ausentes).toEqual([]);
    expect(resultado.ambiguos).toEqual([]);
    expect(resultado.participantesPresentes).toEqual(["Terezinha"]);
  });
});
