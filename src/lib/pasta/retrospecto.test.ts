/**
 * Fase 13, FE-9 — o item `retrospecto_sv` na Pasta do Cliente.
 *
 * Função pura, sem banco e sem rede: o que falhar aqui falha igual em
 * produção. Os três estados que o §D.6 do plano exige, e a regra que os
 * governa:
 *
 *  - `pronto` — existe retrospecto gravado para a sessão (evento de timeline).
 *  - `ainda_nao` — a sessão não aconteceu. O retrospecto é o FECHAMENTO do
 *    copiloto: antes da sessão não há copiloto nenhum para fechar, então
 *    nunca é alarme (`falta`) — é "não é hora ainda".
 *  - `falta` — a sessão aconteceu e não há retrospecto.
 *
 * E a regra de segurança, que vale para todo item com `requerPatrimonio`: o
 * corpo do Retrospecto carrega objeção/dor/desejo com citação literal de
 * família real, então quem não vê patrimônio não vê nem a EXISTÊNCIA do item
 * — ele é OMITIDO do array, nunca listado como "bloqueado" (mesma classe do
 * achado de pentest sobre `temAnaliseSessao`).
 */
import { describe, expect, it } from "vitest";

import { derivarPasta } from "@/lib/pasta/derivar";
import { ABA_POR_ITEM_PASTA, ACAO_POR_ITEM_PASTA } from "@/lib/pasta/rotas";
import { CATALOGO_PASTA, SESSAO_POR_ITEM } from "@/lib/pasta/catalogo";
import { TABS_FICHA, tabDoItem } from "@/lib/pasta/tabs";
import type { EventoTimeline, Ficha360 } from "@/lib/api";

function evento(tipo: string): EventoTimeline {
  return {
    id: Math.random().toString(36).slice(2),
    jornada_id: "j1",
    tipo,
    titulo: tipo,
    descricao: null,
    dados: {},
    ator_tipo: "sistema",
    ator_perfil_id: null,
    ocorrido_em: "2026-09-19T20:00:00Z",
  } as unknown as EventoTimeline;
}

function ficha(parcial: Partial<Ficha360> & Record<string, unknown> = {}): Ficha360 {
  return {
    jornada: { id: "j1", etapa: "sessao_contratada", nivel_pago: 1, desfecho: "aberta" },
    pessoa: { id: "p1", nome: "Fulano" },
    formulario: null,
    ligacao: null,
    briefingAtual: null,
    sessao: null,
    relatorio: null,
    agendamentos: [],
    documentos: [],
    timeline: [],
    patrimonio: [],
    familiares: [],
    materialAtual: null,
    ...parcial,
  } as unknown as Ficha360;
}

/** Marca a sessão como REALIZADA pelo mesmo sinal que `sinaisDaFicha` lê. */
const SESSAO_REALIZADA = {
  sessao: { id: "s1", jornada_id: "j1", realizada_em: "2026-09-19T18:00:00Z", link_sala: null } as unknown as Ficha360["sessao"],
};

function itemRetrospecto(f: Ficha360, podeVerPatrimonio = true) {
  return derivarPasta(f, podeVerPatrimonio).find((i) => i.chave === "retrospecto_sv") ?? null;
}

describe("Pasta — `retrospecto_sv`, os três estados", () => {
  it("sessão não realizada → `ainda_nao`, nunca alarme", () => {
    const item = itemRetrospecto(ficha());
    expect(item?.estado).toBe("ainda_nao");
    expect(item?.nota).toBe("Só depois da sessão.");
  });

  it("sessão realizada e sem retrospecto → `falta`", () => {
    const item = itemRetrospecto(ficha(SESSAO_REALIZADA));
    expect(item?.estado).toBe("falta");
  });

  it("retrospecto gravado → `pronto`", () => {
    const item = itemRetrospecto(ficha({ ...SESSAO_REALIZADA, timeline: [evento("retrospecto")] }));
    expect(item?.estado).toBe("pronto");
  });

  it("NUNCA inventa `pronto`: sem o evento na timeline, nem com a sessão realizada", () => {
    // ⚠️ Enquanto o backend não gravar o evento `retrospecto`, este é o
    // comportamento em produção — e é o certo: a Pasta diz "falta", não
    // "pronto". Nenhum ramo desta derivação afirma existência que ela não
    // consegue ler.
    const comOutrosEventos = ficha({ ...SESSAO_REALIZADA, timeline: [evento("analise_sessao"), evento("transcricao"), evento("relatorio")] });
    expect(itemRetrospecto(comOutrosEventos)?.estado).toBe("falta");
  });
});

describe("Pasta — `retrospecto_sv` é PII pesada", () => {
  it("papel sem patrimônio não vê nem a EXISTÊNCIA do item — DUAS guardas, não uma", () => {
    const f = ficha({ ...SESSAO_REALIZADA, timeline: [evento("retrospecto")], patrimonio: null, familiares: null });
    expect(itemRetrospecto(f, false)).toBeNull();
    // E não é "escondido depois": a chave não aparece em lugar nenhum do array.
    expect(derivarPasta(f, false).map((i) => i.chave)).not.toContain("retrospecto_sv");
    // A 1ª guarda é o filtro de `requerPatrimonio` (fim de `derivarPasta`); a
    // 2ª é `podeVerPatrimonio &&` na LEITURA do evento (`derivar.ts:76`,
    // achado BAIXO do pentest da Fase 13 espelhando o MÉDIO de 04/09).
    // `eventos_timeline` é lida por `eh_interno()`, recorte mais largo que o
    // `ve_patrimonio()` que este item exige — o sinal não pode nem ser
    // calculado para quem não pode vê-lo.
  });

  it("com patrimônio, o MESMO evento continua produzindo `pronto` (a guarda não cega quem pode ver)", () => {
    const f = ficha({ ...SESSAO_REALIZADA, timeline: [evento("retrospecto")] });
    expect(itemRetrospecto(f, true)?.estado).toBe("pronto");
  });

  it("o catálogo declara `requerPatrimonio` — é daí que a omissão vem", () => {
    const entrada = CATALOGO_PASTA.find((i) => i.chave === "retrospecto_sv");
    expect(entrada?.requerPatrimonio).toBe(true);
    expect(entrada?.procedencia).toBe("gerado_ia");
    expect(entrada?.dono).toBe("equipe");
  });
});

/**
 * A CLASSE inteira, não só o caso novo (pentest da Fase 13, 19/09): os três
 * sinais que leem `eventos_timeline` ficam atrás de `podeVerPatrimonio`.
 * `eventos_timeline` é exposta por `eh_interno()` — recorte mais largo que o
 * `ve_patrimonio()` que os três itens exigem.
 */
describe("Pasta — os 3 sinais de timeline atrás da mesma guarda", () => {
  const CASOS: { chave: string; evento: string }[] = [
    { chave: "analise_sessao", evento: "analise_sessao" },
    { chave: "transcricao", evento: "transcricao" },
    { chave: "retrospecto_sv", evento: "retrospecto" },
  ];

  for (const caso of CASOS) {
    it(`${caso.chave}: quem pode ver patrimônio vê 'pronto'`, () => {
      const f = ficha({ ...SESSAO_REALIZADA, timeline: [evento(caso.evento)] });
      expect(derivarPasta(f, true).find((i) => i.chave === caso.chave)?.estado).toBe("pronto");
    });

    it(`${caso.chave}: quem NÃO pode não vê nem a existência`, () => {
      const f = ficha({ ...SESSAO_REALIZADA, timeline: [evento(caso.evento)], patrimonio: null, familiares: null });
      expect(derivarPasta(f, false).map((i) => i.chave)).not.toContain(caso.chave);
    });
  }
});

describe("Pasta — o nome e o lugar do Retrospecto", () => {
  it("o rótulo é 'Retrospecto', NUNCA 'Relatório' (o nome já está ocupado)", () => {
    const retrospecto = CATALOGO_PASTA.find((i) => i.chave === "retrospecto_sv");
    const relatorio = CATALOGO_PASTA.find((i) => i.chave === "relatorio_sv");
    expect(retrospecto?.rotulo).toBe("Retrospecto");
    expect(relatorio?.rotulo).toBe("Relatório");
    // Dois itens, dois nomes, zero ambiguidade na mesma aba da Ficha.
    expect(retrospecto?.rotulo).not.toBe(relatorio?.rotulo);
  });

  it("mora na tab Sessão, logo DEPOIS da Análise", () => {
    expect(tabDoItem("retrospecto_sv")).toBe("sessao");
    const itens = TABS_FICHA.find((t) => t.chave === "sessao")!.itens;
    expect(itens.indexOf("retrospecto_sv")).toBe(itens.indexOf("analise_sessao") + 1);
  });

  it("o hash de consulta é `#retrospecto` — a URL que o pop-up publica", () => {
    expect(ABA_POR_ITEM_PASTA.retrospecto_sv).toBe("retrospecto");
  });

  it("a ação é de LEITURA: ninguém 'faz' um retrospecto, ele nasce do encerramento", () => {
    expect(ACAO_POR_ITEM_PASTA.retrospecto_sv).toBe("Ver o retrospecto");
  });

  it("é artefato do PÓS-sessão, como a Análise e o Relatório", () => {
    expect(SESSAO_POR_ITEM.retrospecto_sv).toBe(SESSAO_POR_ITEM.analise_sessao);
  });
});
