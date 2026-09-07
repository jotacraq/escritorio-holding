import { describe, expect, it } from "vitest";
import { compraMaisGrave, comprasPorJornada, prazoMaisProximoPorJornada, type CompraDoProcesso, type PrazoAberto } from "./dadosDeUrgencia";

function compra(parcial: Partial<CompraDoProcesso> & { jornada_id: string; status: string }): CompraDoProcesso {
  return {
    produto_tipo: "sessao_viabilidade",
    produto_nome: "Sessão de Viabilidade",
    evento_hotmart: null,
    evento_em: null,
    revertido: false,
    aguardando_dinheiro: false,
    ...parcial,
  };
}

function prazo(parcial: Partial<PrazoAberto> & { id: string }): PrazoAberto {
  return {
    jornada_id: "j1",
    tipo: null,
    titulo: "Tarefa",
    descricao: null,
    vence_em: null,
    origem: "sistema",
    nome: null,
    ...parcial,
  };
}

describe("compraMaisGrave", () => {
  it("põe o dinheiro que voltou na frente do dinheiro que entrou", () => {
    const escolhida = compraMaisGrave([
      compra({ jornada_id: "j1", status: "aprovado" }),
      compra({ jornada_id: "j1", status: "reembolsado", revertido: true, produto_tipo: "croqui_estrutural" }),
    ]);
    expect(escolhida?.status).toBe("reembolsado");
  });

  it("põe o dinheiro que não entrou na frente do que entrou", () => {
    const escolhida = compraMaisGrave([
      compra({ jornada_id: "j1", status: "aprovado" }),
      compra({ jornada_id: "j1", status: "expirado", aguardando_dinheiro: true }),
    ]);
    expect(escolhida?.status).toBe("expirado");
  });

  it("é a reversão que ganha quando as duas coisas ruins acontecem", () => {
    const escolhida = compraMaisGrave([
      compra({ jornada_id: "j1", status: "boleto_gerado", aguardando_dinheiro: true }),
      compra({ jornada_id: "j1", status: "estornado", revertido: true }),
    ]);
    expect(escolhida?.status).toBe("estornado");
  });

  it("sem compra nenhuma devolve null — a tela diz 'sem compra', não 'pago'", () => {
    expect(compraMaisGrave([])).toBeNull();
  });
});

describe("comprasPorJornada", () => {
  it("agrupa sem perder linha", () => {
    const mapa = comprasPorJornada([
      compra({ jornada_id: "j1", status: "aprovado" }),
      compra({ jornada_id: "j1", status: "aprovado", produto_tipo: "croqui_estrutural" }),
      compra({ jornada_id: "j2", status: "pendente" }),
    ]);
    expect(mapa.get("j1")).toHaveLength(2);
    expect(mapa.get("j2")).toHaveLength(1);
    expect(mapa.get("j3")).toBeUndefined();
  });
});

describe("prazoMaisProximoPorJornada", () => {
  it("fica com a data mais próxima", () => {
    const mapa = prazoMaisProximoPorJornada([
      prazo({ id: "a", vence_em: "2026-09-20" }),
      prazo({ id: "b", vence_em: "2026-09-07" }),
      prazo({ id: "c", vence_em: "2026-09-30" }),
    ]);
    expect(mapa.get("j1")?.id).toBe("b");
  });

  it("uma tarefa SEM prazo nunca ganha de uma com prazo — indefinido não é urgente", () => {
    const mapa = prazoMaisProximoPorJornada([prazo({ id: "a", vence_em: "2026-09-20" }), prazo({ id: "b", vence_em: null })]);
    expect(mapa.get("j1")?.id).toBe("a");
  });

  it("tarefa sem processo ligado fica de fora do mapa por processo", () => {
    const mapa = prazoMaisProximoPorJornada([prazo({ id: "a", jornada_id: null, vence_em: "2026-09-07" })]);
    expect(mapa.size).toBe(0);
  });
});
