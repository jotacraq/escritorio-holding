import { describe, expect, it } from "vitest";
import {
  classificarDeterministico,
  contemTermoProibido,
  fraseEncaminhamento,
  normalizarTexto,
  renderizar,
  textoEsquivaFinal,
  textoFixo,
  textoLinkRecente,
  type ContextoResposta,
} from "./respostas";

const ctx = (campos: Partial<ContextoResposta> = {}): ContextoResposta => ({
  primeiroNome: "Ana",
  passo: "Enviar documentos",
  link: null,
  faltam: [],
  dentroDaJanela: true,
  ...campos,
});

describe("normalizarTexto", () => {
  it("tira acento, caixa e espaço repetido", () => {
    expect(normalizarTexto("  Inventário   É   ISSO?  ")).toBe("inventario e isso?");
  });
});

describe("classificarDeterministico — a esquiva não pode depender de modelo", () => {
  const base = { temAnexo: false, passoChave: "documentos" };

  it("pergunta jurídica é reconhecida antes de tudo", () => {
    expect(classificarDeterministico({ ...base, texto: "e o ITCMD, quanto vai dar?" })).toBe("duvida_juridica");
    expect(classificarDeterministico({ ...base, texto: "preciso fazer inventário depois?" })).toBe("duvida_juridica");
    expect(classificarDeterministico({ ...base, texto: "isso reduz imposto?" })).toBe("duvida_juridica");
  });

  it("pergunta de preço nunca chega ao modelo (B61)", () => {
    expect(classificarDeterministico({ ...base, texto: "quanto custa o croqui?" })).toBe("preco_prazo");
    expect(classificarDeterministico({ ...base, texto: "dá para parcelar?" })).toBe("preco_prazo");
  });

  it("pedido explícito de humano é atendido na hora", () => {
    expect(classificarDeterministico({ ...base, texto: "quero falar com alguém" })).toBe("falar_com_humano");
  });

  it("anexo é intenção de mandar documento, sempre", () => {
    expect(classificarDeterministico({ ...base, texto: "segue", temAnexo: true })).toBe("enviar_documento");
  });

  /** B58: "confirmo" só vale quando o passo É confirmar presença. */
  it('"confirmo" só conta no passo de confirmar presença', () => {
    expect(classificarDeterministico({ ...base, texto: "confirmo" })).toBeNull();
    expect(classificarDeterministico({ ...base, texto: "confirmo", passoChave: "confirmar_presenca" })).toBe("confirmar_horario");
  });

  it("texto genérico não bate em nada — é aí que a IA entra", () => {
    expect(classificarDeterministico({ ...base, texto: "vocês jogam futebol?" })).toBeNull();
  });
});

describe("renderizar — placeholder sobrando BLOQUEIA o envio (D16)", () => {
  it("substitui o que tem valor", () => {
    expect(renderizar("Oi {{nome}}, tudo bem?", { nome: "Ana" })).toBe("Oi Ana, tudo bem?");
  });

  it("devolve null quando falta valor, em vez de mandar frase pela metade", () => {
    expect(renderizar("Seu link: {{link}}", {})).toBeNull();
    expect(renderizar("Seu link: {{link}}", { link: "" })).toBeNull();
  });
});

describe("textoFixo", () => {
  it("confirmar horário sem link não vira mensagem (B58)", () => {
    expect(textoFixo("confirmar_horario", ctx({ passo: "Confirmar presença" }))).toBeNull();
    expect(textoFixo("confirmar_horario", ctx({ link: "https://x/p/c/tok" }))).toContain("https://x/p/c/tok");
  });

  it("documento sem link não vira mensagem — o anexo NUNCA é ingerido (C9/D11)", () => {
    expect(textoFixo("enviar_documento", ctx())).toBeNull();
    const com = textoFixo("enviar_documento", ctx({ link: "https://x/p/d/tok", faltam: ["imposto de renda", "contrato social"] }));
    expect(com).toContain("https://x/p/d/tok");
    expect(com).toContain("imposto de renda e contrato social");
  });

  it("preço devolve à Dra. Elaine e não cita número nenhum", () => {
    const t = textoFixo("preco_prazo", ctx())!;
    expect(t).toContain("Dra. Elaine");
    expect(t).not.toMatch(/\d/);
  });

  it("dúvida jurídica não explica nada e devolve ao passo", () => {
    const t = textoFixo("duvida_juridica", ctx())!;
    expect(t).toContain("Dra. Elaine");
    expect(t.toLowerCase()).toContain("enviar documentos");
  });

  it("nenhum texto fixo trata o cliente por senhor/senhora (B60)", () => {
    const todos = [
      textoFixo("o_que_falta", ctx()),
      textoFixo("fora_do_tema", ctx()),
      textoFixo("preco_prazo", ctx()),
      textoFixo("duvida_juridica", ctx()),
      textoFixo("falar_com_humano", ctx()),
      textoEsquivaFinal(ctx()),
      textoLinkRecente(ctx()),
    ].join(" ");
    expect(todos.toLowerCase()).not.toContain("senhor");
    expect(todos.toLowerCase()).not.toContain("prezad");
  });

  it("sem nome, a saudação some — nunca vira {{nome}}", () => {
    const t = textoFixo("o_que_falta", ctx({ primeiroNome: null }))!;
    expect(t.startsWith("Oi!")).toBe(true);
    expect(t).not.toContain("{{");
  });
});

describe("fraseEncaminhamento — a janela só vale para a promessa (B59)", () => {
  it("dentro da janela promete a equipe; fora, promete o próximo dia útil", () => {
    expect(fraseEncaminhamento(true)).not.toContain("dia útil");
    expect(fraseEncaminhamento(false)).toContain("dia útil");
  });
});

describe("textoEsquivaFinal (B57)", () => {
  it("não repete a frase da 1ª esquiva", () => {
    expect(textoEsquivaFinal(ctx())).not.toBe(textoFixo("fora_do_tema", ctx()));
  });
});

describe("contemTermoProibido — a trava na SAÍDA da IA (pentest, BAIXO 3)", () => {
  it("pega orientação jurídica que o classificador de ENTRADA deixaria passar", () => {
    // O cliente perguntou sem nenhuma palavra da lista ("e se eu passar tudo
    // para meus filhos agora?"), então a IA foi chamada. Se ELA responder com
    // o vocabulário proibido, a frase não sai.
    expect(contemTermoProibido("Nesse caso incide ITCMD sobre a doação.")).toBe("juridico");
    expect(contemTermoProibido("Você evita o inventário e paga menos imposto.")).toBe("juridico");
  });

  it("pega preço mesmo quando a frase parece inofensiva", () => {
    expect(contemTermoProibido("O valor costuma ser fechado na sessão.")).toBe("preco");
    expect(contemTermoProibido("Dá para parcelar, sim.")).toBe("preco");
  });

  it("frase legítima de onboarding passa", () => {
    expect(contemTermoProibido("É só tocar no link e enviar o arquivo por lá.")).toBeNull();
    expect(contemTermoProibido("Assim que os documentos chegarem, a equipe segue.")).toBeNull();
  });

  it("a trava é da IA, não dos textos fixos — o texto de preço DIZ 'valores' de propósito", () => {
    // Se um dia alguém aplicar `contemTermoProibido` no caminho fixo, este
    // caso mostra que ele mataria a resposta CERTA.
    expect(contemTermoProibido(textoFixo("preco_prazo", ctx())!)).toBe("preco");
  });
});
