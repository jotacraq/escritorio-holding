import { describe, expect, it } from "vitest";
import { sugestaoEVisivel, validarSugestaoCopiloto } from "./validar";
import type { SugestaoCopilotoIa } from "./schema";
import type { ContextoCopiloto } from "@/types/copiloto";

/**
 * Validação pós-Zod (§4.3 do plano: "a IA propõe, o servidor confere") — os
 * 4 comportamentos que o aceite da entrega exige:
 *  - bloco_id inválido → sugestão de desvio DESCARTADA;
 *  - evidência que não casa por substring → campo vira nulo;
 *  - termo proibido na saída → sugestão INTEIRA recusada;
 *  - confiança baixa NÃO é testada aqui (é regra de EXIBIÇÃO na rota, não do
 *    validador — ver copiloto/orcamento.test.ts e o teste de rota).
 */

function contextoBase(): ContextoCopiloto {
  return {
    roteiro_fonte: "carimbado",
    bloco_atual: {
      id: "parte_03",
      titulo: "Radiografia Familiar e Patrimonial",
      objetivo: null,
      acao: null,
      campos: ["Filhos", "Regime de casamento"],
      observar: [],
      proibido: [],
    },
    bloco_anterior_titulo: "Motivação do Cliente",
    bloco_seguinte_titulo: "A Fase do Desconforto",
    briefing_recorte: null,
    estado_factual: {
      sims_registrados: ["licitude"],
      blocos_percorridos: ["parte_00", "parte_01", "parte_02"],
      campos_pendentes_no_bloco: ["Filhos", "Regime de casamento"],
      decisores_esperados: 2,
      decisores_presentes: 1,
    },
    janela_transcricao: ["cliente: meu filho não conseguiu entrar hoje, ele viaja amanhã"],
    dossie: null,
    inventario_resumo: null,
    resumo_acumulado: null,
    roteiro_ativo_blocos_ids: ["parte_00", "parte_01", "parte_02", "parte_03", "parte_04"],
    roteiro_ativo_blocos: [
      { id: "parte_00", titulo: "Abertura", objetivo: null },
      { id: "parte_01", titulo: "Motivação do Cliente", objetivo: null },
      { id: "parte_02", titulo: "Sigilo e Gravação", objetivo: null },
      { id: "parte_03", titulo: "Radiografia Familiar e Patrimonial", objetivo: null },
      { id: "parte_04", titulo: "A Fase do Desconforto", objetivo: null },
    ],
  };
}

function saidaBase(): SugestaoCopilotoIa {
  return {
    proxima_pergunta: null,
    falta_no_bloco: [],
    cobriu_no_bloco: [],
    observacao: null,
    desvio_sugerido: null,
    confianca_geral: 0.8,
    bloco_inferido: null,
    inventario_mencionado: [],
    ficha_cliente: [],
  };
}

describe("validarSugestaoCopiloto — bloco_id inválido", () => {
  it("desvio_sugerido com bloco_id que NÃO existe no roteiro ativo é DESCARTADO (fica nulo)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      desvio_sugerido: { bloco_id: "parte_99_inventado", motivo: "motivo qualquer", confianca: 0.7 },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBeNull();
    expect(resultado.sugestao?.desvio_sugerido).toBeNull();
  });

  it("desvio_sugerido com bloco_id que EXISTE no roteiro ativo passa", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      desvio_sugerido: { bloco_id: "parte_04", motivo: "motivo qualquer", confianca: 0.7 },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.desvio_sugerido).toEqual({ bloco_id: "parte_04", motivo: "motivo qualquer", confianca: 0.7 });
  });
});

describe("validarSugestaoCopiloto — evidência não conferida", () => {
  it("evidência que NÃO casa por substring com a janela nem com o estado vira nulo", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      proxima_pergunta: { texto: "Pergunte sobre o regime de bens.", motivo: "falta essa informação", evidencia: "frase que nunca foi dita por ninguém" },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.proxima_pergunta?.evidencia).toBeNull();
    expect(resultado.sugestao?.campos_evidencia_nao_conferida).toContain("proxima_pergunta.evidencia");
    // O resto do campo sobrevive — só a evidência foi anulada.
    expect(resultado.sugestao?.proxima_pergunta?.texto).toBe("Pergunte sobre o regime de bens.");
  });

  it("evidência que CASA por substring (citação literal) passa e não entra na lista de não conferidas", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      proxima_pergunta: {
        texto: "O filho vai poder participar da decisão?",
        motivo: "decisor ausente",
        evidencia: "meu filho não conseguiu entrar hoje",
      },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.proxima_pergunta?.evidencia).toBe("meu filho não conseguiu entrar hoje");
    expect(resultado.sugestao?.campos_evidencia_nao_conferida).not.toContain("proxima_pergunta.evidencia");
  });

  it("evidência curta (< 12 caracteres) NUNCA casa, mesmo sendo substring literal (piso do fable-orchestrator)", () => {
    // "regime" tem 6 caracteres e É substring literal de "Regime de casamento"
    // (um dos campos_pendentes_no_bloco do contextoBase()) — sem o piso de
    // comprimento, isso casaria e viraria <blockquote> na tela como se fosse
    // citação real, quando na prática é ruído sem valor probatório.
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: [{ item: "Regime de casamento", evidencia: "regime" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.falta_no_bloco[0]?.evidencia).toBeNull();
    expect(resultado.sugestao?.campos_evidencia_nao_conferida).toContain("falta_no_bloco[0].evidencia");
  });

  it("evidência de exatamente 12 caracteres, se casar, passa (limite inclusivo)", () => {
    // "Regime de ca" tem exatamente 12 caracteres e é prefixo literal de
    // "Regime de casamento".
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: [{ item: "Regime de casamento", evidencia: "Regime de ca" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.falta_no_bloco[0]?.evidencia).toBe("Regime de ca");
  });

  it("evidência de item de falta_no_bloco também é conferida item a item", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: [
        { item: "Regime de casamento", evidencia: "Regime de casamento" }, // casa (está em campos_pendentes_no_bloco)
        { item: "Data de nascimento", evidencia: "nunca foi mencionado" }, // não casa
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.falta_no_bloco[0]?.evidencia).toBe("Regime de casamento");
    expect(resultado.sugestao?.falta_no_bloco[1]?.evidencia).toBeNull();
    expect(resultado.sugestao?.campos_evidencia_nao_conferida).toContain("falta_no_bloco[1].evidencia");
  });

  it("lista falta_no_bloco é cortada em 4 itens (§4.3 do plano)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: Array.from({ length: 7 }, (_, i) => ({ item: `item ${i}`, evidencia: "x" })),
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.falta_no_bloco).toHaveLength(4);
  });
});

describe("validarSugestaoCopiloto — cobriu_no_bloco (0119, o VERDE da condução)", () => {
  it("item com evidência conferida (casa por substring na janela) ENTRA em cobriu_no_bloco", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [{ item: "Confirmar filho ausente", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.cobriu_no_bloco).toEqual([
      { item: "Confirmar filho ausente", evidencia: "meu filho não conseguiu entrar hoje" },
    ]);
  });

  it("REGRA MAIS SEVERA que falta_no_bloco: evidência NÃO conferida descarta o ITEM INTEIRO (não vira {evidencia:null})", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [{ item: "Regime de casamento", evidencia: "isso nunca foi dito na sessão real" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.cobriu_no_bloco).toEqual([]);
    expect(resultado.sugestao?.campos_evidencia_nao_conferida).toContain("cobriu_no_bloco[0].evidencia");
  });

  it("evidência é conferida item a item — um item cai, o outro sobrevive", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [
        { item: "Filho ausente confirmado", evidencia: "meu filho não conseguiu entrar hoje" },
        { item: "Regime de casamento", evidencia: "inventado sem lastro nenhum" },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.cobriu_no_bloco).toHaveLength(1);
    expect(resultado.sugestao?.cobriu_no_bloco?.[0]?.item).toBe("Filho ausente confirmado");
  });

  it("lista cobriu_no_bloco é cortada em 4 itens (mesmo teto de falta_no_bloco)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: Array.from({ length: 7 }, (_, i) => ({
        item: `item ${i}`,
        evidencia: "meu filho não conseguiu entrar hoje",
      })),
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.cobriu_no_bloco?.length).toBeLessThanOrEqual(4);
  });

  it("kill-switch DESLIGADO (acertoErroAtivo=false): cobriu_no_bloco sai SEMPRE vazio, mesmo com evidência boa", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [{ item: "Filho ausente confirmado", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase(), false);
    expect(resultado.sugestao?.cobriu_no_bloco).toEqual([]);
  });

  it("🔴 kill-switch DESLIGADO zera TAMBÉM falta_no_bloco — o vermelho é o lado que acusa", () => {
    // A 1ª versão desta fatia desligava só o VERDE (`cobriu_no_bloco`), com o
    // argumento de que o vermelho já rodava desde a 0094. Isso deixava o
    // interruptor com o escopo invertido: removia o elogio e mantinha a
    // acusação. `falta_no_bloco` é o que aponta a falha da advogada numa tela
    // que ela pode estar compartilhando com o cliente — se um lado tem de ser
    // desligável em segundos, é esse.
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: [{ item: "Não confirmou os 4 SIMs", evidencia: "meu filho não conseguiu entrar hoje" }],
      cobriu_no_bloco: [{ item: "Filho ausente confirmado", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase(), false);
    expect(resultado.sugestao?.falta_no_bloco).toEqual([]);
    expect(resultado.sugestao?.cobriu_no_bloco).toEqual([]);
  });

  it("kill-switch LIGADO: falta_no_bloco continua saindo normalmente (o padrão não muda nada)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      falta_no_bloco: [{ item: "Não confirmou os 4 SIMs", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.falta_no_bloco).toHaveLength(1);
  });

  it("kill-switch LIGADO por padrão (parâmetro omitido) — mesmo comportamento de sempre", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [{ item: "Filho ausente confirmado", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.cobriu_no_bloco).toHaveLength(1);
  });

  it("termo de valor em cobriu_no_bloco recusa a sugestão INTEIRA (mesma regra de qualquer outro campo)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      cobriu_no_bloco: [{ item: "Discutiu o valor de R$ 4.500,00", evidencia: "meu filho não conseguiu entrar hoje" }],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBe("termo_proibido");
    expect(resultado.sugestao).toBeNull();
  });
});

describe("validarSugestaoCopiloto — termo proibido na SAÍDA (B61)", () => {
  it("valor em reais em QUALQUER campo recusa a sugestão INTEIRA", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      observacao: { tipo: "fato", texto: "O cliente pode pagar R$ 4.500,00 hoje", evidencia: "x", confianca: 0.9 },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBe("termo_proibido");
    expect(resultado.sugestao).toBeNull();
  });

  it("menção a honorário/desconto/alíquota também recusa", () => {
    for (const trecho of ["um desconto especial", "a alíquota do ITCMD", "20% de honorário"]) {
      const saida: SugestaoCopilotoIa = {
        ...saidaBase(),
        desvio_sugerido: { bloco_id: "parte_04", motivo: trecho, confianca: 0.7 },
      };
      const resultado = validarSugestaoCopiloto(saida, contextoBase());
      expect(resultado.motivoRecusaTotal).toBe("termo_proibido");
    }
  });

  it("texto sem nenhum termo de valor passa normalmente", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      observacao: { tipo: "hipotese", texto: "O cliente parece preocupado com o filho ausente", evidencia: "x", confianca: 0.6 },
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBeNull();
    expect(resultado.sugestao).not.toBeNull();
  });
});

describe("validarSugestaoCopiloto — tipo de observação fora da lista fechada", () => {
  it("tipo desconhecido cai em hipotese, nunca em fato", () => {
    const saida = {
      ...saidaBase(),
      observacao: { tipo: "certeza_absoluta" as SugestaoCopilotoIa["observacao"] extends null ? never : string, texto: "x", evidencia: "meu filho não conseguiu entrar hoje", confianca: 0.7 },
    } as unknown as SugestaoCopilotoIa;
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.observacao?.tipo).toBe("hipotese");
  });
});

describe("validarSugestaoCopiloto — confiança fora de [0,1] é limitada (clamp)", () => {
  it("confianca_geral acima de 1 ou negativa é limitada ao intervalo", () => {
    const alta = validarSugestaoCopiloto({ ...saidaBase(), confianca_geral: 1.4 }, contextoBase());
    expect(alta.sugestao?.confianca_geral).toBe(1);

    const negativa = validarSugestaoCopiloto({ ...saidaBase(), confianca_geral: -0.3 }, contextoBase());
    expect(negativa.sugestao?.confianca_geral).toBe(0);
  });
});

describe("validarSugestaoCopiloto — inventario_mencionado (17/09/2026)", () => {
  it("item com evidência CONFERIDA (citação literal da janela de transcrição) passa", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "imovel",
          descricao: "a casa da família",
          titularidade: null,
          posse: "propria",
          valor_mencionado: null,
          evidencia: "meu filho não conseguiu entrar hoje", // literal da janela D do contextoBase()
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.inventario_mencionado).toHaveLength(1);
    expect(resultado.sugestao?.inventario_mencionado?.[0]).toMatchObject({ categoria: "imovel", posse: "propria" });
  });

  it("🔴 item SEM evidência conferida não entra — o item inteiro é descartado, nunca só a evidência", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "empresa",
          descricao: "construtora inventada",
          titularidade: null,
          posse: "propria",
          valor_mencionado: null,
          evidencia: "frase que nunca foi dita por ninguém na sessão",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.inventario_mencionado).toEqual([]);
  });

  it("🔴 menção de TERCEIRO (posse='terceiro') passa a validação de evidência normalmente — o filtro de contagem é depois, em resumirInventario", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "empresa",
          descricao: "construtora do genro",
          titularidade: null,
          posse: "terceiro",
          valor_mencionado: null,
          evidencia: "meu filho não conseguiu entrar hoje",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    // O validador NÃO filtra por posse — ele só confere evidência/forma. A
    // exclusão de 'terceiro' do TOTAL acontece em resumirInventario
    // (inventario.test.ts), não aqui: o item continua existindo como fato
    // registrado ("mencionou uma empresa que é de terceiro"), só não conta.
    expect(resultado.sugestao?.inventario_mencionado).toHaveLength(1);
    expect(resultado.sugestao?.inventario_mencionado?.[0]?.posse).toBe("terceiro");
  });

  it("lista cortada em MAX_ITENS_INVENTARIO_POR_CHAMADA itens", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: Array.from({ length: 10 }, (_, i) => ({
        categoria: "outro" as const,
        descricao: `item ${i}`,
        titularidade: null,
        posse: "incerta" as const,
        valor_mencionado: null,
        evidencia: "meu filho não conseguiu entrar hoje",
      })),
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.sugestao?.inventario_mencionado?.length).toBeLessThanOrEqual(6);
  });

  it("valor 'uns 800 mil' (ordem de grandeza em texto) NÃO dispara o filtro de termo proibido", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "imovel",
          descricao: "sala comercial",
          titularidade: null,
          posse: "propria",
          valor_mencionado: "uns 800 mil",
          evidencia: "meu filho não conseguiu entrar hoje",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBeNull();
    expect(resultado.sugestao?.inventario_mencionado?.[0]?.valor_mencionado).toBe("uns 800 mil");
  });

  it("valor com 'R$'/'reais' em inventario_mencionado recusa a sugestão INTEIRA (B61, mesma regra dos outros campos)", () => {
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "imovel",
          descricao: "sala comercial",
          titularidade: null,
          posse: "propria",
          valor_mencionado: "R$ 800.000,00",
          evidencia: "meu filho não conseguiu entrar hoje",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contextoBase());
    expect(resultado.motivoRecusaTotal).toBe("termo_proibido");
    expect(resultado.sugestao).toBeNull();
  });
});

/**
 * 18/09/2026 — achado do `security-pentester`: a `janela_transcricao` mistura
 * fala de TODOS os papéis (`"advogada: ..."`, `"decisor_1: ..."`, etc.) e
 * `evidenciaConferida` só confere a citação por substring, sem saber de quem
 * é a fala. Já aconteceu em produção com o inventário (imóvel da advogada
 * virado patrimônio do cliente) — a correção cobre `inventario_mencionado[]`
 * E `ficha_cliente[]`, a mesma classe de defeito nos dois.
 */
function contextoComJanelaMista(linhasExtra: string[]): ContextoCopiloto {
  return {
    ...contextoBase(),
    janela_transcricao: [...contextoBase().janela_transcricao, ...linhasExtra],
  };
}

describe("validarSugestaoCopiloto — evidência exclusiva da fala da EQUIPE é recusada (18/09/2026)", () => {
  it("🔴 inventario_mencionado: evidência que SÓ casa com fala da advogada descarta o item inteiro", () => {
    const contexto = contextoComJanelaMista(["advogada: arrumei 1 apartamento pra ele no Barra Bali, de frente pra praia"]);
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      inventario_mencionado: [
        {
          categoria: "imovel",
          descricao: "apartamento no Barra Bali",
          titularidade: null,
          posse: "propria",
          valor_mencionado: null,
          evidencia: "arrumei 1 apartamento pra ele no Barra Bali, de frente pra praia",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contexto);
    expect(resultado.sugestao?.inventario_mencionado).toEqual([]);
  });

  it("🔴 ficha_cliente: evidência que SÓ casa com fala do assistente descarta o item inteiro", () => {
    const contexto = contextoComJanelaMista(["assistente: ele falou que tá muito preocupado com a separação dos filhos"]);
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      ficha_cliente: [
        {
          categoria: "dor",
          texto: "preocupação com a separação dos filhos",
          evidencia: "ele falou que tá muito preocupado com a separação dos filhos",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contexto);
    expect(resultado.sugestao?.ficha_cliente).toEqual([]);
  });

  it("evidência AMBÍGUA (casa com fala da equipe E com fala do decisor) é ACEITA — fail-closed aqui apagaria dado legítimo", () => {
    const contexto = contextoComJanelaMista([
      "advogada: e você falou que quer proteger o apartamento da praia, certo?",
      "decisor_1: quero proteger o apartamento da praia",
    ]);
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      ficha_cliente: [
        {
          categoria: "desejo",
          texto: "proteger o apartamento da praia",
          evidencia: "quero proteger o apartamento da praia",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contexto);
    expect(resultado.sugestao?.ficha_cliente).toHaveLength(1);
  });

  it("evidência que casa com fala do decisor (não da equipe) passa normalmente", () => {
    const contexto = contextoComJanelaMista(["decisor_1: minha maior preocupação é meu filho ficar desamparado"]);
    const saida: SugestaoCopilotoIa = {
      ...saidaBase(),
      ficha_cliente: [
        {
          categoria: "dor",
          texto: "medo do filho ficar desamparado",
          evidencia: "minha maior preocupação é meu filho ficar desamparado",
        },
      ],
    };
    const resultado = validarSugestaoCopiloto(saida, contexto);
    expect(resultado.sugestao?.ficha_cliente).toHaveLength(1);
  });
});

describe("sugestaoEVisivel — confiança baixa NÃO aparece na tela, vira histórico (§4.3)", () => {
  it("abaixo do mínimo configurado → não visível", () => {
    expect(sugestaoEVisivel(0.59, 0.6)).toBe(false);
  });

  it("igual ou acima do mínimo → visível", () => {
    expect(sugestaoEVisivel(0.6, 0.6)).toBe(true);
    expect(sugestaoEVisivel(0.95, 0.6)).toBe(true);
  });
});
