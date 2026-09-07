// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { formatarConfianca, formatarDolar, RespostaDoAgente, rotuloIntencao, situacaoDaResposta } from "./agente";
import type { AgenteResposta } from "@/types/agente";

/**
 * O que este arquivo defende: **as três leituras de `AgenteResposta` não podem
 * colapsar em duas**.
 *
 * "texto preenchido + `enviada_em` nulo" (a central recusou, há tarefa aberta)
 * e "texto nulo" (não havia o que dizer) são situações OPOSTAS — uma é conserto
 * de integração, a outra é o porteiro funcionando — e uma lista mal feita
 * escreve "sem resposta" nas duas. É o tipo de erro que só aparece no dia em
 * que o WhatsApp para, que é justamente o dia em que ninguém pode estar lendo
 * a tela errada.
 */

const BASE: AgenteResposta = {
  id: "r1",
  mensagem_recebida_id: "m1",
  jornada_id: "j1",
  conversa_externa_id: "c1",
  intencao: "o_que_falta",
  confianca: 0.82,
  acao: "nenhuma",
  texto: "Falta a certidão de casamento. O link é este: …",
  custo_usd: 0.0004,
  enviada_em: "2026-09-07T12:00:05.000Z",
  erro: null,
  criado_em: "2026-09-07T12:00:00.000Z",
};

describe("situacaoDaResposta", () => {
  it("separa enviada, recusada e sem resposta", () => {
    expect(situacaoDaResposta(BASE)).toBe("enviada");
    expect(situacaoDaResposta({ ...BASE, enviada_em: null })).toBe("recusada");
    expect(situacaoDaResposta({ ...BASE, texto: null, enviada_em: null })).toBe("sem_resposta");
    // Texto em branco é ausência de texto, não frase vazia enviada.
    expect(situacaoDaResposta({ ...BASE, texto: "   " })).toBe("sem_resposta");
  });
});

describe("rótulos e números", () => {
  it("traduz a intenção para a língua do escritório e nunca mostra o valor cru", () => {
    expect(rotuloIntencao("fora_do_tema")).toBe("Fora do assunto");
    expect(rotuloIntencao("duvida_juridica")).toBe("Dúvida jurídica");
    expect(rotuloIntencao(null)).toBe("Sem intenção registrada");
    // Intenção que a tela ainda não conhece vira texto legível, nunca `snake_case`.
    expect(rotuloIntencao("intencao_nova")).toBe("intencao nova");
  });

  it("custo é DÓLAR — usar o formatador de reais escreveria R$ num valor cobrado em USD", () => {
    const texto = formatarDolar(0.0004);
    expect(texto).toBeTruthy();
    expect(texto).not.toContain("R$");
    expect(texto).toMatch(/US\$|\$/);
    expect(formatarDolar(null)).toBeNull();
  });

  it("confiança vira porcentagem inteira, número primeiro", () => {
    expect(formatarConfianca(0.82)).toBe("82% de certeza");
    expect(formatarConfianca(null)).toBeNull();
  });
});

describe("RespostaDoAgente", () => {
  it("enviada: diz quem escreveu, mostra a frase e não fala em recusa", () => {
    const { container } = montar(<RespostaDoAgente resposta={BASE} />);
    expect(container.textContent).toContain("Respondido pelo agente");
    expect(container.textContent).toContain("Falta a certidão de casamento");
    expect(container.textContent).toContain("O que falta");
    expect(container.textContent).toContain("82% de certeza");
    expect(container.textContent).not.toContain("Não enviado");
  });

  it("recusada: mostra a frase montada E diz que ela não saiu, com caminho para a tarefa", () => {
    const { container } = montar(<RespostaDoAgente resposta={{ ...BASE, enviada_em: null, erro: "chatwoot_503" }} hrefTarefa="/jornadas/j1" />);
    // A frase continua visível: é o que a equipe reenvia à mão.
    expect(container.textContent).toContain("Falta a certidão de casamento");
    expect(container.textContent).toContain("Não enviado");
    // A sigla do provedor nunca aparece no fluxo — só no `title` (DS §2.2).
    expect(container.textContent).not.toContain("Chatwoot");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/jornadas/j1"]')?.textContent).toBe("Abrir a tarefa");
  });

  it("sem resposta: não finge que houve frase e leva o motivo para o title", () => {
    const { container } = montar(<RespostaDoAgente resposta={{ ...BASE, texto: null, enviada_em: null, erro: "sem_consentimento" }} />);
    expect(container.textContent).toContain("O agente não respondeu");
    expect(container.textContent).not.toContain("Não enviado");
    expect(container.querySelector('[title="sem_consentimento"]')).toBeTruthy();
  });

  it("sem custo de IA é dito, não omitido — resposta de texto fixo custa zero e isso é a boa notícia", () => {
    const { container } = montar(<RespostaDoAgente resposta={{ ...BASE, custo_usd: null }} />);
    expect(container.textContent).toContain("sem custo de IA");
  });

  it("não tem violação de acessibilidade nas três leituras", async () => {
    await semViolacoes(montar(<RespostaDoAgente resposta={BASE} />).container);
    await semViolacoes(montar(<RespostaDoAgente resposta={{ ...BASE, enviada_em: null }} hrefTarefa="/jornadas/j1" />).container);
    await semViolacoes(montar(<RespostaDoAgente resposta={{ ...BASE, texto: null, enviada_em: null }} />).container);
  });
});
