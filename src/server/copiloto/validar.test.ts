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
    resumo_acumulado: {},
    roteiro_ativo_blocos_ids: ["parte_00", "parte_01", "parte_02", "parte_03", "parte_04"],
  };
}

function saidaBase(): SugestaoCopilotoIa {
  return {
    proxima_pergunta: null,
    falta_no_bloco: [],
    observacao: null,
    desvio_sugerido: null,
    confianca_geral: 0.8,
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

describe("sugestaoEVisivel — confiança baixa NÃO aparece na tela, vira histórico (§4.3)", () => {
  it("abaixo do mínimo configurado → não visível", () => {
    expect(sugestaoEVisivel(0.59, 0.6)).toBe(false);
  });

  it("igual ou acima do mínimo → visível", () => {
    expect(sugestaoEVisivel(0.6, 0.6)).toBe(true);
    expect(sugestaoEVisivel(0.95, 0.6)).toBe(true);
  });
});
