import { describe, expect, it } from "vitest";
import {
  LIMITE_OPCOES,
  chaveFormularioValida,
  lerDefinicao,
  normalizarOpcoes,
  perguntaVisivel,
  perguntasDeSistema,
  rotuloDaResposta,
  validarDefinicao,
  prepararParaPublicar,
  resumoDaDefinicao,
  textoDaResposta,
  validarDefinicaoNoCliente,
  type PerguntaDefinicao,
} from "./definicao";

/** Duas perguntas mínimas válidas, para montar casos sem repetir 10 linhas. */
function pergunta(parcial: Partial<PerguntaDefinicao> & { id: string }): PerguntaDefinicao {
  return { bloco: "Sobre você", tipo: "texto", rotulo: "Qual seu nome?", ...parcial };
}

/** A definição mínima que a chave `estrategico` aceita: as 4 de sistema. */
function definicaoDeSistema(): PerguntaDefinicao[] {
  return [
    pergunta({ id: "p1", rotulo: "Nome completo" }),
    pergunta({ id: "p2", rotulo: "Cidade" }),
    pergunta({ id: "p9", rotulo: "Faixa de patrimônio", tipo: "unica", opcoes: ["ate_1mi", "acima_2mi"] }),
    pergunta({ id: "p16", rotulo: "O que mais te preocupa?", tipo: "texto_longo" }),
  ];
}

function codigos(problemas: { codigo: string }[]): string[] {
  return problemas.map((p) => p.codigo);
}

/**
 * A regra de visibilidade é a mesma nos TRÊS lugares onde o formulário existe:
 * a tela do cliente (`CampoPerguntaPublico` reexporta esta função), a Ficha
 * (`ficha360/FormularioAba`) e o banco (`responder_formulario_publico`, 0082,
 * que a espelha em plpgsql). Estes casos são o contrato do espelho: se um
 * deles mudar aqui, a migration tem de mudar junto.
 */
describe("perguntaVisivel — a condicional, e o espelho da 0082", () => {
  const semCondicional = pergunta({ id: "p1" });
  const porContem = pergunta({ id: "p11", condicional: { depende_de: "p10", contem: "imoveis" } });
  const porIgual = pergunta({ id: "p13", condicional: { depende_de: "p9", igual: "acima_500k" } });

  it("pergunta sem condicional aparece sempre, mesmo sem nenhuma resposta", () => {
    expect(perguntaVisivel(semCondicional, {})).toBe(true);
  });

  it("`contem` só aparece quando a resposta é LISTA que contém o valor", () => {
    expect(perguntaVisivel(porContem, { p10: ["imoveis", "empresas"] })).toBe(true);
    expect(perguntaVisivel(porContem, { p10: ["empresas"] })).toBe(false);
    expect(perguntaVisivel(porContem, { p10: [] })).toBe(false);
    expect(perguntaVisivel(porContem, {})).toBe(false);
  });

  it("`contem` sobre resposta que NÃO é lista esconde a pergunta", () => {
    // Este é o caso que separa o espelho do palpite: um `@>` ingênuo no SQL
    // mostraria a pergunta, e o cliente levaria `resposta_obrigatoria` de algo
    // que a tela dele nunca desenhou.
    expect(perguntaVisivel(porContem, { p10: "imoveis" })).toBe(false);
    expect(perguntaVisivel(porContem, { p10: null })).toBe(false);
  });

  it("`igual` compara por identidade — tipo diferente não casa", () => {
    expect(perguntaVisivel(porIgual, { p9: "acima_500k" })).toBe(true);
    expect(perguntaVisivel(porIgual, { p9: "ate_500k" })).toBe(false);
    expect(perguntaVisivel(porIgual, { p9: ["acima_500k"] })).toBe(false);
    expect(perguntaVisivel(porIgual, {})).toBe(false);
  });

  it("`igual` sobre sim/não segue o valor gravado, não o rótulo da tela", () => {
    const p = pergunta({ id: "p12", condicional: { depende_de: "p4", igual: "sim" } });
    expect(perguntaVisivel(p, { p4: "sim" })).toBe(true);
    expect(perguntaVisivel(p, { p4: "Sim" })).toBe(false);
  });

  it("condicional sem operador nenhum não esconde nada", () => {
    // `prepararParaPublicar` já descarta a condicional pela metade, mas
    // definição legada gravada não é reescrita: ela tem de continuar visível.
    const meia = { ...pergunta({ id: "p11" }), condicional: { depende_de: "p10" } };
    expect(perguntaVisivel(meia, {})).toBe(true);
  });

  it("uma pergunta oculta não é cobrada: é o contrato que a 0082 aplica no banco", () => {
    const obrigatoriaOculta = pergunta({ id: "p11", obrigatoria: true, condicional: { depende_de: "p10", contem: "imoveis" } });
    const respostas = { p10: ["empresas"] };
    expect(perguntaVisivel(obrigatoriaOculta, respostas)).toBe(false);
    // Quem cobra é quem filtra por visibilidade antes — tela e RPC. O teste
    // trava o predicado; o roteiro `scripts/verificacao-0082.sql` trava a RPC.
    expect(perguntaVisivel(obrigatoriaOculta, { p10: ["imoveis"] })).toBe(true);
  });
});

describe("normalizarOpcoes", () => {
  it("lê o formato legado (string crua) e usa rotuloOpcao como texto", () => {
    expect(normalizarOpcoes(["viuvo", "casado"])).toEqual([
      { valor: "viuvo", rotulo: "Viúvo(a)" },
      { valor: "casado", rotulo: "Casado(a)" },
    ]);
  });

  it("lê o formato novo {valor,rotulo} sem tocar no rótulo escrito pela advogada", () => {
    expect(normalizarOpcoes([{ valor: "acima_2mi", rotulo: "Acima de R$ 2 mi" }])).toEqual([{ valor: "acima_2mi", rotulo: "Acima de R$ 2 mi" }]);
  });

  it("aceita os dois formatos na mesma lista (versão publicada durante a transição)", () => {
    expect(normalizarOpcoes(["viuvo", { valor: "casado", rotulo: "Casado ou em união" }])).toEqual([
      { valor: "viuvo", rotulo: "Viúvo(a)" },
      { valor: "casado", rotulo: "Casado ou em união" },
    ]);
  });

  it("cai no rótulo derivado quando o rótulo vem vazio ou não é texto", () => {
    expect(normalizarOpcoes([{ valor: "uniao_estavel", rotulo: "   " }])).toEqual([{ valor: "uniao_estavel", rotulo: "União estável" }]);
    expect(normalizarOpcoes([{ valor: "uniao_estavel", rotulo: 42 }])).toEqual([{ valor: "uniao_estavel", rotulo: "União estável" }]);
  });

  it("descarta lixo em vez de derrubar o formulário do cliente", () => {
    expect(normalizarOpcoes(undefined)).toEqual([]);
    expect(normalizarOpcoes(null)).toEqual([]);
    expect(normalizarOpcoes("viuvo")).toEqual([]);
    expect(normalizarOpcoes([null, 7, {}, { rotulo: "sem valor" }, "  "])).toEqual([]);
  });

  it("não deixa nome de protótipo virar rótulo do protótipo", () => {
    expect(normalizarOpcoes(["__proto__", "constructor"])).toEqual([
      { valor: "__proto__", rotulo: "__proto__" },
      { valor: "constructor", rotulo: "Constructor" },
    ]);
  });
});

describe("textoDaResposta", () => {
  const estadoCivil = pergunta({ id: "p5", tipo: "unica", rotulo: "Estado civil", opcoes: ["viuvo", "casado"] });
  const bens = pergunta({ id: "p10", tipo: "multipla", rotulo: "Bens", opcoes: [{ valor: "imoveis", rotulo: "Imóveis" }, { valor: "empresas", rotulo: "Empresas" }] });

  it("mostra o rótulo, não o valor gravado", () => {
    expect(textoDaResposta(estadoCivil, "casado")).toBe("Casado(a)");
    expect(textoDaResposta(bens, ["imoveis", "empresas"])).toBe("Imóveis, Empresas");
  });

  it("traduz sim/não e devolve texto livre como está", () => {
    expect(textoDaResposta(pergunta({ id: "p7", tipo: "sim_nao", rotulo: "Tem filhos?" }), "sim")).toBe("Sim");
    expect(textoDaResposta(pergunta({ id: "p7", tipo: "sim_nao", rotulo: "Tem filhos?" }), "nao")).toBe("Não");
    expect(textoDaResposta(pergunta({ id: "p1", rotulo: "Nome" }), "Joana Prado")).toBe("Joana Prado");
  });

  it("vazio é vazio — nunca traço nem zero", () => {
    expect(textoDaResposta(estadoCivil, undefined)).toBe("");
    expect(textoDaResposta(estadoCivil, null)).toBe("");
    expect(textoDaResposta(estadoCivil, "")).toBe("");
    expect(textoDaResposta(bens, [])).toBe("");
  });

  it("resposta antiga que não existe mais nas opções continua legível", () => {
    expect(textoDaResposta(estadoCivil, "uniao_estavel")).toBe("União estável");
  });
});

describe("validarDefinicaoNoCliente", () => {
  it("aprova a definição mínima da chave estrategico", () => {
    expect(validarDefinicaoNoCliente(definicaoDeSistema(), "estrategico")).toEqual([]);
  });

  it("recusa definição vazia", () => {
    expect(codigos(validarDefinicaoNoCliente([], "estrategico"))).toEqual(["definicao_vazia"]);
  });

  it("recusa id fora do formato e id repetido", () => {
    const problemas = validarDefinicaoNoCliente([pergunta({ id: "P-9" }), pergunta({ id: "p1" }), pergunta({ id: "p1" })]);
    expect(codigos(problemas)).toContain("id_invalido");
    expect(codigos(problemas)).toContain("id_duplicado");
  });

  it("exige bloco, enunciado e tipo conhecido", () => {
    const problemas = validarDefinicaoNoCliente([
      pergunta({ id: "p1", bloco: "  ", rotulo: "  ", tipo: "curinga" as unknown as PerguntaDefinicao["tipo"] }),
    ]);
    expect(codigos(problemas)).toEqual(expect.arrayContaining(["bloco_invalido", "rotulo_invalido", "tipo_invalido"]));
  });

  it("exige 2 opções em escolha e recusa opção em pergunta de texto", () => {
    expect(codigos(validarDefinicaoNoCliente([pergunta({ id: "p3", tipo: "unica", opcoes: ["so_uma"] })]))).toContain("opcoes_insuficientes");
    expect(codigos(validarDefinicaoNoCliente([pergunta({ id: "p3", tipo: "texto", opcoes: ["a", "b"] })]))).toContain("opcoes_indevidas");
  });

  it("recusa valor de opção repetido, ainda que os rótulos difiram", () => {
    const problemas = validarDefinicaoNoCliente([
      pergunta({ id: "p3", tipo: "unica", opcoes: [{ valor: "sim", rotulo: "Sim" }, { valor: "sim", rotulo: "Claro" }] }),
    ]);
    expect(codigos(problemas)).toContain("valor_opcao_duplicado");
  });

  it("condicional só pode apontar para pergunta anterior — inclusive contra si mesma", () => {
    const adiante = validarDefinicaoNoCliente([
      pergunta({ id: "p10", condicional: { depende_de: "p11", contem: "imoveis" } }),
      pergunta({ id: "p11", tipo: "multipla", opcoes: ["imoveis", "empresas"] }),
    ]);
    expect(codigos(adiante)).toContain("condicional_adiante");

    const circular = validarDefinicaoNoCliente([pergunta({ id: "p10", condicional: { depende_de: "p10", igual: "x" } })]);
    expect(codigos(circular)).toContain("condicional_adiante");
  });

  it("cobra o operador certo para o tipo da pergunta de que depende", () => {
    const base = pergunta({ id: "p10", tipo: "multipla", opcoes: ["imoveis", "empresas"] });
    const dois = validarDefinicaoNoCliente([base, pergunta({ id: "p11", condicional: { depende_de: "p10", contem: "imoveis", igual: "imoveis" } })]);
    expect(codigos(dois)).toContain("condicional_operador");

    const igualSobreMultipla = validarDefinicaoNoCliente([base, pergunta({ id: "p11", condicional: { depende_de: "p10", igual: "imoveis" } })]);
    expect(codigos(igualSobreMultipla)).toContain("condicional_igual");

    const contemSobreUnica = validarDefinicaoNoCliente([
      pergunta({ id: "p10", tipo: "unica", opcoes: ["sim", "nao"] }),
      pergunta({ id: "p11", condicional: { depende_de: "p10", contem: "sim" } }),
    ]);
    expect(codigos(contemSobreUnica)).toContain("condicional_contem");
  });

  it("recusa condicional que compara com valor que não existe nas opções", () => {
    const problemas = validarDefinicaoNoCliente([
      pergunta({ id: "p10", tipo: "multipla", opcoes: ["imoveis"] }),
      pergunta({ id: "p11", condicional: { depende_de: "p10", contem: "barcos" } }),
    ]);
    expect(codigos(problemas)).toContain("condicional_valor");
  });

  it("aceita condicional sobre o formato novo de opções", () => {
    const problemas = validarDefinicaoNoCliente([
      pergunta({ id: "p10", tipo: "multipla", opcoes: [{ valor: "imoveis", rotulo: "Imóveis" }, { valor: "empresas", rotulo: "Empresas" }] }),
      pergunta({ id: "p11", condicional: { depende_de: "p10", contem: "imoveis" } }),
    ]);
    expect(problemas).toEqual([]);
  });

  it("recusa publicar o estratégico sem uma pergunta lida pelo servidor", () => {
    const semP9 = definicaoDeSistema().filter((p) => p.id !== "p9");
    const problemas = validarDefinicaoNoCliente(semP9, "estrategico");
    expect(codigos(problemas)).toEqual(["pergunta_de_sistema_removida"]);
    expect(problemas[0].perguntaId).toBe("p9");
    expect(problemas[0].mensagem).toContain("faixa de patrimônio");
  });

  it("outra chave não tem pergunta de sistema", () => {
    expect(validarDefinicaoNoCliente([pergunta({ id: "q1" })], "outro_formulario")).toEqual([]);
    expect(perguntasDeSistema("outro_formulario")).toEqual([]);
    expect(perguntasDeSistema("estrategico")).toHaveLength(4);
  });

  it("junta todos os problemas de uma vez, não só o primeiro", () => {
    const problemas = validarDefinicaoNoCliente([pergunta({ id: "P1" }), pergunta({ id: "p2", rotulo: "" })], "estrategico");
    expect(problemas.length).toBeGreaterThan(2);
  });
});

describe("prepararParaPublicar", () => {
  it("sobe as opções sempre no formato novo, mesmo vindas do legado", () => {
    const [pronta] = prepararParaPublicar([pergunta({ id: "p5", tipo: "unica", opcoes: ["viuvo", "casado"] })]);
    expect(pronta.opcoes).toEqual([
      { valor: "viuvo", rotulo: "Viúvo(a)" },
      { valor: "casado", rotulo: "Casado(a)" },
    ]);
  });

  it("tira a CHAVE opcoes de quem não é escolha — a 0078 recusa pela presença dela", () => {
    const [pronta] = prepararParaPublicar([pergunta({ id: "p1", tipo: "texto", opcoes: ["sobra"] })]);
    expect("opcoes" in pronta).toBe(false);
  });

  it("não manda obrigatoria: false e apara espaço de id, bloco e enunciado", () => {
    const [pronta] = prepararParaPublicar([pergunta({ id: " p1 ", bloco: " Sobre você ", rotulo: " Nome? ", obrigatoria: false })]);
    expect(pronta).toEqual({ id: "p1", bloco: "Sobre você", tipo: "texto", rotulo: "Nome?" });
  });

  it("manda um único operador na condicional e descarta a condicional pela metade", () => {
    const [comIgual] = prepararParaPublicar([pergunta({ id: "p2", condicional: { depende_de: "p1", igual: "sim", contem: "x" } })]);
    expect(comIgual.condicional).toEqual({ depende_de: "p1", igual: "sim" });
    const [semAlvo] = prepararParaPublicar([pergunta({ id: "p2", condicional: { depende_de: "", igual: "sim" } })]);
    expect(semAlvo.condicional).toBeUndefined();
    const [semValor] = prepararParaPublicar([pergunta({ id: "p2", condicional: { depende_de: "p1" } })]);
    expect(semValor.condicional).toBeUndefined();
  });

  it("o que sai daqui passa na validação que espelha a RPC", () => {
    const preparada = prepararParaPublicar(definicaoDeSistema());
    expect(validarDefinicaoNoCliente(preparada, "estrategico")).toEqual([]);
  });
});

describe("resumoDaDefinicao", () => {
  it("conta perguntas, blocos e obrigatórias, no singular e no plural", () => {
    expect(resumoDaDefinicao(definicaoDeSistema())).toBe("4 perguntas · 1 bloco · nenhuma obrigatória");
    expect(resumoDaDefinicao([pergunta({ id: "p1", obrigatoria: true })])).toBe("1 pergunta · 1 bloco · 1 obrigatória");
  });
});

/**
 * O núcleo passou a ser usado TAMBÉM pelo servidor (POST /api/formularios e o
 * dossiê do titular) na rodada 3 do pentest — antes eram dois módulos gêmeos,
 * um de cada lado. O que segue cobre a superfície que veio do lado de lá e o
 * que nasceu na 0081.
 */
describe("validarDefinicao — entrada crua da borda HTTP", () => {
  it("recusa o que não é lista sem confundir com lista vazia", () => {
    expect(codigos(validarDefinicao("nada"))).toEqual(["definicao_invalida"]);
    expect(codigos(validarDefinicao(null))).toEqual(["definicao_invalida"]);
    expect(codigos(validarDefinicao([]))).toEqual(["definicao_vazia"]);
  });

  it("recusa item que não é objeto e id herdado do protótipo", () => {
    expect(codigos(validarDefinicao(["uma string solta"]))).toContain("pergunta_invalida");
    expect(codigos(validarDefinicao([{ id: "__proto__", bloco: "b", tipo: "texto", rotulo: "x" }]))).toContain("id_invalido");
    expect(codigos(validarDefinicao([{ id: "constructor", bloco: "b", tipo: "texto", rotulo: "x" }]))).toContain("id_reservado");
    expect(codigos(validarDefinicao([{ id: "hasownproperty", bloco: "b", tipo: "texto", rotulo: "x" }]))).toContain("id_reservado");
  });

  it("recusa `obrigatoria` que não é sim/não", () => {
    expect(codigos(validarDefinicao([{ id: "p1", bloco: "b", tipo: "texto", rotulo: "x", obrigatoria: "sim" }]))).toContain(
      "obrigatoria_invalida",
    );
  });

  it("0081: teto de opções por pergunta", () => {
    const opcoes = (n: number) => Array.from({ length: n }, (_, i) => ({ valor: `v${i}`, rotulo: `Opção ${i}` }));
    const com = (n: number) => validarDefinicao([{ id: "p1", bloco: "b", tipo: "unica", rotulo: "x", opcoes: opcoes(n) }]);
    expect(com(LIMITE_OPCOES)).toEqual([]);
    expect(codigos(com(LIMITE_OPCOES + 1))).toContain("opcoes_demais");
  });

  it("a CHAVE `opcoes` presente em pergunta que não é escolha reprova, mesmo vazia", () => {
    expect(codigos(validarDefinicao([{ id: "p1", bloco: "b", tipo: "texto", rotulo: "x", opcoes: [] }]))).toContain(
      "opcoes_indevidas",
    );
    // `undefined` é ausência (é o que a tela deixa ao trocar de tipo, e o que o
    // JSON.stringify apaga): não reprova.
    expect(validarDefinicao([{ id: "p1", bloco: "b", tipo: "texto", rotulo: "x", opcoes: undefined }])).toEqual([]);
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

describe("lerDefinicao e rotuloDaResposta (o que o dossiê usa)", () => {
  const definicao = lerDefinicao([
    { id: "p9", bloco: "Patrimônio", tipo: "unica", rotulo: "Faixa", opcoes: [{ valor: "ate_500k", rotulo: "Até R$ 500 mil" }] },
    "lixo",
    { id: "p1", tipo: "curinga" },
  ]);

  it("lê a definição gravada sem lançar, descartando o que não é objeto", () => {
    expect(definicao).toHaveLength(2);
    expect(definicao[1].tipo).toBe("texto"); // tipo desconhecido vira o padrão
    expect(definicao[1].bloco).toBe("");
  });

  it("traduz para o rótulo da versão respondida e mantém CRU o valor que sumiu", () => {
    expect(rotuloDaResposta(definicao[0], "ate_500k")).toBe("Até R$ 500 mil");
    // Diferente de `textoDaResposta`: no dossiê nada é embelezado.
    expect(rotuloDaResposta(definicao[0], "faixa_extinta")).toBe("faixa_extinta");
    expect(textoDaResposta(definicao[0], "faixa_extinta")).toBe("Faixa extinta");
    expect(rotuloDaResposta(definicao[0], null)).toBe("");
    expect(rotuloDaResposta(null, "algo")).toBe("algo");
  });
});
