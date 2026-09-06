import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LigacaoIa } from "@/types/integracoes";
import { callbackUrlLigacao, faltamN8nLigacao, montarPayloadSaida, n8nLigacaoConfigurado } from "./n8n";
import type { ContextoDisparo } from "./tipos";

const ASSISTENTE = "036cdf43-4549-4251-bc6a-55b71b3f51b4";

const envOriginal = { ...process.env };
beforeEach(() => {
  process.env.N8N_WEBHOOK_LIGACAO_URL = "https://n8n.exemplo/webhook/sichf-ligacao-lancador";
  process.env.LIGACAO_IA_WEBHOOK_SECRET = "segredo-de-teste-com-tamanho";
  process.env.VAPI_ASSISTENTE_ID = ASSISTENTE;
});
afterEach(() => {
  process.env = { ...envOriginal };
});

function ligacao(): LigacaoIa {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    jornada_id: "22222222-2222-4222-8222-222222222222",
    link_id: null,
    provedor: "n8n",
    status: "discando",
    tentativa: 2,
    nao_antes_de: null,
    origem: "equipe",
    solicitada_por: null,
    telefone: "+5521987654321",
    id_externo: null,
    disparada_em: null,
    atendida_em: null,
    encerrada_em: null,
    duracao_segundos: null,
    resultado: null,
    horario_escolhido: null,
    agendamento_id: null,
    transcricao: null,
    resumo: null,
    gravacao_url: null,
    custo_usd: null,
    erro: null,
    criado_em: "2026-09-06T12:00:00.000Z",
    atualizado_em: "2026-09-06T12:00:00.000Z",
  };
}

function horario(inicio: string, rotulo: string) {
  return { inicio_em: inicio, fim_em: inicio, rotulo };
}

function contexto(horarios = 4, nome = "Maria Aparecida da Silva"): ContextoDisparo {
  const todos = [
    horario("2026-09-10T18:00:00+00:00", "quinta-feira, 10 de setembro, às 15h"),
    horario("2026-09-10T19:00:00+00:00", "quinta-feira, 10 de setembro, às 16h"),
    horario("2026-09-11T13:00:00+00:00", "sexta-feira, 11 de setembro, às 10h"),
    horario("2026-09-11T14:00:00+00:00", "sexta-feira, 11 de setembro, às 11h"),
    horario("2026-09-14T13:00:00+00:00", "segunda-feira, 14 de setembro, às 10h"),
  ];
  return {
    admin: {} as SupabaseClient,
    ligacao: ligacao(),
    nome,
    responsavelId: null,
    oferta: { link_id: "l1", url: null, horarios: todos.slice(0, horarios) },
  };
}

describe("faltamN8nLigacao / n8nLigacaoConfigurado", () => {
  it("com as três envs, está configurado", () => {
    expect(faltamN8nLigacao()).toEqual([]);
    expect(n8nLigacaoConfigurado()).toBe(true);
  });

  it("VAPI_ASSISTENTE_ID ausente derruba a configuração (entrega 4 da Fase 7)", () => {
    delete process.env.VAPI_ASSISTENTE_ID;
    expect(faltamN8nLigacao()).toEqual(["VAPI_ASSISTENTE_ID"]);
    expect(n8nLigacaoConfigurado()).toBe(false);
  });

  it("env só com espaço conta como ausente", () => {
    process.env.LIGACAO_IA_WEBHOOK_SECRET = "   ";
    expect(faltamN8nLigacao()).toEqual(["LIGACAO_IA_WEBHOOK_SECRET"]);
  });

  it("não devolve valor nenhum, só nomes", () => {
    delete process.env.N8N_WEBHOOK_LIGACAO_URL;
    delete process.env.VAPI_ASSISTENTE_ID;
    expect(faltamN8nLigacao().join()).not.toContain("https");
    expect(faltamN8nLigacao().join()).not.toContain(ASSISTENTE);
  });
});

describe("montarPayloadSaida", () => {
  it("põe o melhor horário na posição 1 e até 3 alternativas", () => {
    const p = montarPayloadSaida(contexto(5));
    expect(p.melhor_horario.rotulo).toBe("quinta-feira, 10 de setembro, às 15h");
    expect(p.alternativas).toHaveLength(3);
    expect(p.alternativas.map((a) => a.rotulo)).toEqual([
      "quinta-feira, 10 de setembro, às 16h",
      "sexta-feira, 11 de setembro, às 10h",
      "sexta-feira, 11 de setembro, às 11h",
    ]);
  });

  it("com um horário só, alternativas fica vazio (a assistente diz 'só a opção 1')", () => {
    expect(montarPayloadSaida(contexto(1)).alternativas).toEqual([]);
  });

  it("leva o telefone em E.164", () => {
    expect(montarPayloadSaida(contexto()).telefone).toMatch(/^\+55\d{10,11}$/);
  });

  /**
   * A1 do pentest (06/09/2026): o `callback_url` viajava no payload, a Vapi o
   * devolvia dentro do `metadata` e o nó do n8n POSTava o payload ASSINADO
   * exatamente onde esse campo mandasse. Destino de POST assinado é
   * configuração (`$vars.SICHF_CALLBACK_URL`), nunca dado de rede — por isso o
   * campo não existe mais. Este teste é a trava contra o retorno dele.
   */
  it("NÃO manda callback_url: o destino do retorno é configuração do n8n", () => {
    expect(montarPayloadSaida(contexto())).not.toHaveProperty("callback_url");
  });

  it("callbackUrlLigacao continua servindo o Admin (valor a colar na Variable)", () => {
    expect(callbackUrlLigacao()).toMatch(/^https?:\/\/.+\/api\/webhooks\/n8n\/ligacao$/);
  });

  it("primeiro_nome é o primeiro token do nome", () => {
    expect(montarPayloadSaida(contexto(4, "Maria Aparecida da Silva")).primeiro_nome).toBe("Maria");
    expect(montarPayloadSaida(contexto(4, "  João  Pedro ")).primeiro_nome).toBe("João");
  });

  it("assistente_id vem da env — nunca null", () => {
    expect(montarPayloadSaida(contexto()).assistente_id).toBe(ASSISTENTE);
  });

  it("sem VAPI_ASSISTENTE_ID, lança em vez de mandar null para a Vapi (entrega 4)", () => {
    delete process.env.VAPI_ASSISTENTE_ID;
    expect(() => montarPayloadSaida(contexto())).toThrow(/VAPI_ASSISTENTE_ID/);
  });

  it("sem horário nenhum, lança — a IA não liga sem o que oferecer", () => {
    const ctx = contexto();
    ctx.oferta = null;
    expect(() => montarPayloadSaida(ctx)).toThrow("sem_horarios_ofertados");

    const vazio = contexto();
    vazio.oferta = { link_id: "l1", url: null, horarios: [] };
    expect(() => montarPayloadSaida(vazio)).toThrow("sem_horarios_ofertados");
  });

  it("o payload não carrega jornada_id nem telefone de terceiro (o n8n não precisa saber)", () => {
    const p = montarPayloadSaida(contexto());
    expect(Object.keys(p)).not.toContain("jornada_id");
    expect(JSON.stringify(p)).not.toContain("22222222-2222");
  });
});
