/**
 * A FASE do croqui (Fase 8, D12) — `faseDoCroqui`, `proximaFaseDoCroqui` e os
 * dois adaptadores que a alimentam (`sinaisDaFicha`, `sinaisDoKanban`).
 *
 * O que estes casos protegem, em uma frase: **a Ficha e a lista de Clientes
 * têm de dizer a MESMA fase**, e nenhuma das duas pode inventar fase quando a
 * fonte não sabe. É a regressão do incidente da 0070 (fixar uma versão de
 * cálculo anunciava "croqui pronto") vista do lado do TypeScript.
 *
 * Funções puras: nenhum banco, nenhuma rede. O que falhar aqui falha igual em
 * produção — a parte de banco é provada por `scripts/verificacao-0086.sql`.
 */
import { describe, expect, it } from "vitest";

import { faseDoCroqui, proximaFaseDoCroqui, sinaisDaFicha, sinaisDoKanban, sinaisVazios, type CroquiFase } from "@/lib/pasta/sinais";
import { derivarPastaDeSinais } from "@/lib/pasta/derivar";
import { derivarTrilho } from "@/lib/pasta/trilho";
import type { EventoTimeline, Ficha360, JornadaKanban } from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures mínimas — só o que cada função lê.
// ---------------------------------------------------------------------------

function evento(parcial: Partial<EventoTimeline> & { tipo: string }): EventoTimeline {
  return {
    id: Math.random().toString(36).slice(2),
    jornada_id: "j1",
    tipo: parcial.tipo,
    titulo: parcial.titulo ?? "evento",
    descricao: parcial.descricao ?? null,
    dados: parcial.dados ?? {},
    ator_tipo: parcial.ator_tipo ?? "sistema",
    ator_perfil_id: null,
    ocorrido_em: parcial.ocorrido_em ?? "2026-09-05T12:00:00Z",
  } as EventoTimeline;
}

function ficha(parcial: Partial<Ficha360> & Record<string, unknown> = {}): Ficha360 {
  return {
    jornada: { id: "j1", etapa: "croqui_contratado", nivel_pago: 2, desfecho: "aberta" },
    pessoa: { id: "p1", nome: "Fulano" },
    formulario: null,
    ligacao: null,
    briefingAtual: null,
    sessao: null,
    relatorio: null,
    agendamentos: [],
    documentos: [],
    timeline: [],
    patrimonio: null,
    familiares: null,
    materialAtual: null,
    ...parcial,
  } as unknown as Ficha360;
}

function kanban(parcial: Record<string, unknown>): JornadaKanban {
  return { id: "j1", etapa: "croqui_contratado", nivel_pago: 2, ...parcial } as unknown as JornadaKanban;
}

// ---------------------------------------------------------------------------

describe("faseDoCroqui — uma derivação, três degraus", () => {
  it("A · a view manda: `croquiFase` vence o estado editorial", () => {
    // A jornada tem um croqui em `rascunho` E um cálculo fixado. O enum diz
    // "rascunho"; a fase real é "fixado". Antes da Fase 8 a tela dizia
    // rascunho, e a advogada que já tinha rodado o motor não via isso.
    expect(faseDoCroqui({ croquiFase: "fixado", croquiStatus: "rascunho" })).toBe("fixado");
  });

  it("B · sem a view, cai no estado editorial — dizer menos, nunca dizer errado", () => {
    expect(faseDoCroqui({ croquiFase: null, croquiStatus: "pronto" })).toBe("pronto");
  });

  it("C · `nenhum` vira `sem_croqui` (o mesmo fato, o vocabulário do catálogo)", () => {
    expect(faseDoCroqui({ croquiFase: null, croquiStatus: "nenhum" })).toBe("sem_croqui");
  });

  it("D · sem informação continua sem informação — nunca vira `sem_croqui`", () => {
    // A diferença importa: `sem_croqui` afirma que não existe croqui;
    // `null` diz que este payload não sabe. Papel sem permissão de ver
    // patrimônio cai aqui, e afirmar o fato vazaria o fato pela ausência.
    expect(faseDoCroqui({ croquiFase: null, croquiStatus: null })).toBeNull();
  });
});

describe("a Ficha e a lista dizem a MESMA fase", () => {
  const CASOS: { nome: string; fase: CroquiFase; editorial: string }[] = [
    { nome: "rascunho sem cálculo", fase: "rascunho", editorial: "rascunho" },
    { nome: "calculado", fase: "calculado", editorial: "rascunho" },
    { nome: "fixado", fase: "fixado", editorial: "rascunho" },
    { nome: "pronto", fase: "pronto", editorial: "pronto" },
    { nome: "apresentado", fase: "apresentado", editorial: "apresentado" },
  ];

  for (const caso of CASOS) {
    it(`E · ${caso.nome}: sinaisDaFicha e sinaisDoKanban convergem`, () => {
      const daFicha = sinaisDaFicha(
        ficha({ croquiEstado: { fase: caso.fase, status_editorial: caso.editorial, exportado_em: null, narrado_em: null } }),
      );
      const daLista = sinaisDoKanban(kanban({ croqui_fase: caso.fase, croqui_status: caso.editorial }));
      expect(faseDoCroqui(daFicha)).toBe(caso.fase);
      expect(faseDoCroqui(daLista)).toBe(faseDoCroqui(daFicha));
    });
  }

  it("F · sem croqui: a view não devolve linha e as duas dizem `sem_croqui`", () => {
    const daFicha = sinaisDaFicha(ficha({ croquiEstado: null }));
    const daLista = sinaisDoKanban(kanban({ croqui_fase: "sem_croqui", croqui_status: null }));
    expect(faseDoCroqui(daFicha)).toBe("sem_croqui");
    expect(faseDoCroqui(daLista)).toBe("sem_croqui");
  });

  it("G · lista sem a coluna (view antiga) → sem informação, não `sem_croqui`", () => {
    expect(sinaisDoKanban(kanban({})).croquiFase).toBeNull();
    expect(faseDoCroqui(sinaisDoKanban(kanban({})))).toBeNull();
  });

  it("H · lista com `croqui_fase` NULL (papel sem patrimônio) → sem informação", () => {
    expect(faseDoCroqui(sinaisDoKanban(kanban({ croqui_fase: null })))).toBeNull();
  });

  it("I · valor desconhecido na coluna não vira fase plausível", () => {
    expect(sinaisDoKanban(kanban({ croqui_fase: "em_aprovacao" })).croquiFase).toBeNull();
  });
});

describe("a regressão da 0070 continua fechada", () => {
  it("J · evento de cálculo na timeline não faz o croqui virar `pronto`", () => {
    const sinais = sinaisDaFicha(
      ficha({
        timeline: [
          evento({ tipo: "croqui_calculo", titulo: "Versão fixada", dados: { calculo_id: "c1" } }),
          evento({ tipo: "croqui", titulo: "Croqui criado", dados: { croqui_id: "cr1", status: "rascunho" } }),
        ],
      }),
    );
    expect(sinais.croquiStatus).toBe("rascunho");
    expect(faseDoCroqui(sinais)).toBe("rascunho");
  });

  it("K · exportação sem croqui não inventa estado", () => {
    const sinais = sinaisDaFicha(
      ficha({ timeline: [evento({ tipo: "croqui_exportacao", titulo: "Relatório exportado", dados: { destino: "download" } })] }),
    );
    expect(faseDoCroqui(sinais)).toBe("sem_croqui");
  });

  it("L · a view responde mesmo com a timeline dizendo outra coisa", () => {
    // Timeline diz `rascunho` (o último evento de croqui), a view diz `fixado`.
    // Quem manda é a view: ela olha `croqui_calculos`, a timeline não.
    const sinais = sinaisDaFicha(
      ficha({
        timeline: [evento({ tipo: "croqui", dados: { croqui_id: "cr1", status: "rascunho" } })],
        croquiEstado: { fase: "fixado", status_editorial: "rascunho", exportado_em: null, narrado_em: null },
      }),
    );
    expect(faseDoCroqui(sinais)).toBe("fixado");
  });
});

describe("os dois FATOS não são fase", () => {
  it("M · exportado/narrado saem em `croquiFatos` e não mexem na fase", () => {
    const sinais = sinaisDaFicha(
      ficha({
        croquiEstado: {
          fase: "rascunho",
          status_editorial: "rascunho",
          exportado_em: "2026-09-06T10:00:00Z",
          narrado_em: null,
        },
      }),
    );
    expect(faseDoCroqui(sinais)).toBe("rascunho");
    expect(sinais.croquiFatos).toEqual({ exportadoEm: "2026-09-06T10:00:00Z", narradoEm: null });
  });

  it("N · sem a view, `croquiFatos` é null — nunca `{exportado: false}`", () => {
    expect(sinaisDaFicha(ficha({ timeline: [] })).croquiFatos).toBeNull();
  });
});

describe("proximaFaseDoCroqui — o sistema guia", () => {
  it("O · cada fase incompleta tem uma frase e uma ação", () => {
    for (const fase of ["sem_croqui", "rascunho", "calculado", "fixado", "pronto"] as CroquiFase[]) {
      const proxima = proximaFaseDoCroqui(fase);
      expect(proxima, fase).not.toBeNull();
      expect(proxima!.falta.length).toBeGreaterThan(0);
      expect(proxima!.acao.length).toBeGreaterThan(0);
    }
  });

  it("P · apresentado e sem informação não geram instrução", () => {
    expect(proximaFaseDoCroqui("apresentado")).toBeNull();
    // Instrução sobre estado que não se sabe é chute.
    expect(proximaFaseDoCroqui(null)).toBeNull();
  });
});

describe("os consumidores da fase (a derivação apagada dos 4 lugares)", () => {
  it("Q · a Pasta distingue calculado e fixado, que antes eram 'em rascunho'", () => {
    const base = ficha({ sessao: { id: "s1", realizada_em: "2026-09-01T12:00:00Z" } as never });
    const notas = (fase: CroquiFase) => {
      const sinais = { ...sinaisDaFicha(base), croquiFase: fase };
      return derivarPastaDeSinais(base, sinais, true).find((i) => i.chave === "croqui");
    };
    expect(notas("rascunho")?.nota).toContain("rascunho");
    expect(notas("calculado")?.nota).toContain("Calculado");
    expect(notas("fixado")?.nota).toContain("fixada");
    expect(notas("apresentado")?.estado).toBe("pronto");
  });

  it("R · o trilho fecha o passo do croqui só em `apresentado`", () => {
    const passo = (fase: CroquiFase | null) =>
      derivarTrilho({ ...sinaisVazios(), nivelPago: 2, croquiFase: fase }, Date.parse("2026-09-07T12:00:00Z")).find(
        (p) => p.chave === "croqui",
      );
    expect(passo("apresentado")?.estado).toBe("feito");
    expect(passo("pronto")?.estado).toBe("futuro");
    expect(passo("pronto")?.motivo).toBe("pronto para apresentar");
    expect(passo("fixado")?.motivo).toBe("versão fixada");
    expect(passo(null)?.motivo).toBe("sem informação");
  });

  it("S · holding fechada sem croqui continua sendo passo `pulado`", () => {
    const passos = derivarTrilho(
      { ...sinaisVazios(), nivelPago: 3, croquiFase: "sem_croqui" },
      Date.parse("2026-09-07T12:00:00Z"),
    );
    expect(passos.find((p) => p.chave === "croqui")?.estado).toBe("pulado");
  });
});
