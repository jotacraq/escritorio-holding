import { describe, expect, it } from "vitest";
import {
  chaveFormularioValida,
  lerDefinicao,
  normalizarOpcoes,
  rotuloDaResposta,
  validarDefinicaoFormulario,
} from "./definicao";

/** Definição mínima que a chave `estrategico` aceita (tem p1, p2, p9 e p16). */
function base() {
  return [
    { id: "p1", bloco: "Identificação", tipo: "texto", rotulo: "Nome completo" },
    { id: "p2", bloco: "Identificação", tipo: "texto", rotulo: "Cidade" },
    {
      id: "p9",
      bloco: "Patrimônio",
      tipo: "unica",
      rotulo: "Faixa de patrimônio",
      opcoes: [
        { valor: "ate_500k", rotulo: "Até R$ 500 mil" },
        { valor: "acima_500k", rotulo: "Acima de R$ 500 mil" },
      ],
    },
    { id: "p16", bloco: "Dor", tipo: "texto_longo", rotulo: "O que mais preocupa?" },
  ];
}

const codigos = (definicao: unknown, chave?: string) =>
  validarDefinicaoFormulario(definicao, chave).map((e) => e.codigo);

describe("normalizarOpcoes", () => {
  it("lê o formato legado (array de string) traduzindo o slug", () => {
    expect(normalizarOpcoes(["viuvo", "casado"])).toEqual([
      { valor: "viuvo", rotulo: "Viúvo(a)" },
      { valor: "casado", rotulo: "Casado(a)" },
    ]);
  });

  it("lê o formato novo e preserva o rótulo escrito à mão", () => {
    expect(normalizarOpcoes([{ valor: "ate_500k", rotulo: "Até R$ 500 mil" }])).toEqual([
      { valor: "ate_500k", rotulo: "Até R$ 500 mil" },
    ]);
  });

  it("cai no fallback quando o objeto vem sem rótulo, e descarta lixo", () => {
    expect(normalizarOpcoes([{ valor: "uniao_estavel" }, { rotulo: "sem valor" }, 42, null, ""])).toEqual([
      { valor: "uniao_estavel", rotulo: "União estável" },
    ]);
  });

  it("devolve lista vazia para o que não é array — nunca explode", () => {
    expect(normalizarOpcoes(undefined)).toEqual([]);
    expect(normalizarOpcoes({ a: 1 })).toEqual([]);
  });
});

describe("rotuloDaResposta", () => {
  const pergunta = lerDefinicao(base())[2];

  it("traduz o valor gravado para o rótulo da versão em que foi respondido", () => {
    expect(rotuloDaResposta(pergunta, "ate_500k")).toBe("Até R$ 500 mil");
  });

  it("mostra o valor cru quando ele não existe mais nas opções (vazio é vazio)", () => {
    expect(rotuloDaResposta(pergunta, "faixa_extinta")).toBe("faixa_extinta");
  });

  it("junta múltipla escolha e trata ausência sem inventar", () => {
    expect(rotuloDaResposta(pergunta, ["ate_500k", "acima_500k"])).toBe("Até R$ 500 mil, Acima de R$ 500 mil");
    expect(rotuloDaResposta(pergunta, null)).toBe("");
    expect(rotuloDaResposta(null, "algo")).toBe("algo");
  });
});

describe("validarDefinicaoFormulario", () => {
  it("aceita a definição mínima da chave estrategico", () => {
    expect(validarDefinicaoFormulario(base(), "estrategico")).toEqual([]);
  });

  it("aceita a definição legada, com opções como texto solto", () => {
    const def = base();
    def[2].opcoes = ["ate_500k", "acima_500k"] as never;
    expect(validarDefinicaoFormulario(def, "estrategico")).toEqual([]);
  });

  it("recusa a remoção de pergunta lida pelo código", () => {
    const semP9 = base().filter((p) => p.id !== "p9");
    const erros = validarDefinicaoFormulario(semP9, "estrategico");
    expect(erros.map((e) => e.codigo)).toContain("pergunta_de_sistema_removida");
    expect(erros[0].pergunta).toBe("p9");
    // Outra chave não tem perguntas de sistema — a trava é só do POP 02.
    expect(validarDefinicaoFormulario(semP9, "outro_formulario")).toEqual([]);
  });

  it("recusa id inválido, id duplicado e lista vazia", () => {
    expect(codigos([])).toEqual(["definicao_vazia"]);
    expect(codigos("nada")).toEqual(["definicao_invalida"]);
    expect(codigos([{ id: "P9", bloco: "b", tipo: "texto", rotulo: "x" }])).toContain("id_invalido");
    expect(
      codigos([
        { id: "p1", bloco: "b", tipo: "texto", rotulo: "x" },
        { id: "p1", bloco: "b", tipo: "texto", rotulo: "y" },
      ]),
    ).toContain("id_duplicado");
  });

  it("recusa id que tenta escorregar para o protótipo", () => {
    expect(codigos([{ id: "__proto__", bloco: "b", tipo: "texto", rotulo: "x" }])).toContain("id_invalido");
    expect(codigos([{ id: "constructor", bloco: "b", tipo: "texto", rotulo: "x" }])).toContain("id_reservado");
    expect(codigos([{ id: "hasownproperty", bloco: "b", tipo: "texto", rotulo: "x" }])).toContain("id_reservado");
  });

  it("recusa escolha com menos de 2 opções, valor duplicado e opção onde não cabe", () => {
    const uma = base();
    uma[2].opcoes = [{ valor: "a", rotulo: "A" }];
    expect(codigos(uma, "estrategico")).toContain("opcoes_insuficientes");

    const duplicada = base();
    duplicada[2].opcoes = [
      { valor: "a", rotulo: "A" },
      { valor: "a", rotulo: "A de novo" },
    ];
    expect(codigos(duplicada, "estrategico")).toContain("valor_opcao_duplicado");

    const indevida = base();
    (indevida[0] as Record<string, unknown>).opcoes = ["x", "y"];
    expect(codigos(indevida, "estrategico")).toContain("opcoes_indevidas");
  });

  it("recusa condicional que aponta adiante, circular, ou com operador errado", () => {
    const adiante = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p99", igual: "a" } }];
    expect(codigos(adiante, "estrategico")).toContain("condicional_adiante");

    const circular = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p20", igual: "a" } }];
    expect(codigos(circular, "estrategico")).toContain("condicional_adiante");

    const contemSobreUnica = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p9", contem: "ate_500k" } }];
    expect(codigos(contemSobreUnica, "estrategico")).toContain("condicional_contem");

    const doisOperadores = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p9", igual: "ate_500k", contem: "ate_500k" } }];
    expect(codigos(doisOperadores, "estrategico")).toContain("condicional_operador");

    const valorInexistente = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p9", igual: "faixa_que_nao_existe" } }];
    expect(codigos(valorInexistente, "estrategico")).toContain("condicional_valor");
  });

  it("aceita condicional válida apontando para pergunta anterior", () => {
    const ok = [...base(), { id: "p20", bloco: "b", tipo: "texto", rotulo: "x", condicional: { depende_de: "p9", igual: "ate_500k" } }];
    expect(validarDefinicaoFormulario(ok, "estrategico")).toEqual([]);
  });

  it("recusa formulário maior que o teto", () => {
    const gigante = [
      ...base(),
      ...Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, bloco: "b", tipo: "texto", rotulo: "x" })),
    ];
    expect(codigos(gigante, "estrategico")).toContain("definicao_longa");
  });
});

describe("chaveFormularioValida", () => {
  it("aceita slug e recusa o resto", () => {
    expect(chaveFormularioValida("estrategico")).toBe(true);
    expect(chaveFormularioValida("Estrategico")).toBe(false);
    expect(chaveFormularioValida("")).toBe(false);
    expect(chaveFormularioValida(42)).toBe(false);
  });
});
