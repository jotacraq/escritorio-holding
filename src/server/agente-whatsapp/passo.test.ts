import { describe, expect, it } from "vitest";
import { derivarPassoDoAgente, podeEmitirLink, sinaisDoAgente, type SinaisBrutoAgente } from "./passo";

/**
 * A máquina de passos do agente É `derivarProximoPasso()` — estes testes não
 * repetem os 27 casos de mesa dela (isso é `trilho.test.ts`). O que se prova
 * aqui é a TRADUÇÃO: a linha da RPC vira `Sinais` sem inventar nada, e o passo
 * derivado autoriza (ou não) cada link.
 */

const bruto = (campos: Partial<SinaisBrutoAgente> = {}): SinaisBrutoAgente => ({
  jornada_id: "j1",
  pessoa_id: "p1",
  primeiro_nome: "Ana",
  pessoa_origem_dado: "real",
  jornada_origem_dado: "real",
  desfecho: "aberta",
  etapa: "croqui_contratado",
  nivel_pago: 2,
  nivel_pago_vigente: 2,
  tem_formulario: true,
  tem_ligacao: true,
  tem_briefing: true,
  tem_documentos: false,
  proxima_sessao_em: null,
  presenca_confirmada_em: null,
  sessao_realizada_em: "2026-08-01T12:00:00Z",
  tem_relatorio: true,
  croqui_status: null,
  material_estado: "aprovado",
  tarefas_abertas: [],
  ...campos,
});

describe("sinaisDoAgente — tri-estado preservado", () => {
  it("o TETO vigente manda sobre o piso histórico (Fase 8, D4)", () => {
    expect(sinaisDoAgente(bruto({ nivel_pago: 2, nivel_pago_vigente: 0 })).nivelPago).toBe(0);
  });

  it("sem sessão marcada, presença fica `null` — nunca `false`", () => {
    expect(sinaisDoAgente(bruto({ proxima_sessao_em: null })).presencaConfirmada).toBeNull();
  });

  it("com sessão marcada e sem confirmação, presença é false", () => {
    const s = sinaisDoAgente(bruto({ proxima_sessao_em: "2030-01-01T12:00:00Z", presenca_confirmada_em: null }));
    expect(s.presencaConfirmada).toBe(false);
  });

  it("etapa desconhecida vira null em vez de virar rótulo inventado", () => {
    expect(sinaisDoAgente(bruto({ etapa: "etapa_que_nao_existe" })).etapa).toBeNull();
  });

  it("croqui ausente é `nenhum`; valor estranho é `null`", () => {
    expect(sinaisDoAgente(bruto({ croqui_status: null })).croquiStatus).toBe("nenhum");
    expect(sinaisDoAgente(bruto({ croqui_status: "meio_pronto" })).croquiStatus).toBeNull();
  });
});

describe("derivarPassoDoAgente", () => {
  it("croqui contratado sem documentos: o passo é do CLIENTE e prevê o /p/d", () => {
    const p = derivarPassoDoAgente(sinaisDoAgente(bruto()));
    expect(p.proximo.chave).toBe("documentos");
    expect(p.ehDoCliente).toBe(true);
    expect(p.linkPrevisto).toBe("documentos");
    expect(p.intencaoEsperada).toBe("enviar_documento");
  });

  it("passo da equipe não é do cliente e não prevê link", () => {
    const s = sinaisDoAgente(bruto({ etapa: "sessao_contratada", nivel_pago_vigente: 1, tem_ligacao: false, sessao_realizada_em: null, tem_relatorio: null }));
    const p = derivarPassoDoAgente(s);
    expect(p.proximo.dono).toBe("equipe");
    expect(p.ehDoCliente).toBe(false);
    expect(p.linkPrevisto).toBeNull();
  });

  it("sessão marcada e sem confirmação prevê o /p/c", () => {
    const daqui2Dias = new Date("2026-09-09T12:00:00Z").toISOString();
    const s = sinaisDoAgente(
      bruto({
        etapa: "sessao_agendada",
        nivel_pago_vigente: 1,
        sessao_realizada_em: null,
        tem_relatorio: null,
        proxima_sessao_em: daqui2Dias,
        presenca_confirmada_em: null,
        tem_documentos: null,
        material_estado: null,
        croqui_status: undefined,
      }),
    );
    const p = derivarPassoDoAgente(s, Date.parse("2026-09-07T12:00:00Z"));
    expect(p.proximo.chave).toBe("confirmar_presenca");
    expect(p.linkPrevisto).toBe("confirmacao");
  });
});

describe("podeEmitirLink — o modelo REDIGE, o banco DECIDE (D21)", () => {
  const passoDocumentos = derivarPassoDoAgente(sinaisDoAgente(bruto()));

  it("obedece quando o passo já previa aquele link", () => {
    expect(podeEmitirLink(passoDocumentos, "enviar_documento")).toBe(true);
    expect(podeEmitirLink(passoDocumentos, "o_que_falta")).toBe(true);
  });

  it("recusa o link que o passo NÃO previa, mesmo com o cliente pedindo", () => {
    expect(podeEmitirLink(passoDocumentos, "confirmar_horario")).toBe(false);
    expect(podeEmitirLink(passoDocumentos, "preco_prazo")).toBe(false);
    expect(podeEmitirLink(passoDocumentos, "fora_do_tema")).toBe(false);
  });

  it("passo sem link não emite nada, para nenhuma intenção", () => {
    const semLink = derivarPassoDoAgente(sinaisDoAgente(bruto({ tem_documentos: true, croqui_status: "rascunho" })));
    expect(semLink.linkPrevisto).toBeNull();
    for (const i of ["enviar_documento", "confirmar_horario", "o_que_falta"] as const) {
      expect(podeEmitirLink(semLink, i)).toBe(false);
    }
  });
});
