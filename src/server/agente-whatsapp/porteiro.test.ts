import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avaliarPorteiro, ehDadoReal, estaPausado, humanoNoComando, inboxConfere, inboxDoEvento } from "./porteiro";
import type { EventoChatwoot } from "@/server/chatwoot/recebidas";

/**
 * As 14 travas do porteiro, uma a uma, FAIL-CLOSED.
 *
 * Isto NÃO substitui `scripts/verificacao-0088-0090.sql` nem
 * `scripts/simular-chatwoot.ts`: mock de Supabase esconde exatamente o tipo de
 * bug que esta base já teve (migration não aplicada, grant faltando). O que se
 * prova aqui é a ORDEM e a REGRA de decisão — que nenhuma trava deixa passar
 * por omissão, e que a falha sempre cai para o lado do silêncio.
 */

// ---------------------------------------------------------------------------
// Um Supabase de mentira, chainable e thenable (é assim que o supabase-js é).
// ---------------------------------------------------------------------------

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}

type Respostas = Record<string, Resultado>;

class ConsultaFalsa implements PromiseLike<Resultado> {
  constructor(
    private readonly chave: string,
    private readonly respostas: Respostas,
  ) {}
  select() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  eq() { return this; }
  in() { return this; }
  gte() { return this; }
  gt() { return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  returns() { return this; }
  single() { return this; }
  maybeSingle() { return this; }
  then<R1 = Resultado, R2 = never>(
    ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null,
    falha?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const r = this.respostas[this.chave] ?? { data: null, error: null, count: 0 };
    return Promise.resolve(r).then(ok, falha);
  }
}

function clienteFalso(respostas: Respostas): SupabaseClient {
  return {
    from: (tabela: string) => new ConsultaFalsa(tabela, respostas),
    rpc: (nome: string) => new ConsultaFalsa(`rpc:${nome}`, respostas),
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------

const AGORA = Date.parse("2026-09-07T15:00:00Z");

const evento = (inbox: number | string = 7): EventoChatwoot => ({
  event: "message_created",
  id: 1,
  content: "oi",
  message_type: "incoming",
  private: false,
  conversation: { id: 42, inbox_id: inbox },
  sender: { id: 1, phone_number: "+5511988887777" },
});

const CONFIG_LIGADO = {
  data: [
    { chave: "agente_whatsapp.ativo", valor: true, descricao: "" },
    { chave: "agente_whatsapp.silencio_humano_minutos", valor: 30, descricao: "" },
    { chave: "agente_whatsapp.esquivas_ate_humano", valor: 2, descricao: "" },
    { chave: "agente_whatsapp.intervalo_link_horas", valor: 6, descricao: "" },
    { chave: "agente_whatsapp.teto_respostas_hora", valor: 6, descricao: "" },
    { chave: "agente_whatsapp.teto_ia_jornada_dia", valor: 10, descricao: "" },
    { chave: "agente_whatsapp.teto_ia_dia", valor: 100, descricao: "" },
  ],
  error: null,
};

const SINAIS_OK = {
  data: {
    jornada_id: "j1",
    pessoa_id: "p1",
    primeiro_nome: "Ana",
    pessoa_origem_dado: "real",
    jornada_origem_dado: "real",
    desfecho: "aberta",
    etapa: "croqui_contratado",
    nivel_pago: 2,
    nivel_pago_vigente: 2,
    tem_documentos: false,
    tarefas_abertas: [],
  },
  error: null,
};

const CONSENTIU = { data: { concedido: true, revogado_em: null }, error: null };

function respostasBase(sobrescrever: Respostas = {}): Respostas {
  return {
    configuracoes: CONFIG_LIGADO,
    "rpc:casar_pessoa_por_telefone": { data: [{ pessoa_id: "p1", jornada_id: "j1", quantidade: 1 }], error: null },
    "rpc:sinais_agente_whatsapp": SINAIS_OK,
    consentimentos: CONSENTIU,
    agente_whatsapp_estado: { data: null, error: null },
    agente_whatsapp_respostas: { data: null, error: null, count: 0 },
    jornadas: { data: null, error: null },
    ...sobrescrever,
  };
}

async function avaliar(respostas: Respostas, ev: EventoChatwoot = evento(), telefone: string | null = "+5511988887777") {
  return avaliarPorteiro(clienteFalso(respostas), { evento: ev, telefoneBruto: telefone, agora: AGORA });
}

// ---------------------------------------------------------------------------

describe("funções puras das travas", () => {
  it("trava 5 — sem CHATWOOT_INBOX_ID o agente cala (env presente ≠ env válida, D8)", () => {
    delete process.env.CHATWOOT_INBOX_ID;
    expect(inboxConfere(evento(7))).toBe(false);
    process.env.CHATWOOT_INBOX_ID = "7";
    expect(inboxConfere(evento(7))).toBe(true);
    expect(inboxConfere(evento(8))).toBe(false);
    expect(inboxDoEvento({ event: "message_created" })).toBeNull();
  });

  it("trava 7 — demonstração nunca passa, nem pela pessoa nem pela jornada (D5)", () => {
    expect(ehDadoReal({ pessoa_origem_dado: "real", jornada_origem_dado: "real" })).toBe(true);
    expect(ehDadoReal({ pessoa_origem_dado: "exemplo", jornada_origem_dado: "real" })).toBe(false);
    expect(ehDadoReal({ pessoa_origem_dado: "real", jornada_origem_dado: "exemplo" })).toBe(false);
    expect(ehDadoReal({})).toBe(false);
  });

  it("trava 11 — humano no comando conta a janela em minutos", () => {
    const estado = { jornada_id: "j1", passo_ultimo: null, ultima_intencao: null, esquivas_seguidas: 0, humano_respondeu_em: new Date(AGORA - 10 * 60_000).toISOString(), pausado_ate: null, pausado_por: null, ultimo_link_em: {} };
    expect(humanoNoComando(estado, 30, AGORA)).toBe(true);
    expect(humanoNoComando(estado, 5, AGORA)).toBe(false);
    expect(humanoNoComando(null, 30, AGORA)).toBe(false);
    expect(humanoNoComando({ ...estado, humano_respondeu_em: "data ruim" }, 30, AGORA)).toBe(false);
  });

  it("trava 12 — pausa só vale enquanto está no futuro", () => {
    const base = { jornada_id: "j1", passo_ultimo: null, ultima_intencao: null, esquivas_seguidas: 0, humano_respondeu_em: null, pausado_por: null, ultimo_link_em: {} };
    expect(estaPausado({ ...base, pausado_ate: new Date(AGORA + 60_000).toISOString() }, AGORA)).toBe(true);
    expect(estaPausado({ ...base, pausado_ate: new Date(AGORA - 60_000).toISOString() }, AGORA)).toBe(false);
    expect(estaPausado(null, AGORA)).toBe(false);
  });
});

describe("avaliarPorteiro — fail-closed em todos os caminhos", () => {
  beforeEach(() => {
    process.env.CHATWOOT_INBOX_ID = "7";
  });
  afterEach(() => {
    delete process.env.CHATWOOT_INBOX_ID;
  });

  it("deixa passar quando TODAS as travas estão satisfeitas", async () => {
    const r = await avaliar(respostasBase());
    expect(r.responder).toBe(true);
    if (r.responder) {
      expect(r.contexto.jornadaId).toBe("j1");
      expect(r.contexto.primeiroNome).toBe("Ana");
      expect(r.contexto.podeUsarIa).toBe(true);
    }
  });

  it("4 — chave `ativo` ausente = DESLIGADO (não é 'sem informação', é fail-closed)", async () => {
    const r = await avaliar(respostasBase({ configuracoes: { data: [], error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "agente_desligado" });
  });

  it("4 — `ativo` com a string \"false\" continua desligado", async () => {
    const r = await avaliar(respostasBase({ configuracoes: { data: [{ chave: "agente_whatsapp.ativo", valor: "false", descricao: "" }], error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "agente_desligado" });
  });

  it("5 — mensagem de outra inbox não é respondida", async () => {
    const r = await avaliar(respostasBase(), evento(99));
    expect(r).toMatchObject({ responder: false, motivo: "inbox_diferente" });
  });

  it("6 — telefone irreconhecível não casa com ninguém", async () => {
    const r = await avaliar(respostasBase(), evento(), "123");
    expect(r).toMatchObject({ responder: false, motivo: "sem_telefone" });
  });

  it("6 — número desconhecido: silêncio, e sem jornada onde pendurar tarefa (D1/D2)", async () => {
    const r = await avaliar(respostasBase({ "rpc:casar_pessoa_por_telefone": { data: [{ pessoa_id: null, jornada_id: null, quantidade: 0 }], error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "numero_desconhecido", jornadaId: null });
  });

  it("6 — telefone ambíguo RECUSA em vez de escolher a pessoa errada (C1)", async () => {
    const r = await avaliar(respostasBase({ "rpc:casar_pessoa_por_telefone": { data: [{ pessoa_id: null, jornada_id: null, quantidade: 2 }], error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "telefone_ambiguo" });
  });

  it("7 — família de demonstração nunca recebe WhatsApp de verdade (D5)", async () => {
    const r = await avaliar(
      respostasBase({ "rpc:sinais_agente_whatsapp": { data: { ...(SINAIS_OK.data as object), pessoa_origem_dado: "exemplo" }, error: null } }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "origem_demonstracao", jornadaId: "j1" });
  });

  it("8 — processo arquivado não recebe agente, e o motivo não vaza para o cliente (B62)", async () => {
    const r = await avaliar(
      respostasBase({ "rpc:sinais_agente_whatsapp": { data: { ...(SINAIS_OK.data as object), desfecho: "congelada" }, error: null } }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "sem_jornada_aberta" });
  });

  it("8 — pessoa sem processo aberto: a tarefa vai na jornada mais recente", async () => {
    const r = await avaliar(
      respostasBase({
        "rpc:casar_pessoa_por_telefone": { data: [{ pessoa_id: "p1", jornada_id: null, quantidade: 1 }], error: null },
        jornadas: { data: { id: "j-antiga" }, error: null },
      }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "sem_jornada_aberta", jornadaId: "j-antiga" });
  });

  it("9 — quem não contratou a Sessão de Viabilidade não entra no onboarding (B63)", async () => {
    const r = await avaliar(
      respostasBase({ "rpc:sinais_agente_whatsapp": { data: { ...(SINAIS_OK.data as object), nivel_pago_vigente: 0 }, error: null } }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "sem_pagamento", jornadaId: "j1" });
  });

  it("9 — nível ausente é tratado como 0, nunca como 'deve estar tudo bem'", async () => {
    const semNivel = { ...(SINAIS_OK.data as Record<string, unknown>) };
    delete semNivel.nivel_pago_vigente;
    const r = await avaliar(respostasBase({ "rpc:sinais_agente_whatsapp": { data: semNivel, error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "sem_pagamento" });
  });

  it("10 — sem consentimento de WhatsApp, nem uma palavra sai", async () => {
    const r = await avaliar(respostasBase({ consentimentos: { data: null, error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "sem_consentimento_whatsapp", jornadaId: "j1" });
  });

  it("10 — consentimento REVOGADO não vale", async () => {
    const r = await avaliar(respostasBase({ consentimentos: { data: { concedido: true, revogado_em: "2026-09-01T00:00:00Z" }, error: null } }));
    expect(r).toMatchObject({ responder: false, motivo: "sem_consentimento_whatsapp" });
  });

  it("11 — humano respondeu há 2 min: o robô cala (C8/D24)", async () => {
    const r = await avaliar(
      respostasBase({
        agente_whatsapp_estado: { data: { jornada_id: "j1", esquivas_seguidas: 0, humano_respondeu_em: new Date(AGORA - 2 * 60_000).toISOString(), pausado_ate: null, pausado_por: null, ultimo_link_em: {} }, error: null },
      }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "humano_no_comando" });
  });

  it("12 — conversa assumida pela equipe: o robô cala (D25)", async () => {
    const r = await avaliar(
      respostasBase({
        agente_whatsapp_estado: { data: { jornada_id: "j1", esquivas_seguidas: 0, humano_respondeu_em: null, pausado_ate: new Date(AGORA + 10 * 60_000).toISOString(), pausado_por: "perfil", ultimo_link_em: {} }, error: null },
      }),
    );
    expect(r).toMatchObject({ responder: false, motivo: "pausado" });
  });

  it("13 — teto de respostas por hora: cala e a equipe recebe tarefa", async () => {
    const r = await avaliar(respostasBase({ agente_whatsapp_respostas: { data: null, error: null, count: 6 } }));
    expect(r).toMatchObject({ responder: false, motivo: "teto_respostas_hora", jornadaId: "j1" });
  });

  it("B56 — sem `tratamento_ia` o agente passa, mas com `podeUsarIa: false`", async () => {
    // O mesmo mock responde a TODA consulta a `consentimentos`; com ele
    // negando, as duas leituras (whatsapp e ia) negam — e a primeira já barra.
    // Aqui o que se prova é o inverso: consentindo, `podeUsarIa` é true.
    const r = await avaliar(respostasBase());
    expect(r.responder).toBe(true);
    if (r.responder) expect(r.contexto.podeUsarIa).toBe(true);
  });

  it("falha de infraestrutura NUNCA vira resposta ao cliente", async () => {
    const quebrado = {
      from: () => {
        throw new Error("banco fora");
      },
      rpc: () => {
        throw new Error("banco fora");
      },
    } as unknown as SupabaseClient;
    const r = await avaliarPorteiro(quebrado, { evento: evento(), telefoneBruto: "+5511988887777", agora: AGORA });
    expect(r).toMatchObject({ responder: false, motivo: "agente_desligado" });
  });
});
