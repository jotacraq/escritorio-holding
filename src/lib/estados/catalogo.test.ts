import { describe, expect, it } from "vitest";
import { ESTADOS, classificarIntegracao, classificarPrazo, estadoDe, rotuloEstado, type DominioEstado } from "./catalogo";
import { NOMES_DE_ICONE } from "./icones";

const DOMINIOS = Object.keys(ESTADOS) as DominioEstado[];

describe("catálogo de estados", () => {
  it("todo estado tem rótulo, glifo existente e tom", () => {
    for (const dominio of DOMINIOS) {
      for (const [chave, definicao] of Object.entries(ESTADOS[dominio])) {
        expect(definicao.rotulo.length, `${dominio}.${chave}`).toBeGreaterThan(0);
        expect(NOMES_DE_ICONE, `${dominio}.${chave}`).toContain(definicao.icone);
        expect(definicao.tom, `${dominio}.${chave}`).toBeTruthy();
      }
    }
  });

  it("dentro de um domínio, dois estados nunca dividem o mesmo glifo", () => {
    // É esta a garantia de que a tela continua legível em grayscale: se dois
    // estados do mesmo domínio tivessem o mesmo ícone, só a cor os separaria.
    for (const dominio of DOMINIOS) {
      const glifos = Object.values(ESTADOS[dominio]).map((e) => e.icone);
      expect(new Set(glifos).size, `${dominio} repete glifo`).toBe(glifos.length);
    }
  });

  it("nenhum rótulo passa de 4 palavras (lei de texto do DS §2.2)", () => {
    for (const dominio of DOMINIOS) {
      for (const [chave, definicao] of Object.entries(ESTADOS[dominio])) {
        expect(definicao.rotulo.split(/\s+/).length, `${dominio}.${chave}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("cobre os valores do enum do banco que viram selo", () => {
    // Enum `status_pagamento` depois da migration 0083 e `desfecho_jornada`.
    for (const valor of ["pendente", "em_analise", "aprovado", "cancelado", "estornado", "reembolsado", "boleto_gerado", "expirado", "atrasado"]) {
      expect(estadoDe("pagamento", valor), valor).not.toBeNull();
    }
    for (const valor of ["aberta", "ganha", "perdida", "descartada", "congelada"]) {
      expect(estadoDe("processo", valor), valor).not.toBeNull();
    }
    for (const valor of ["agendado", "confirmado", "realizado", "nao_compareceu", "cancelado", "remarcado"]) {
      expect(estadoDe("agendamento", valor), valor).not.toBeNull();
    }
    for (const valor of ["pendente", "enviando", "enviada", "falhou", "cancelada"]) {
      expect(estadoDe("mensagem", valor), valor).not.toBeNull();
    }
  });

  it("congelada aparece como Arquivado (ordem do João, entrada nova do glossário)", () => {
    expect(rotuloEstado("processo", "congelada")).toBe("Arquivado");
  });

  it("C23: `confirmado` é o cliente ESCOLHENDO o horário, não confirmando presença", () => {
    // `docs/ARQUITETURA-FASE-4.md:1047`. A presença mora em
    // `agendamentos.presenca_confirmada_em`, e o enum não fala dela.
    expect(rotuloEstado("agendamento", "confirmado")).toBe("Horário marcado");
    expect(estadoDe("agendamento", "confirmado")?.explique).toContain("escolheu");
    expect(estadoDe("agendamento", "confirmado")?.explique).not.toContain("confirmou presença");
  });

  it("`presenca` é alias de `agendamento` — não há como divergirem", () => {
    // A Agenda do UX3 já consome `dominio="presenca"`; alias mantém a tela
    // correta sem duplicar tabela (que é como dois rótulos nascem para o
    // mesmo estado).
    expect(ESTADOS.presenca).toBe(ESTADOS.agendamento);
    for (const valor of ["agendado", "confirmado", "realizado", "nao_compareceu", "cancelado", "remarcado"]) {
      expect(estadoDe("presenca", valor), valor).toEqual(estadoDe("agendamento", valor));
    }
  });

  it("estado desconhecido devolve null e vira 'Sem informação', nunca um rótulo plausível", () => {
    expect(estadoDe("pagamento", "quase_pago")).toBeNull();
    expect(estadoDe("pagamento", null)).toBeNull();
    expect(estadoDe("pagamento", "")).toBeNull();
    expect(rotuloEstado("pagamento", "quase_pago")).toBe("Sem informação");
  });

  it("não devolve nada do protótipo", () => {
    expect(estadoDe("processo", "constructor")).toBeNull();
    expect(estadoDe("processo", "__proto__")).toBeNull();
    expect(estadoDe("processo", "toString")).toBeNull();
  });
});

describe("classificarIntegracao", () => {
  it("cobre o que Admin → Integrações mostra hoje", () => {
    expect(classificarIntegracao({ configurado: true })).toBe("ligada");
    expect(classificarIntegracao({ configurado: true, pendencia: "3 produtos sem ID" })).toBe("parcial");
    expect(classificarIntegracao({ configurado: false })).toBe("desligada");
    expect(classificarIntegracao({ configurado: true, testeOk: false })).toBe("erro");
    expect(rotuloEstado("integracao", classificarIntegracao({ configurado: true }))).toBe("Ligada");
  });

  it("sem informação do servidor é 'Estado desconhecido', NUNCA 'desligada'", () => {
    // Sem `SUPABASE_SERVICE_ROLE_KEY` o Admin não sabe o estado. Dizer
    // "desligada" seria inventar um fato — e o oposto do que está acontecendo.
    expect(classificarIntegracao({ configurado: null })).toBe("desconhecida");
    expect(classificarIntegracao({ configurado: undefined, testeOk: false })).toBe("desconhecida");
    expect(rotuloEstado("integracao", "desconhecida")).toBe("Estado desconhecido");
  });

  it("pendência só em branco não vira 'parcial'", () => {
    expect(classificarIntegracao({ configurado: true, pendencia: "   " })).toBe("ligada");
    expect(classificarIntegracao({ configurado: true, pendencia: null })).toBe("ligada");
  });
});

describe("classificarPrazo", () => {
  const hoje = new Date(2026, 8, 7, 15, 0); // 07/09/2026, 15h local

  it("classifica por DIA, não por 24h corridas", () => {
    // Prazo de hoje às 8h continua sendo "hoje" às 15h — para o advogado o
    // prazo é do dia, não do instante.
    expect(classificarPrazo(new Date(2026, 8, 7, 8, 0), hoje)).toBe("hoje");
    expect(classificarPrazo(new Date(2026, 8, 6, 23, 59), hoje)).toBe("vencido");
    expect(classificarPrazo(new Date(2026, 8, 8, 0, 30), hoje)).toBe("proximo");
  });

  it("aceita o `date` do Postgres sem cair no fuso (o furo do UTC−3)", () => {
    // `new Date("2026-09-07")` é meia-noite UTC = 06/09 21h em São Paulo.
    // Sem tratamento, o prazo de HOJE apareceria vencido.
    expect(classificarPrazo("2026-09-07", hoje)).toBe("hoje");
    expect(classificarPrazo("2026-09-06", hoje)).toBe("vencido");
    expect(classificarPrazo("2026-09-09", hoje)).toBe("proximo");
    expect(classificarPrazo("2026-09-30", hoje)).toBe("futuro");
  });

  it("sem data e data inválida viram 'sem_prazo' — nunca 'no prazo'", () => {
    expect(classificarPrazo(null, hoje)).toBe("sem_prazo");
    expect(classificarPrazo(undefined, hoje)).toBe("sem_prazo");
    expect(classificarPrazo("", hoje)).toBe("sem_prazo");
    expect(classificarPrazo("depois do carnaval", hoje)).toBe("sem_prazo");
  });
});
