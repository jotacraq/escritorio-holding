import { describe, expect, it } from "vitest";
import { CHAVES_CONFIGURACAO, SCHEMAS_CONFIGURACAO, ehChaveConfiguracaoConhecida } from "./configuracoes";
import { CHAVES_AGENTE } from "@/server/agente-whatsapp/config";

/**
 * `PATCH /api/admin/configuracoes/[chave]` responde 404 para toda chave que
 * não estiver em `SCHEMAS_CONFIGURACAO`. Já aconteceu três vezes nesta base
 * (`link.limite_global_por_minuto`, `link.limite_arquivos` e, na Fase 9, as 7
 * do agente): a chave nasce por migration, a tela mostra o campo, e o
 * "Salvar" responde 404 sem que nenhum teste perceba.
 *
 * Este arquivo é a trava: TODA chave que o servidor lê de `configuracoes` tem
 * de ser editável (ou estar declarada como somente-leitura).
 */

describe("SCHEMAS_CONFIGURACAO — as 7 chaves do agente de WhatsApp (0088)", () => {
  it("todas as chaves que `lerConfigAgente` lê são editáveis pela tela", () => {
    for (const chave of CHAVES_AGENTE) {
      expect(ehChaveConfiguracaoConhecida(chave), `${chave} não está em SCHEMAS_CONFIGURACAO → PATCH 404`).toBe(true);
    }
    expect(CHAVES_CONFIGURACAO).toEqual(expect.arrayContaining([...CHAVES_AGENTE]));
  });

  it("`ativo` é booleano e nada mais — 'true' em texto não liga o agente", () => {
    const schema = SCHEMAS_CONFIGURACAO["agente_whatsapp.ativo"];
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(true);
    expect(schema.safeParse("true").success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it("silêncio do humano: 1..480 min — 0 faria o robô falar por cima da equipe", () => {
    const s = SCHEMAS_CONFIGURACAO["agente_whatsapp.silencio_humano_minutos"];
    expect(s.safeParse(0).success).toBe(false);
    expect(s.safeParse(1).success).toBe(true);
    expect(s.safeParse(30).success).toBe(true);
    expect(s.safeParse(480).success).toBe(true);
    expect(s.safeParse(481).success).toBe(false);
    expect(s.safeParse(1.5).success).toBe(false);
  });

  it("esquivas até o humano: 1..5 — 0 mandaria a 1ª mensagem fora do tema direto para a fila", () => {
    const s = SCHEMAS_CONFIGURACAO["agente_whatsapp.esquivas_ate_humano"];
    expect(s.safeParse(0).success).toBe(false);
    expect(s.safeParse(2).success).toBe(true);
    expect(s.safeParse(6).success).toBe(false);
  });

  it("intervalo entre links: 1..168 h — 0 deixaria o cliente derrubar o próprio link a cada mensagem", () => {
    const s = SCHEMAS_CONFIGURACAO["agente_whatsapp.intervalo_link_horas"];
    expect(s.safeParse(0).success).toBe(false);
    expect(s.safeParse(6).success).toBe(true);
    expect(s.safeParse(169).success).toBe(false);
  });

  it("teto de respostas por hora: 1..60", () => {
    const s = SCHEMAS_CONFIGURACAO["agente_whatsapp.teto_respostas_hora"];
    expect(s.safeParse(0).success).toBe(false);
    expect(s.safeParse(6).success).toBe(true);
    expect(s.safeParse(61).success).toBe(false);
  });

  it("tetos de IA aceitam 0 — é assim que se desliga SÓ a IA e ficam as respostas fixas", () => {
    for (const chave of ["agente_whatsapp.teto_ia_jornada_dia", "agente_whatsapp.teto_ia_dia"] as const) {
      expect(SCHEMAS_CONFIGURACAO[chave].safeParse(0).success).toBe(true);
      expect(SCHEMAS_CONFIGURACAO[chave].safeParse(-1).success).toBe(false);
    }
    expect(SCHEMAS_CONFIGURACAO["agente_whatsapp.teto_ia_jornada_dia"].safeParse(201).success).toBe(false);
    expect(SCHEMAS_CONFIGURACAO["agente_whatsapp.teto_ia_dia"].safeParse(5001).success).toBe(false);
  });

  it("chave que não existe continua sendo 404 (nada de jsonb arbitrário)", () => {
    expect(ehChaveConfiguracaoConhecida("agente_whatsapp.inventada")).toBe(false);
    expect(ehChaveConfiguracaoConhecida("agente_whatsapp")).toBe(false);
  });
});
