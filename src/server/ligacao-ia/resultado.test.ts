import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LigacaoIa, PayloadLigacaoIaEntrada } from "@/types/integracoes";
import { aplicarResultado, tratarFalha } from "./resultado";
import { esquecerTokens } from "./fila";
import { cifrarToken, decifrarToken } from "./token-cifrado";

/**
 * Máquina de estados da ligação por IA (`aplicarResultado`) — o pedaço que
 * decide se um agendamento conquistado no telefone entra no sistema ou some.
 *
 * O cliente Supabase é falsificado no ponto MAIS FINO possível: um armazém em
 * memória por tabela, com o mesmo encadeamento que o código usa. Isto NÃO
 * substitui a prova no banco (RLS, trigger de transição terminal, RPCs) — essa
 * continua nos roteiros `scripts/verificacao-*.sql`. O que se prova aqui é a
 * DECISÃO: que status, que resultado, e se o fallback foi acionado.
 */

const LIGACAO = "11111111-1111-4111-8111-111111111111";
const JORNADA = "22222222-2222-4222-8222-222222222222";
const LINK_HUMANO = "33333333-3333-4333-8333-333333333333";
const PERFIL = "44444444-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;
type Filtro = (linha: Linha) => boolean;

/** Construtor de consulta com o subconjunto de PostgREST que este módulo usa. */
class Consulta implements PromiseLike<{ data: unknown; error: unknown }> {
  private filtros: Filtro[] = [];
  private modo: "select" | "insert" | "update" = "select";
  private patch: Linha = {};
  private inseridas: Linha[] = [];
  private unico: "maybeSingle" | "single" | null = null;

  constructor(
    private readonly banco: Banco,
    private readonly tabela: string,
  ) {}

  select(): this {
    if (this.modo === "select") this.modo = "select";
    return this;
  }
  insert(linhas: Linha | Linha[]): this {
    this.modo = "insert";
    this.inseridas = Array.isArray(linhas) ? linhas : [linhas];
    return this;
  }
  update(patch: Linha): this {
    this.modo = "update";
    this.patch = patch;
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push((l) => l[coluna] === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.filtros.push((l) => valores.includes(l[coluna]));
    return this;
  }
  is(coluna: string, valor: unknown): this {
    this.filtros.push((l) => (l[coluna] ?? null) === valor);
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): this {
    this.unico = "maybeSingle";
    return this;
  }
  single(): this {
    this.unico = "single";
    return this;
  }

  private executar(): { data: unknown; error: unknown } {
    const tabela = (this.banco.tabelas[this.tabela] ??= []);
    const erro = this.banco.erros[`${this.tabela}:${this.modo}`];
    if (erro) return { data: null, error: erro };

    let linhas: Linha[];
    if (this.modo === "insert") {
      linhas = this.inseridas.map((l) => ({ id: `gerado-${tabela.length + 1}`, ...l }));
      tabela.push(...linhas);
      this.banco.inserts.push({ tabela: this.tabela, linhas });
    } else {
      const alvo = tabela.filter((l) => this.filtros.every((f) => f(l)));
      if (this.modo === "update") for (const l of alvo) Object.assign(l, this.patch);
      linhas = alvo;
    }

    if (this.unico) {
      if (linhas.length === 0) {
        return this.unico === "single"
          ? { data: null, error: { code: "PGRST116", message: "no rows" } }
          : { data: null, error: null };
      }
      return { data: linhas[0], error: null };
    }
    return { data: linhas, error: null };
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    aoResolver?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.executar()).then(aoResolver, aoRejeitar);
  }
}

class Banco {
  tabelas: Record<string, Linha[]> = {};
  erros: Record<string, { code: string; message: string } | undefined> = {};
  rpcs: Record<string, (args: Linha) => unknown> = {};
  chamadasRpc: Array<{ nome: string; args: Linha }> = [];
  inserts: Array<{ tabela: string; linhas: Linha[] }> = [];

  from(tabela: string): Consulta {
    return new Consulta(this, tabela);
  }
  rpc(nome: string, args: Linha = {}) {
    this.chamadasRpc.push({ nome, args });
    const fn: ((args: Linha) => unknown) | undefined = this.rpcs[nome];
    const existe = typeof fn === "function";
    const promessa = Promise.resolve({
      data: existe ? fn(args) : null,
      error: existe ? null : { code: "42883", message: `rpc ${nome} ausente` },
    });
    return Object.assign(promessa, { single: () => promessa });
  }
  comoCliente(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

function ligacaoBase(extra: Partial<LigacaoIa> = {}): Linha {
  return {
    id: LIGACAO,
    jornada_id: JORNADA,
    link_id: null,
    provedor: "n8n",
    status: "discando",
    tentativa: 1,
    nao_antes_de: null,
    origem: "equipe",
    solicitada_por: PERFIL,
    telefone: "+5521987654321",
    id_externo: null,
    disparada_em: "2026-09-08T15:00:00.000Z",
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
    criado_em: "2026-09-08T15:00:00.000Z",
    atualizado_em: "2026-09-08T15:00:00.000Z",
    ...extra,
  };
}

/**
 * Cenário-base: uma ligação `discando`, a jornada dela, e um link de
 * agendamento ATIVO emitido por uma PESSOA (`criado_por` não nulo) — é o
 * cenário em que a Fase 7 proíbe o sistema de revogar (entrega 3).
 */
function montar(extraLigacao: Partial<LigacaoIa> = {}, configuracoes: Linha[] = []): Banco {
  const banco = new Banco();
  banco.tabelas.ligacoes_ia = [ligacaoBase(extraLigacao)];
  banco.tabelas.jornadas = [
    { id: JORNADA, desfecho: "aberta", nivel_pago: 1, responsavel_id: PERFIL, pessoas: { nome: "Maria Silva", telefone: "+5521987654321" } },
  ];
  banco.tabelas.links_publicos = [
    {
      id: LINK_HUMANO,
      jornada_id: JORNADA,
      tipo: "agendamento",
      estado: "ativo",
      criado_por: PERFIL,
      expira_em: "2099-01-01T00:00:00.000Z",
    },
  ];
  banco.tabelas.tarefas = [];
  banco.tabelas.configuracoes = configuracoes;
  banco.rpcs.enfileirar_link_agendamento_ligacao_ia = () => 2;
  return banco;
}

const linhaLigacao = (b: Banco): Linha => b.tabelas.ligacoes_ia[0];
const tarefas = (b: Banco): Linha[] => b.tabelas.tarefas;

const envOriginal = { ...process.env };
beforeEach(() => {
  esquecerTokens();
  process.env.LINK_PUBLICO_PEPPER = "pepper-de-teste-com-tamanho-ok";
});
afterEach(() => {
  process.env = { ...envOriginal };
});

describe("aplicarResultado — estados intermediários", () => {
  it("`discando` sobre uma ligação na fila marca discando e carimba disparada_em", async () => {
    const b = montar({ status: "na_fila", disparada_em: null });
    const r = await aplicarResultado(b.comoCliente(), { id_evento: "e1", ligacao_id: LIGACAO, evento: "discando", id_externo: "call_1" });
    expect(r.status).toBe("discando");
    expect(linhaLigacao(b).disparada_em).toBeTruthy();
    expect(linhaLigacao(b).id_externo).toBe("call_1");
  });

  it("`discando` NÃO puxa de volta uma ligação que já está em ligação", async () => {
    const b = montar({ status: "em_ligacao" });
    await aplicarResultado(b.comoCliente(), { id_evento: "e1", ligacao_id: LIGACAO, evento: "discando" });
    expect(linhaLigacao(b).status).toBe("em_ligacao");
  });

  it("`em_ligacao` marca atendida_em uma única vez", async () => {
    const b = montar();
    await aplicarResultado(b.comoCliente(), { id_evento: "e2", ligacao_id: LIGACAO, evento: "em_ligacao" });
    const primeira = linhaLigacao(b).atendida_em;
    expect(primeira).toBeTruthy();
    await aplicarResultado(b.comoCliente(), { id_evento: "e3", ligacao_id: LIGACAO, evento: "em_ligacao" });
    expect(linhaLigacao(b).atendida_em).toBe(primeira);
  });

  it("aceita `estado` como alias de `evento` (o n8n manda os dois nomes)", async () => {
    const b = montar();
    const r = await aplicarResultado(b.comoCliente(), {
      id_evento: "e4",
      ligacao_id: LIGACAO,
      estado: "em_ligacao",
    } as unknown as PayloadLigacaoIaEntrada);
    expect(r.status).toBe("em_ligacao");
  });
});

describe("aplicarResultado — guardas", () => {
  it("ligação inexistente é 404, sem dizer mais nada", async () => {
    const b = montar();
    b.tabelas.ligacoes_ia = [];
    await expect(aplicarResultado(b.comoCliente(), { id_evento: "e5", ligacao_id: LIGACAO, evento: "concluida" })).rejects.toMatchObject({
      status: 404,
      codigo: "ligacao_nao_encontrada",
    });
  });

  it("estado terminal ignora qualquer evento novo, sem escrever nada", async () => {
    for (const status of ["concluida", "sem_resposta", "falhou", "cancelada"] as const) {
      const b = montar({ status, resultado: "recusou" });
      const r = await aplicarResultado(b.comoCliente(), { id_evento: "e6", ligacao_id: LIGACAO, evento: "concluida" });
      expect(r.ignorado).toBe("ligacao_encerrada");
      expect(linhaLigacao(b).status).toBe(status);
      expect(tarefas(b)).toHaveLength(0);
    }
  });

  it("evento desconhecido é 422", async () => {
    const b = montar();
    await expect(
      aplicarResultado(b.comoCliente(), { id_evento: "e7", ligacao_id: LIGACAO, evento: "explodiu" } as unknown as PayloadLigacaoIaEntrada),
    ).rejects.toMatchObject({ status: 422, codigo: "evento_invalido" });
  });
});

describe("aplicarResultado — concluída COM horário", () => {
  it("núcleo aceita: a RPC manda, e aqui só entram os extras", async () => {
    const b = montar();
    b.rpcs.registrar_horario_ligacao_ia = () => {
      Object.assign(linhaLigacao(b), { status: "concluida", resultado: "agendou", agendamento_id: "ag-1" });
      return { ok: true, agendamento_id: "ag-1" };
    };
    const r = await aplicarResultado(b.comoCliente(), {
      id_evento: "e8",
      ligacao_id: LIGACAO,
      evento: "concluida",
      horario_escolhido: "2026-09-10T18:00:00+00:00",
      custo_usd: 0.073123,
      duracao_s: 62,
      transcricao: "AI: Olá.",
    });
    expect(r.status).toBe("concluida");
    expect(r.resultado).toBe("agendou");
    expect(r.agendamento_id).toBe("ag-1");
    expect(linhaLigacao(b).custo_usd).toBe(0.0731);
    expect(linhaLigacao(b).duracao_segundos).toBe(62);
    expect(tarefas(b)).toHaveLength(0);
  });

  it("núcleo recusa o horário: vira `falhou` com o código do banco e cai no fallback — nunca finge que agendou", async () => {
    const b = montar();
    b.rpcs.registrar_horario_ligacao_ia = () => ({ erro: "horario_indisponivel" });
    const r = await aplicarResultado(b.comoCliente(), {
      id_evento: "e9",
      ligacao_id: LIGACAO,
      evento: "concluida",
      horario_escolhido: "2030-01-01T10:00:00+00:00",
    });
    expect(r.erro).toBe("horario_indisponivel");
    expect(linhaLigacao(b).status).toBe("falhou");
    expect(linhaLigacao(b).resultado).toBeNull();
    expect(tarefas(b)).toHaveLength(1);
  });

  it("a RPC de horário é chamada com a ligação e o instante exatos", async () => {
    const b = montar();
    b.rpcs.registrar_horario_ligacao_ia = () => ({ ok: true, agendamento_id: "ag-2" });
    await aplicarResultado(b.comoCliente(), {
      id_evento: "e10",
      ligacao_id: LIGACAO,
      evento: "concluida",
      horario_escolhido: "2026-09-10T18:00:00+00:00",
    });
    expect(b.chamadasRpc[0]).toEqual({
      nome: "registrar_horario_ligacao_ia",
      args: { p_ligacao_id: LIGACAO, p_inicio: "2026-09-10T18:00:00+00:00" },
    });
  });
});

describe("aplicarResultado — concluída SEM horário", () => {
  it("recusou: encerra como concluída/recusou e manda o link (fallback)", async () => {
    const b = montar();
    const r = await aplicarResultado(b.comoCliente(), { id_evento: "e11", ligacao_id: LIGACAO, evento: "concluida", resultado: "recusou" });
    expect(r.status).toBe("concluida");
    expect(r.resultado).toBe("recusou");
    expect(linhaLigacao(b).encerrada_em).toBeTruthy();
  });

  it("não retenta: uma ligação concluída não gera tentativa nova", async () => {
    const b = montar();
    await aplicarResultado(b.comoCliente(), { id_evento: "e12", ligacao_id: LIGACAO, evento: "concluida", resultado: "pediu_retorno" });
    expect(b.tabelas.ligacoes_ia).toHaveLength(1);
  });
});

describe("aplicarResultado — sem resposta e falha", () => {
  it("sem_resposta com tentativa < máximo reenfileira com nao_antes_de dentro da janela", async () => {
    const b = montar({ tentativa: 1 }, [
      { chave: "ligacao_ia.max_tentativas", valor: 3, descricao: "" },
      { chave: "ligacao_ia.intervalo_retentativa_minutos", valor: 60, descricao: "" },
      { chave: "ligacao_ia.janela", valor: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "19:00", fuso: "America/Sao_Paulo" }, descricao: "" },
    ]);
    await aplicarResultado(b.comoCliente(), { id_evento: "e13", ligacao_id: LIGACAO, evento: "sem_resposta", motivo_falha: "customer-did-not-answer" });

    expect(linhaLigacao(b).status).toBe("sem_resposta");
    expect(b.tabelas.ligacoes_ia).toHaveLength(2);
    const nova = b.tabelas.ligacoes_ia[1];
    expect(nova.tentativa).toBe(2);
    expect(nova.telefone).toBe("+5521987654321");
    expect(typeof nova.nao_antes_de).toBe("string");
    // Nunca antes do intervalo pedido.
    expect(new Date(nova.nao_antes_de as string).getTime()).toBeGreaterThanOrEqual(Date.now() + 59 * 60_000);
  });

  it("esgotadas as tentativas, não reenfileira: cai no fallback", async () => {
    const b = montar({ tentativa: 2 }, [{ chave: "ligacao_ia.max_tentativas", valor: 2, descricao: "" }]);
    await aplicarResultado(b.comoCliente(), { id_evento: "e14", ligacao_id: LIGACAO, evento: "falhou", motivo_falha: "assistant-error" });
    expect(b.tabelas.ligacoes_ia).toHaveLength(1);
    expect(linhaLigacao(b).status).toBe("falhou");
    expect(linhaLigacao(b).erro).toBe("assistant-error");
    expect(tarefas(b)).toHaveLength(1);
  });

  it("`falhou` sem motivo recebe um motivo padrão — nunca fica mudo", async () => {
    const b = montar({ tentativa: 9 }, [{ chave: "ligacao_ia.max_tentativas", valor: 1, descricao: "" }]);
    await aplicarResultado(b.comoCliente(), { id_evento: "e15", ligacao_id: LIGACAO, evento: "falhou" });
    expect(linhaLigacao(b).erro).toBe("falha_no_provedor");
  });
});

describe("fallback por link — a regra da entrega 3", () => {
  it("NÃO revoga o link ativo emitido por uma pessoa: cria tarefa dizendo para reenviá-lo", async () => {
    const b = montar({ tentativa: 9 }, [{ chave: "ligacao_ia.max_tentativas", valor: 1, descricao: "" }]);
    await aplicarResultado(b.comoCliente(), { id_evento: "e16", ligacao_id: LIGACAO, evento: "sem_resposta" });

    expect(b.tabelas.links_publicos[0].estado).toBe("ativo");
    expect(b.tabelas.links_publicos[0].revogado_em).toBeUndefined();
    expect(tarefas(b)).toHaveLength(1);
    expect(String(tarefas(b)[0].descricao)).toContain("Enviar link de agendamento ao cliente");
    // Nenhum link novo foi emitido.
    expect(b.chamadasRpc.some((c) => c.nome === "emitir_link_agendamento_sistema")).toBe(false);
  });

  it("a tarefa leva o telefone e o número da ligação, para a equipe agir sem caçar dado", async () => {
    const b = montar({ tentativa: 9 }, [{ chave: "ligacao_ia.max_tentativas", valor: 1, descricao: "" }]);
    await tratarFalha(b.comoCliente(), linhaLigacao(b) as unknown as LigacaoIa);
    const descricao = String(tarefas(b)[0].descricao);
    expect(descricao).toContain("+5521987654321");
    expect(descricao).toContain(LIGACAO.slice(0, 8));
    expect(tarefas(b)[0].origem).toBe("sistema");
  });
});

describe("extras do evento", () => {
  it("arredonda custo em 4 casas, aceita `duracao_s` e `duracao_segundos`, e corta o resumo", async () => {
    const b = montar();
    await aplicarResultado(b.comoCliente(), {
      id_evento: "e17",
      ligacao_id: LIGACAO,
      evento: "em_ligacao",
      custo_usd: 0.07319999,
      duracao_segundos: 61.7,
      resumo: "r".repeat(9000),
      id_externo: "x".repeat(500),
    });
    const l = linhaLigacao(b);
    expect(l.custo_usd).toBe(0.0732);
    expect(l.duracao_segundos).toBe(62);
    expect((l.resumo as string).length).toBe(4000);
    expect((l.id_externo as string).length).toBe(200);
  });

  it("valores negativos ou não numéricos são ignorados — nunca viram zero", async () => {
    const b = montar();
    await aplicarResultado(b.comoCliente(), {
      id_evento: "e18",
      ligacao_id: LIGACAO,
      evento: "em_ligacao",
      custo_usd: -5,
      duracao_s: Number.NaN,
    });
    expect(linhaLigacao(b).custo_usd).toBeNull();
    expect(linhaLigacao(b).duracao_segundos).toBeNull();
  });
});

/**
 * A1 do pentest (06/09/2026) — DEFESA EM PROFUNDIDADE.
 *
 * A autenticação de verdade é o HMAC da rota. Isto é a segunda tranca, para o
 * caso de o segredo do n8n vazar ou de alguém achar como fazer o n8n assinar um
 * corpo forjado (era exatamente o que o `metadata.callback_url` permitia).
 * `id_externo` é o id da CALL na Vapi: só quem recebeu a resposta do disparo o
 * conhece.
 */
describe("A1 · id_externo divergente não mexe na ligação", () => {
  it("ligação já carimbada + evento com OUTRO id_externo → ignorado, nada muda", async () => {
    const b = montar({ status: "em_ligacao", id_externo: "call_verdadeira" });
    const r = await aplicarResultado(b.comoCliente(), {
      id_evento: "e20",
      ligacao_id: LIGACAO,
      evento: "concluida",
      id_externo: "call_forjada",
      horario_escolhido: "2026-09-10T18:00:00.000Z",
      resumo: "cliente aceitou (forjado)",
    });

    expect(r.ignorado).toBe("id_externo_divergente");
    const l = linhaLigacao(b);
    expect(l.status).toBe("em_ligacao");
    expect(l.id_externo).toBe("call_verdadeira");
    expect(l.resumo).toBeNull();
    expect(l.encerrada_em).toBeNull();
    // E, sobretudo: nenhuma tentativa de agendar em nome do cliente.
    expect(b.chamadasRpc.filter((c) => c.nome === "registrar_horario_ligacao_ia")).toHaveLength(0);
  });

  it("o MESMO id_externo é reentrega legítima e segue o fluxo", async () => {
    const b = montar({ status: "em_ligacao", id_externo: "call_verdadeira" });
    const r = await aplicarResultado(b.comoCliente(), {
      id_evento: "e21",
      ligacao_id: LIGACAO,
      evento: "concluida",
      id_externo: "call_verdadeira",
      resultado: "recusou",
    });
    expect(r.ignorado).toBeUndefined();
    expect(linhaLigacao(b).status).toBe("concluida");
  });

  it("ligação ainda SEM id_externo aceita o primeiro que chegar (é assim que ela é carimbada)", async () => {
    const b = montar({ status: "na_fila", id_externo: null });
    await aplicarResultado(b.comoCliente(), { id_evento: "e22", ligacao_id: LIGACAO, evento: "discando", id_externo: "call_nova" });
    expect(linhaLigacao(b).id_externo).toBe("call_nova");
  });

  it("evento sem id_externo não é bloqueado (a Vapi nem sempre manda)", async () => {
    const b = montar({ status: "em_ligacao", id_externo: "call_verdadeira" });
    await aplicarResultado(b.comoCliente(), { id_evento: "e23", ligacao_id: LIGACAO, evento: "concluida", resultado: "pediu_retorno" });
    expect(linhaLigacao(b).status).toBe("concluida");
  });
});

/**
 * B2 do pentest: a retentativa herda o MESMO `link_id` — logo tem de herdar o
 * token cifrado dele. Sem isso, depois de um restart a tentativa 2 não recupera
 * o token, reemite o link e REVOGA o que o sistema já mandou ao cliente.
 * Herdar é RESELAR: o AAD do v2 amarra o blob ao `id` da linha (B1).
 */
describe("B2 · a retentativa herda o token do link", () => {
  const configRetentativa = [
    { chave: "ligacao_ia.max_tentativas", valor: 3, descricao: "" },
    { chave: "ligacao_ia.intervalo_retentativa_minutos", valor: 60, descricao: "" },
  ];

  it("o token viaja para a linha nova e abre lá — e não abre na linha velha", async () => {
    const cifrado = cifrarToken("tok_do_link_do_sistema", LIGACAO);
    const b = montar({ tentativa: 1, link_id: LINK_HUMANO, token_link_cifrado: cifrado } as Partial<LigacaoIa>, configRetentativa);
    await aplicarResultado(b.comoCliente(), { id_evento: "e24", ligacao_id: LIGACAO, evento: "sem_resposta" });

    const nova = b.tabelas.ligacoes_ia[1];
    expect(nova.link_id).toBe(LINK_HUMANO);
    expect(typeof nova.token_link_cifrado).toBe("string");
    expect(nova.token_link_cifrado).not.toBe(cifrado);
    expect(decifrarToken(nova.token_link_cifrado as string, nova.id as string)).toBe("tok_do_link_do_sistema");
    expect(decifrarToken(nova.token_link_cifrado as string, LIGACAO)).toBeNull();
  });

  it("sem token para herdar, reenfileira com null — nunca falha por causa disso", async () => {
    const b = montar({ tentativa: 1, link_id: LINK_HUMANO }, configRetentativa);
    await aplicarResultado(b.comoCliente(), { id_evento: "e25", ligacao_id: LIGACAO, evento: "sem_resposta" });
    expect(b.tabelas.ligacoes_ia).toHaveLength(2);
    expect(b.tabelas.ligacoes_ia[1].token_link_cifrado).toBeNull();
  });

  it("sem a 0073 aplicada (42703), reenfileira sem a coluna em vez de perder a tentativa", async () => {
    const b = montar({ tentativa: 1, link_id: LINK_HUMANO }, configRetentativa);
    let primeira = true;
    const originalFrom = b.from.bind(b);
    b.from = ((tabela: string) => {
      const consulta = originalFrom(tabela);
      if (tabela !== "ligacoes_ia") return consulta;
      const insertOriginal = consulta.insert.bind(consulta);
      consulta.insert = ((linhas: Record<string, unknown>) => {
        if (primeira && "token_link_cifrado" in linhas) {
          primeira = false;
          b.erros["ligacoes_ia:insert"] = { code: "42703", message: 'column "token_link_cifrado" does not exist' };
        } else {
          delete b.erros["ligacoes_ia:insert"];
        }
        return insertOriginal(linhas);
      }) as typeof consulta.insert;
      return consulta;
    }) as typeof b.from;

    await aplicarResultado(b.comoCliente(), { id_evento: "e26", ligacao_id: LIGACAO, evento: "sem_resposta" });
    expect(b.tabelas.ligacoes_ia).toHaveLength(2);
    expect(b.tabelas.ligacoes_ia[1].tentativa).toBe(2);
    expect(b.tabelas.ligacoes_ia[1]).not.toHaveProperty("token_link_cifrado");
  });
});
