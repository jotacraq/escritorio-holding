import { describe, expect, it } from "vitest";
import type { RoteiroBloco, RoteiroDefinicao } from "@/types/roteiro";
import { contarMudancas, diffRoteiro, temFalaDeSim } from "./diff";

function bloco(parcial: Partial<RoteiroBloco> & { id: string }): RoteiroBloco {
  return {
    titulo: "Abertura",
    objetivo: null,
    acao: null,
    falas: [],
    campos: [],
    observar: [],
    proibido: [],
    ...parcial,
  };
}

function roteiro(...blocos: RoteiroBloco[]): RoteiroDefinicao {
  return { blocos };
}

const ATIVA = roteiro(
  bloco({
    id: "b1",
    titulo: "Abertura",
    objetivo: "Criar contexto",
    falas: [
      { id: "f1", locutor: "Advogada", texto: "Esta conversa é sigilosa e será gravada.", sim: "sigilo_gravacao", rotulo_sim: "Sigilo e gravação" },
      { id: "f2", locutor: null, texto: "Me conta o que te trouxe aqui." },
    ],
    campos: [{ id: "c1", rotulo: "Objeção principal", tipo: "texto" }],
    observar: ["Ritmo da fala"],
    proibido: ["Prometer resultado"],
  }),
  bloco({ id: "b2", titulo: "Diagnóstico", acao: "Abrir o croqui" }),
);

describe("diffRoteiro", () => {
  it("duas versões iguais não têm diferença nenhuma", () => {
    expect(diffRoteiro(ATIVA, ATIVA)).toEqual([]);
    expect(contarMudancas(diffRoteiro(ATIVA, ATIVA))).toBe(0);
  });

  it("aguenta definição nula dos dois lados (versão sem roteiro ainda)", () => {
    expect(diffRoteiro(null, null)).toEqual([]);
    expect(diffRoteiro(undefined, roteiro())).toEqual([]);
  });

  it("bloco novo entra inteiro como adicionado", () => {
    const candidata = roteiro(...ATIVA.blocos, bloco({ id: "b3", titulo: "Fechamento", falas: [{ id: "f9", locutor: null, texto: "Próximo passo." }] }));
    const diff = diffRoteiro(ATIVA, candidata);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ blocoId: "b3", bloco: "Fechamento", situacao: "adicionado" });
    expect(diff[0].itens).toEqual([{ tipo: "fala", id: "f9", situacao: "adicionado", antes: null, depois: "Próximo passo." }]);
  });

  it("bloco que sumiu vira removido, com o conteúdo que se perde", () => {
    const candidata = roteiro(ATIVA.blocos[0]);
    const diff = diffRoteiro(ATIVA, candidata);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ blocoId: "b2", situacao: "removido" });
    expect(diff[0].itens).toEqual([{ tipo: "acao", id: "acao", situacao: "removido", antes: "Abrir o croqui", depois: null }]);
  });

  it("casa fala por id — reordenar não é alteração", () => {
    const invertida = roteiro(bloco({ ...ATIVA.blocos[0], falas: [...ATIVA.blocos[0].falas].reverse() }), ATIVA.blocos[1]);
    expect(diffRoteiro(ATIVA, invertida)).toEqual([]);
  });

  it("texto alterado aparece lado a lado, com o id da fala", () => {
    const candidata = roteiro(
      bloco({ ...ATIVA.blocos[0], falas: [ATIVA.blocos[0].falas[0], { id: "f2", locutor: null, texto: "O que te trouxe aqui?" }] }),
      ATIVA.blocos[1],
    );
    const diff = diffRoteiro(ATIVA, candidata);
    expect(diff[0].itens).toEqual([
      { tipo: "fala", id: "f2", situacao: "alterado", antes: "Me conta o que te trouxe aqui.", depois: "O que te trouxe aqui?" },
    ]);
  });

  it("troca de locutor e de marca de SIM entram no texto comparado", () => {
    const candidata = roteiro(
      bloco({ ...ATIVA.blocos[0], falas: [{ id: "f1", locutor: "Assistente", texto: "Esta conversa é sigilosa e será gravada." }, ATIVA.blocos[0].falas[1]] }),
      ATIVA.blocos[1],
    );
    const item = diffRoteiro(ATIVA, candidata)[0].itens[0];
    expect(item.situacao).toBe("alterado");
    expect(item.antes).toContain("Advogada:");
    expect(item.antes).toContain("[marca de SIM: sigilo_gravacao]");
    expect(item.depois).toContain("Assistente:");
    expect(item.depois).not.toContain("marca de SIM");
  });

  it("renomear bloco não passa despercebido", () => {
    const candidata = roteiro(bloco({ ...ATIVA.blocos[0], titulo: "Acolhimento" }), ATIVA.blocos[1]);
    const diff = diffRoteiro(ATIVA, candidata);
    expect(diff[0].bloco).toBe("Acolhimento");
    expect(diff[0].itens).toEqual([{ tipo: "titulo", id: "titulo", situacao: "alterado", antes: "Abertura", depois: "Acolhimento" }]);
  });

  it("campo com opções novas é alteração legível", () => {
    const candidata = roteiro(
      bloco({ ...ATIVA.blocos[0], campos: [{ id: "c1", rotulo: "Objeção principal", tipo: "unica", opcoes: ["preço", "tempo"] }] }),
      ATIVA.blocos[1],
    );
    const item = diffRoteiro(ATIVA, candidata)[0].itens[0];
    expect(item).toMatchObject({ tipo: "campo", id: "c1", situacao: "alterado" });
    expect(item.depois).toBe("Objeção principal — unica (preço · tempo)");
  });

  it("observar/proibido casam por valor: some o que saiu, entra o que entrou", () => {
    const candidata = roteiro(bloco({ ...ATIVA.blocos[0], observar: ["Ritmo da fala", "Quem decide"], proibido: [] }), ATIVA.blocos[1]);
    const itens = diffRoteiro(ATIVA, candidata)[0].itens;
    expect(itens).toEqual([
      { tipo: "observar", id: "observar-1", situacao: "adicionado", antes: null, depois: "Quem decide" },
      { tipo: "proibido", id: "proibido-1", situacao: "removido", antes: "Prometer resultado", depois: null },
    ]);
  });

  it("conta o total de mudanças para a linha de resumo", () => {
    const candidata = roteiro(bloco({ ...ATIVA.blocos[0], titulo: "Acolhimento", objetivo: "Outro" }));
    expect(contarMudancas(diffRoteiro(ATIVA, candidata))).toBe(3); // título, objetivo e o bloco b2 removido
  });
});

describe("temFalaDeSim", () => {
  it("acha a fala do 1º SIM na versão ativa", () => {
    expect(temFalaDeSim(ATIVA, "sigilo_gravacao")).toBe(true);
  });

  it("acusa a falta — é o que trava o início da sessão", () => {
    const semSim = roteiro(bloco({ ...ATIVA.blocos[0], falas: [{ id: "f1", locutor: "Advogada", texto: "Vamos começar." }] }));
    expect(temFalaDeSim(semSim, "sigilo_gravacao")).toBe(false);
    expect(temFalaDeSim(null, "sigilo_gravacao")).toBe(false);
    expect(temFalaDeSim(ATIVA, "decisores")).toBe(false);
  });
});
