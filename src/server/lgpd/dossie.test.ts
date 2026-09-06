import { describe, expect, it } from "vitest";
import {
  dadosBrutosVazios,
  montarDossie,
  OBSERVACAO_ANONIMIZADA,
  OBSERVACAO_CNPJ,
  OBSERVACAO_DOCUMENTOS,
  OBSERVACAO_VAPI,
  AVISO_ANOTACOES_INTERNAS,
  TABELAS_DO_DOSSIE,
  type ContextoDossie,
} from "./dossie";
import { INVENTARIO_TITULAR } from "./inventario";

const contexto: ContextoDossie = {
  gerado_por: { id: "perfil-1", nome: "Ana Souza" },
  solicitacao_id: "sol-1",
  controlador: "Montenegro Sociedade de Advogados",
  gerado_em: "2026-09-06T18:00:00.000Z",
};

describe("montarDossie — metadados", () => {
  it("carimba quem gerou, sob qual solicitação, e as tabelas cobertas", () => {
    const d = montarDossie(dadosBrutosVazios(), contexto);
    expect(d._metadados.gerado_por.nome).toBe("Ana Souza");
    expect(d._metadados.solicitacao_id).toBe("sol-1");
    expect(d._metadados.versao_esquema).toBe(2);
    expect(d._metadados.tabelas_incluidas).toEqual([...TABELAS_DO_DOSSIE]);
    expect(d._metadados.controlador).toBe("Montenegro Sociedade de Advogados");
  });

  it("controlador não configurado é null, nunca um nome inventado", () => {
    const d = montarDossie(dadosBrutosVazios(), { ...contexto, controlador: null });
    expect(d._metadados.controlador).toBeNull();
  });
});

describe("montarDossie — seção vazia é lista vazia, nunca zero", () => {
  it("titular sem nada guardado sai com listas vazias e pessoa nula", () => {
    const d = montarDossie(dadosBrutosVazios(), contexto);
    expect(d.pessoa).toBeNull();
    expect(d.documentos).toEqual([]);
    expect(d.formularios).toEqual([]);
    expect(d.secoes.every((s) => s.linhas.length === 0)).toBe(true);
    // Nenhum campo de contagem: o dossiê não resume, ele lista.
    expect(Object.values(d).some((v) => v === 0)).toBe(false);
  });

  it("toda tabela do inventário vira seção ou tem seção própria — nunca some", () => {
    const d = montarDossie(dadosBrutosVazios(), contexto);
    const cobertas = new Set([
      ...d.secoes.map((s) => s.tabela),
      ...d.anotacoes_internas.secoes.map((s) => s.tabela),
      "formularios_respostas", // vira `formularios`, pergunta a pergunta
      "documentos", // vira a lista de arquivos com metadado
    ]);
    const faltando = INVENTARIO_TITULAR.map((i) => i.tabela).filter((t) => !cobertas.has(t));
    expect(faltando).toEqual([]);
  });

  it("as tabelas declaradas nos metadados são exatamente as do inventário + pessoas", () => {
    expect([...TABELAS_DO_DOSSIE]).toEqual(["pessoas", ...INVENTARIO_TITULAR.map((i) => i.tabela)]);
  });
});

describe("montarDossie — anotações internas do escritório (BLOQUEIO B47)", () => {
  it("tira as impressões da equipe da seção da ligação e as põe na seção separada", () => {
    const dados = dadosBrutosVazios();
    dados.tabelas.ligacoes_estrategicas = [
      {
        id: "lig-1",
        jornada_id: "j1",
        expectativa_principal: "Proteger o imóvel da praia",
        objecoes_percebidas: ["acha caro"],
        sinais: ["demonstra_cautela"],
        frases_marcantes: ["não quero briga entre os filhos"],
      },
    ];
    const d = montarDossie(dados, contexto);

    const publica = d.secoes.find((s) => s.tabela === "ligacoes_estrategicas")!.linhas[0];
    expect(publica.expectativa_principal).toBe("Proteger o imóvel da praia");
    expect("objecoes_percebidas" in publica).toBe(false);
    expect("sinais" in publica).toBe(false);
    expect("frases_marcantes" in publica).toBe(false);

    const interna = d.anotacoes_internas.secoes.find((s) => s.tabela === "ligacoes_estrategicas")!.linhas[0];
    expect(interna.id).toBe("lig-1");
    expect(interna.frases_marcantes).toEqual(["não quero briga entre os filhos"]);
  });

  it("observações do cadastro saem de `pessoa` e entram nas anotações internas", () => {
    const dados = dadosBrutosVazios();
    dados.pessoa = { id: "p1", nome: "Marcos", observacoes: "cliente ansioso, ligar cedo" };
    const d = montarDossie(dados, contexto);
    expect("observacoes" in d.pessoa!).toBe(false);
    const interna = d.anotacoes_internas.secoes.find((s) => s.tabela === "pessoas")!.linhas[0];
    expect(interna.observacoes).toBe("cliente ansioso, ligar cedo");
  });

  it("linha sem nada anotado não vira linha vazia na seção interna", () => {
    const dados = dadosBrutosVazios();
    dados.tabelas.briefings = [{ id: "b1", jornada_id: "j1", conteudo: null }];
    const d = montarDossie(dados, contexto);
    expect(d.anotacoes_internas.secoes.find((s) => s.tabela === "briefings")!.linhas).toEqual([]);
  });

  it("o aviso de que a Dra. Elaine pode decidir excluí-las sai no JSON e nas observações", () => {
    const d = montarDossie(dadosBrutosVazios(), contexto);
    expect(d.anotacoes_internas.aviso).toBe(AVISO_ANOTACOES_INTERNAS);
    expect(d._metadados.observacoes).toContain(AVISO_ANOTACOES_INTERNAS);
  });
});

describe("montarDossie — a URL da gravação não sai, o fato de existir sai", () => {
  it("troca `gravacao_url` pelo texto do provedor, sem tocar no resto da linha", () => {
    const dados = dadosBrutosVazios();
    dados.tabelas.ligacoes_ia = [
      { id: "l1", status: "concluida", duracao_segundos: 92, gravacao_url: "https://storage.vapi.ai/abc.wav" },
    ];
    const linha = montarDossie(dados, contexto).secoes.find((s) => s.tabela === "ligacoes_ia")!.linhas[0];
    expect(String(linha.gravacao_url)).toContain("provedor de telefonia");
    expect(String(linha.gravacao_url)).not.toContain("vapi.ai");
    expect(linha.duracao_segundos).toBe(92);
    // A linha original não foi mutada — o dossiê é uma projeção, não um destino.
    expect(dados.tabelas.ligacoes_ia[0].gravacao_url).toBe("https://storage.vapi.ai/abc.wav");
  });
});

describe("montarDossie — observações dizem o que NÃO está no pacote", () => {
  it("avisa da Vapi quando houve ligação por IA", () => {
    const dados = dadosBrutosVazios();
    dados.tabelas.ligacoes_ia = [{ id: "l1", status: "concluida" }];
    expect(montarDossie(dados, contexto)._metadados.observacoes).toContain(OBSERVACAO_VAPI);
  });

  it("não avisa da Vapi quando não houve ligação por IA", () => {
    expect(montarDossie(dadosBrutosVazios(), contexto)._metadados.observacoes).not.toContain(OBSERVACAO_VAPI);
  });

  it("avisa do download separado quando há arquivo do cliente", () => {
    const dados = dadosBrutosVazios();
    dados.documentos = [
      { id: "d1", tipo: "imposto_renda", nome_arquivo: "ir.pdf", tamanho_bytes: 10, mime: "application/pdf", criado_em: "2026-08-01" },
    ];
    expect(montarDossie(dados, contexto)._metadados.observacoes).toContain(OBSERVACAO_DOCUMENTOS);
  });

  it("sempre declara o buraco do quadro societário (B45)", () => {
    expect(montarDossie(dadosBrutosVazios(), contexto)._metadados.observacoes).toContain(OBSERVACAO_CNPJ);
  });

  it("avisa quando o dossiê é de alguém já anonimizado", () => {
    const dados = dadosBrutosVazios();
    dados.pessoa = { id: "p1", nome: "Titular anonimizado 3f2a1c9d", anonimizada_em: "2026-09-06T15:40:00Z" };
    expect(montarDossie(dados, contexto)._metadados.observacoes[0]).toBe(OBSERVACAO_ANONIMIZADA);
  });
});

describe("montarDossie — formulário sai legível, contra a versão respondida", () => {
  const dadosComFormulario = () => {
    const dados = dadosBrutosVazios();
    dados.formularios = [
      {
        linha: {
          id: "fr1",
          formulario_id: "f2",
          respondido_em: "2026-07-10T12:00:00Z",
          respostas: { p1: "Marcos Ribeiro", p9: "ate_500k", p20: "resposta de pergunta que sumiu" },
        },
        formulario: {
          id: "f2",
          chave: "estrategico",
          versao: 2,
          definicao: [
            { id: "p1", bloco: "Identificação", tipo: "texto", rotulo: "Qual seu nome completo?" },
            {
              id: "p9",
              bloco: "Patrimônio",
              tipo: "unica",
              rotulo: "Qual sua faixa de patrimônio estimado?",
              opcoes: [
                { valor: "ate_500k", rotulo: "Até R$ 500 mil" },
                { valor: "acima_500k", rotulo: "Acima de R$ 500 mil" },
              ],
            },
            { id: "p16", bloco: "Dor", tipo: "texto_longo", rotulo: "O que mais preocupa?" },
          ],
        },
      },
    ];
    return dados;
  };

  it("traz pergunta e resposta com o rótulo da opção, não o slug", () => {
    const secao = montarDossie(dadosComFormulario(), contexto).formularios[0];
    expect(secao.chave).toBe("estrategico");
    expect(secao.versao).toBe(2);
    const p9 = secao.perguntas.find((p) => p.id === "p9");
    expect(p9?.rotulo).toBe("Qual sua faixa de patrimônio estimado?");
    expect(p9?.resposta_valor).toBe("ate_500k");
    expect(p9?.resposta_rotulo).toBe("Até R$ 500 mil");
  });

  it("pergunta sem resposta aparece vazia — o titular vê o que foi perguntado", () => {
    const secao = montarDossie(dadosComFormulario(), contexto).formularios[0];
    const p16 = secao.perguntas.find((p) => p.id === "p16");
    expect(p16).toBeDefined();
    expect(p16?.resposta_valor).toBeNull();
    expect(p16?.resposta_rotulo).toBe("");
  });

  it("resposta órfã (pergunta removida da versão) não some do dossiê", () => {
    const secao = montarDossie(dadosComFormulario(), contexto).formularios[0];
    const orfa = secao.perguntas.find((p) => p.id === "p20");
    expect(orfa?.resposta_valor).toBe("resposta de pergunta que sumiu");
    expect(orfa?.rotulo).toContain("não encontrada");
  });

  it("aguenta resposta sem a definição da versão (formulário apagado do banco)", () => {
    const dados = dadosBrutosVazios();
    dados.formularios = [
      { linha: { id: "fr1", formulario_id: "f9", respondido_em: "2026-07-10", respostas: { p1: "x" } }, formulario: null },
    ];
    const secao = montarDossie(dados, contexto).formularios[0];
    expect(secao.chave).toBe("");
    expect(secao.versao).toBe(0);
    expect(secao.perguntas).toHaveLength(1);
    expect(secao.perguntas[0].resposta_valor).toBe("x");
  });
});
