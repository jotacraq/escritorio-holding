// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { within } from "@testing-library/react";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { CorpoRetrospecto } from "./CorpoRetrospecto";
import { colapsarObservacoes, mesmoFato } from "./colapsarObservacoes";
import type { ObservacaoDoClienteRetrospecto, RetrospectoDaSessao } from "@/types/copiloto";

/**
 * Fase 13, §D — o corpo do Retrospecto, reorganizado em 22/09 depois do
 * veredito do dono ("tá muito feio, confuso, a disposição dos dados fica
 * confusa").
 *
 * O que estes testes travam:
 *  1. **Hierarquia invertida** — os fatos da cliente vêm ANTES da telemetria
 *     no DOM. A ordem das seções é o conserto inteiro; se alguém reverter, a
 *     queixa do dono volta.
 *  2. **Agrupamento por assunto na ordem do SERVIDOR** (`RANK_CATEGORIA`:
 *     objeção › dor › desejo › fato_decisor › patrimônio). A tela não
 *     reordena — regra de negócio do dono.
 *  3. **Colapso de duplicata preservando TODA evidência.** Nenhuma citação
 *     some em silêncio; na dúvida, os dois itens ficam.
 *  4. **Regra de vazio** — ausência por extenso, nunca 0, nunca percentual de
 *     denominador que não veio.
 *
 * 🔴 **O que estes testes NÃO provam: geometria.** jsdom não pinta. Nada aqui
 * diz que o documento cabe, que não transborda ou que a densidade ficou boa —
 * isso só se prova em navegador. Ver `06 Memorias/2026-09-18 - Elemento
 * absolute invisivel conta na area rolavel do ancestral`.
 */

function observacao(over: Partial<ObservacaoDoClienteRetrospecto> = {}): ObservacaoDoClienteRetrospecto {
  return {
    origem: "ficha",
    categoria: "objecao",
    tipo: null,
    texto: "Texto qualquer.",
    evidencia: null,
    n: 1,
    confianca: null,
    ...over,
  };
}

function retrospecto(over: Partial<RetrospectoDaSessao["conteudo"]> = {}): RetrospectoDaSessao {
  return {
    sessao_id: "s1",
    jornada_id: "j1",
    origem: "derivado",
    schema_versao: 1,
    blocos_com_atividade: 9,
    blocos_no_roteiro: 13,
    evidencias_redigidas_em: null,
    criado_em: "2026-09-22T20:00:00Z",
    conteudo: {
      versao: 1,
      cobertura: { blocos_com_atividade: 9, blocos_no_roteiro: 13, nao_percorridos: [] },
      duracao: { iniciado_em: "2026-09-22T18:00:00Z", encerrado_em: "2026-09-22T19:54:00Z", minutos: 114 },
      patrimonio: null,
      observacoes_do_cliente: [],
      pontos_de_melhoria: [],
      saude_do_motor: {
        sugestoes: 29,
        confianca_media: 0.7,
        sugestoes_com_evidencia_nao_conferida: 12,
        execucoes_ia: 31,
        execucoes_truncadas: 2,
      },
      podado: false,
      nota_de_rodape: "Cobertura é fração do roteiro com registro do copiloto — não é nota de condução.",
      ...over,
    },
  };
}

describe("hierarquia: cliente primeiro, telemetria no pé", () => {
  it("desenha 'O que a cliente disse' ANTES de 'Registro do sistema' no DOM", () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          observacoes_do_cliente: [observacao({ texto: "Quer evitar inventário para os dois filhos." })],
        })}
      />,
    );

    const titulos = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    expect(titulos).toEqual(["O que a cliente disse", "Pontos de melhoria da condução", "Registro do sistema"]);
  });

  it("não usa mais tipografia grande para telemetria (a cobertura deixou de ser o número herói)", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto()} />);
    // `text-titulo` era o tamanho do "9" da cobertura no desenho antigo.
    expect(container.querySelector(".text-titulo")).toBeNull();
  });

  it("mantém a cobertura auditável, como numerador de denominador", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto()} />);
    expect(container.textContent).toContain("9 de 13 partes com registro do copiloto");
    expect(container.textContent).not.toContain("69%");
  });
});

describe("agrupamento por assunto, na ordem do servidor", () => {
  it("agrupa por categoria e PRESERVA a ordem do RANK_CATEGORIA entregue pelo servidor", () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          observacoes_do_cliente: [
            observacao({ categoria: "objecao", texto: "Acha caro fazer holding agora." }),
            observacao({ categoria: "dor", texto: "Teme briga entre os filhos." }),
            observacao({ categoria: "desejo", texto: "Quer evitar inventário." }),
            observacao({ categoria: "fato_decisor", texto: "Decide sozinha." }),
            observacao({ categoria: "patrimonio", texto: "Apartamento na praia." }),
          ],
        })}
      />,
    );

    const subtitulos = [...container.querySelectorAll("h4")].map((h) => h.textContent);
    expect(subtitulos).toEqual(["Objeções", "Dores", "Desejos", "Fatos do decisor", "Patrimônio"]);
  });

  it("NÃO reordena quando o servidor entrega fora do rank (a tela obedece o servidor)", () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          observacoes_do_cliente: [
            observacao({ categoria: "patrimonio", texto: "Apartamento na praia." }),
            observacao({ categoria: "objecao", texto: "Acha caro." }),
          ],
        })}
      />,
    );

    expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Patrimônio", "Objeções"]);
  });

  it("separa observações da IA por tipo, sem misturar com os fatos da ficha", () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          observacoes_do_cliente: [
            observacao({ categoria: "dor", texto: "Teme briga entre os filhos." }),
            observacao({ origem: "observacao", categoria: null, tipo: "inferencia", texto: "Decide junto com a irmã.", confianca: 0.68 }),
          ],
        })}
      />,
    );

    expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Dores", "Inferências do copiloto"]);
  });
});

describe("colapso de duplicatas: nenhuma evidência some", () => {
  // Os 3 textos reais medidos na sessão de 22/09.
  const DIVORCIADA = [
    observacao({ categoria: "fato_decisor", texto: "Divorciada há mais de 10 anos; ex-marido é pai dos 2 filhos", evidencia: "sou divorciada faz uns doze anos", n: 2 }),
    observacao({ categoria: "fato_decisor", texto: "Divorciada há mais de 10 anos, partilha resolvida amigavelmente", evidencia: "a partilha a gente resolveu na conversa", n: 1 }),
    observacao({ categoria: "fato_decisor", texto: "Divorciada há mais de 10 anos, dois filhos", evidencia: "tenho dois filhos", n: 1 }),
  ];

  it("colapsa as 3 redações do mesmo fato numa linha só", () => {
    const colapsado = colapsarObservacoes(DIVORCIADA);
    expect(colapsado).toHaveLength(1);
    expect(colapsado[0].linhas).toBe(3);
    // `n` soma: o fato foi registrado 4 vezes ao todo (2+1+1).
    expect(colapsado[0].n).toBe(4);
  });

  it("mantém na tela as 3 citações das linhas colapsadas", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto({ observacoes_do_cliente: DIVORCIADA })} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("sou divorciada faz uns doze anos");
    expect(texto).toContain("a partilha a gente resolveu na conversa");
    expect(texto).toContain("tenho dois filhos");
    // E DIZ que reuniu, em vez de esconder o colapso.
    expect(texto).toContain("3 registros do copiloto reunidos aqui");
  });

  it("escolhe a redação mais longa como representativa (não joga detalhe fora)", () => {
    // 63 chars contra 59 e 42 — a mais longa é a da partilha, não a primeira
    // da lista. O critério é comprimento, não ordem de chegada.
    expect(colapsarObservacoes(DIVORCIADA)[0].texto).toBe("Divorciada há mais de 10 anos, partilha resolvida amigavelmente");
  });

  it("NÃO colapsa fatos distintos que dividem palavras soltas", () => {
    // Jaccard 0,25 entre estes dois — acima de duplicata real (0,27 é o piso
    // medido). Só o gate de prefixo separa.
    expect(mesmoFato("Divorciada há mais de 10 anos, dois filhos", "Quer evitar inventário para os dois filhos")).toBe(false);
  });

  it("NÃO colapsa imóveis de pessoas diferentes (filho ≠ irmão)", () => {
    expect(mesmoFato("Apartamento do filho em processo de divórcio", "Apartamento do irmão em divórcio")).toBe(false);
    expect(mesmoFato("Apartamento do filho em processo de divórcio", "Apartamento da família tentando vender")).toBe(false);
    // Mas o MESMO imóvel do filho, em duas redações, colapsa.
    expect(mesmoFato("Apartamento do filho em processo de divórcio", "Apartamento do filho em processo de venda")).toBe(true);
  });

  it("não colapsa entre categorias diferentes, mesmo com texto idêntico", () => {
    const colapsado = colapsarObservacoes([
      observacao({ categoria: "dor", texto: "Briga entre os filhos." }),
      observacao({ categoria: "objecao", texto: "Briga entre os filhos." }),
    ]);
    expect(colapsado).toHaveLength(2);
  });

  it("é simétrico — a ordem de chegada não muda quem colapsa com quem", () => {
    const a = "Divorciada há mais de 10 anos, dois filhos";
    const b = "Divorciada há mais de 10 anos; ex-marido é pai dos 2 filhos";
    expect(mesmoFato(a, b)).toBe(mesmoFato(b, a));
  });

  it("não inventa contagem: item único fica com linhas=1 e não anuncia colapso", () => {
    const { container } = montar(
      <CorpoRetrospecto retrospecto={retrospecto({ observacoes_do_cliente: [observacao({ texto: "Acha caro." })] })} />,
    );
    expect(container.textContent).not.toContain("registros do copiloto reunidos");
  });
});

describe("regra de vazio: ausência por extenso, nunca 0", () => {
  it("duração ausente escreve 'não registrada', nunca '0 min'", () => {
    const { container } = montar(
      <CorpoRetrospecto retrospecto={retrospecto({ duracao: { iniciado_em: null, encerrado_em: null, minutos: null } })} />,
    );
    expect(container.textContent).toContain("não registrada");
    expect(container.textContent).not.toContain("0 min");
  });

  it("patrimônio ausente escreve 'nenhum item mencionado', nunca 0 captados", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto({ patrimonio: null })} />);
    expect(container.textContent).toContain("nenhum item mencionado");
    expect(container.textContent).not.toContain("0 captados");
  });

  it("janela desconhecida diz que não foi possível medir, em vez de 0 truncadas", () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          saude_do_motor: {
            sugestoes: 29,
            confianca_media: null,
            sugestoes_com_evidencia_nao_conferida: 12,
            execucoes_ia: null,
            execucoes_truncadas: null,
          },
        })}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("não foi possível medir nesta sessão");
    expect(texto).not.toContain("respostas da IA truncadas");
    // Confiança ausente não vira "0,00".
    expect(texto).not.toContain("confiança média 0,00");
  });

  it("sem observação nenhuma, diz por extenso em vez de desenhar grupos vazios", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto({ observacoes_do_cliente: [] })} />);
    expect(container.textContent).toContain("Nenhuma observação registrada durante a sessão.");
    expect(container.querySelectorAll("h4")).toHaveLength(0);
  });

  it("toda proporção é numerador de denominador, nunca porcentagem pronta", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto()} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("12 de 29 com evidência não conferida");
    expect(texto).toContain("2 de 31 respostas da IA truncadas");
    expect(texto).not.toMatch(/\d%/);
  });
});

describe("avisos que não podem sumir em silêncio", () => {
  it("diz que podou, quando podou", () => {
    const { container } = montar(<CorpoRetrospecto retrospecto={retrospecto({ podado: true })} />);
    expect(container.textContent).toContain("Parte do conteúdo foi cortada por tamanho");
  });

  it("diz que o expurgo removeu as citações", () => {
    const base = retrospecto({ observacoes_do_cliente: [observacao({ evidencia: null })] });
    const { container } = montar(<CorpoRetrospecto retrospecto={{ ...base, evidencias_redigidas_em: "2026-09-23T00:00:00Z" }} />);
    expect(container.textContent).toContain("já foram removidas pelo expurgo de dados");
  });
});

describe("acessibilidade", () => {
  it("não tem violação de acessibilidade com o documento cheio", async () => {
    const { container } = montar(
      <CorpoRetrospecto
        retrospecto={retrospecto({
          observacoes_do_cliente: [
            observacao({ categoria: "objecao", texto: "Acha caro fazer holding agora.", evidencia: "tá puxado esse valor" }),
            observacao({ categoria: "fato_decisor", texto: "Divorciada há mais de 10 anos, dois filhos", evidencia: "tenho dois filhos" }),
            observacao({ origem: "observacao", categoria: null, tipo: "hipotese", texto: "Pode estar decidindo com a irmã.", confianca: 0.5 }),
          ],
          pontos_de_melhoria: [{ item: "Não perguntou sobre dívidas.", n: 2, bloco_id: "b4", bloco_titulo: "PARTE 04" }],
          patrimonio: {
            total_itens_proprios: 31,
            total_itens_incertos: 4,
            por_categoria: [{ categoria: "imovel", contagem_propria: 20, contagem_incerta: 4, sem_titularidade: 3 }],
          },
          cobertura: { blocos_com_atividade: 9, blocos_no_roteiro: 13, nao_percorridos: [{ id: "b11", titulo: "PARTE 11 — Fechamento", indice: 10 }] },
        })}
      />,
    );
    await semViolacoes(container);
  });

  it("cada seção é rotulada pelo próprio heading (aria-labelledby preservado)", () => {
    const { container } = montar(
      <CorpoRetrospecto retrospecto={retrospecto({ observacoes_do_cliente: [observacao({ categoria: "dor", texto: "Teme briga." })] })} />,
    );
    for (const secao of container.querySelectorAll("section")) {
      const id = secao.getAttribute("aria-labelledby");
      expect(id).toBeTruthy();
      expect(within(secao).getByText((_, el) => el?.id === id)).toBeTruthy();
    }
  });
});
