import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarTelefoneE164, variantesTelefone } from "@/server/integracoes/telefone";
import { temConsentimento } from "@/server/ia/consentimento";
import { registrarErro } from "@/server/erros";
import type { EventoChatwoot } from "@/server/chatwoot/recebidas";
import { lerConfigAgente, type ConfigAgente } from "./config";
import type { SinaisBrutoAgente } from "./passo";

/**
 * O PORTEIRO — as 14 travas do §B do plano, em ordem fixa e FAIL-CLOSED.
 *
 * Nenhuma delas responde ao cliente com o motivo (D6): "você não tem
 * consentimento" é vazamento de estado interno para um número que pode nem ser
 * dele. Quem lê o motivo é a EQUIPE, na pendência ou na tarefa.
 *
 * O porteiro é o produto desta fase. Medido no banco em 07/09/2026:
 * das 6 pessoas, a ÚNICA `origem_dado='real'` estava gravada como `11988887777`
 * (sem `+`) e com ZERO consentimentos, e as 4 famílias de demonstração têm
 * `+5500…` com os 4 consentimentos. Ligar o agente sem porteiro daria o pior
 * resultado possível: mudo para quem é real, falante para quem é fictício.
 */

export type MotivoSilencio =
  | "agente_desligado"
  | "sem_chatwoot"
  | "inbox_diferente"
  | "sem_telefone"
  | "numero_desconhecido"
  | "telefone_ambiguo"
  | "origem_demonstracao"
  | "sem_jornada_aberta"
  | "sem_pagamento"
  | "sem_consentimento_whatsapp"
  | "humano_no_comando"
  | "pausado"
  | "teto_respostas_hora"
  | "ja_respondida"
  | "falha_ao_avaliar";

export interface ContextoPorteiro {
  config: ConfigAgente;
  pessoaId: string;
  jornadaId: string;
  /** O telefone JÁ normalizado que casou — a 15ª trava compara a conversa com ele. */
  telefoneE164: string;
  primeiroNome: string | null;
  /** `true` = a pessoa consentiu `tratamento_ia`; `false` → só texto fixo (B56). */
  podeUsarIa: boolean;
  sinais: SinaisBrutoAgente;
  /** Estado de `agente_whatsapp_estado` (pode não existir ainda). */
  estado: EstadoAgente | null;
}

export interface EstadoAgente {
  jornada_id: string;
  passo_ultimo: string | null;
  ultima_intencao: string | null;
  esquivas_seguidas: number;
  humano_respondeu_em: string | null;
  pausado_ate: string | null;
  pausado_por: string | null;
  ultimo_link_em: Record<string, string>;
}

export type ResultadoPorteiro =
  | { responder: true; contexto: ContextoPorteiro }
  | {
      responder: false;
      motivo: MotivoSilencio;
      /** Quando dá para saber, a jornada — para pendurar tarefa. `null` quando não. */
      jornadaId: string | null;
      /** Texto para a EQUIPE (tarefa/pendência), nunca para o cliente. */
      detalhe: string;
    };

function silencio(motivo: MotivoSilencio, detalhe: string, jornadaId: string | null = null): ResultadoPorteiro {
  return { responder: false, motivo, jornadaId, detalhe };
}

/**
 * Trava 5 — a mensagem tem de ter chegado NA inbox do onboarding.
 *
 * D8: nenhuma trava depende de a variável só ESTAR presente. Sem
 * `CHATWOOT_INBOX_ID` a comparação não tem com o que casar e o agente cala —
 * env presente ≠ env válida (armadilha catalogada nesta casa).
 */
export function inboxDoEvento(evento: EventoChatwoot): string | null {
  const bruto = evento.conversation?.inbox_id ?? evento.inbox?.id ?? null;
  return bruto == null ? null : String(bruto);
}

export function inboxConfere(evento: EventoChatwoot): boolean {
  const configurada = (process.env.CHATWOOT_INBOX_ID ?? "").trim();
  if (!configurada) return false;
  const doEvento = inboxDoEvento(evento);
  return doEvento !== null && doEvento === configurada;
}

/**
 * Trava 7 — demonstração NUNCA recebe WhatsApp de verdade (D5).
 *
 * Conferido na PESSOA e na JORNADA: o seed usa `+5500900000001`, que
 * `normalizarTelefoneE164` aceita (13 dígitos com DDI). Só `telefoneParaLigacao`
 * recusa DDD 00, e não é ele quem casa aqui.
 */
export function ehDadoReal(sinais: SinaisBrutoAgente): boolean {
  return sinais.pessoa_origem_dado === "real" && sinais.jornada_origem_dado === "real";
}

/** Trava 11 — humano respondeu na conversa há menos de N minutos (C8/D24). */
export function humanoNoComando(estado: EstadoAgente | null, minutos: number, agora: number): boolean {
  if (!estado?.humano_respondeu_em) return false;
  const quando = Date.parse(estado.humano_respondeu_em);
  if (Number.isNaN(quando)) return false;
  return agora - quando < minutos * 60_000;
}

/** Trava 12 — "Assumir conversa" pausou o agente (D25). */
export function estaPausado(estado: EstadoAgente | null, agora: number): boolean {
  if (!estado?.pausado_ate) return false;
  const ate = Date.parse(estado.pausado_ate);
  return !Number.isNaN(ate) && ate > agora;
}

/**
 * O porteiro. Recebe a mensagem JÁ GRAVADA (trava 3: grava sempre, inclusive
 * de desconhecido) e decide se o agente pode falar.
 *
 * As travas 1, 2 e 14 não estão aqui:
 *   1 (token/tipo de evento) é da rota, e já existia;
 *   2 (dedupe) é o `unique (provedor, mensagem_externa_id)` de 0054;
 *  14 (claim) acontece DEPOIS, em `estado.ts`, imediatamente antes de falar.
 */
export async function avaliarPorteiro(
  admin: SupabaseClient,
  params: {
    evento: EventoChatwoot;
    telefoneBruto: string | null;
    agora?: number;
  },
): Promise<ResultadoPorteiro> {
  const agora = params.agora ?? Date.now();

  try {
    // 4 — o interruptor. Chave ausente ou falha de leitura = desligado.
    const config = await lerConfigAgente(admin);
    if (!config.ativo) {
      return silencio("agente_desligado", "agente_whatsapp.ativo = false (o agente está desligado em Admin).");
    }

    // 5 — a inbox do onboarding, e só ela.
    if (!inboxConfere(params.evento)) {
      return silencio(
        "inbox_diferente",
        `Mensagem chegou na inbox ${inboxDoEvento(params.evento) ?? "(sem inbox no payload)"}, que não é a do onboarding (CHATWOOT_INBOX_ID).`,
      );
    }

    // 6 — casar telefone, exigindo CARDINALIDADE 1.
    const e164 = normalizarTelefoneE164(params.telefoneBruto);
    if (!e164) {
      return silencio("sem_telefone", "O payload não trouxe telefone em formato reconhecível.");
    }
    const casamento = await casarPessoa(admin, e164);
    if (casamento.quantidade === 0) {
      // D1: número desconhecido não recebe resposta NENHUMA — nem "não
      // entendi", nem erro. Qualquer texto confirma que existe um sistema
      // atrás do número. O registro é a mensagem já gravada + a pendência
      // derivada `numero_desconhecido` (0089).
      return silencio("numero_desconhecido", `Número ${e164} não casou com nenhuma pessoa do cadastro.`);
    }
    if (casamento.quantidade > 1) {
      return silencio(
        "telefone_ambiguo",
        `Número ${e164} casa com ${casamento.quantidade} pessoas do cadastro. O agente cala em vez de escolher a errada.`,
      );
    }

    const pessoaId = casamento.pessoaId!;
    const jornadaId = casamento.jornadaId;
    if (!jornadaId) {
      // B62: processo fechado/arquivado não recebe agente, e a resposta não
      // pode revelar em que pé está o processo. A tarefa vai na jornada mais
      // recente da pessoa (que existe, só não está aberta) — sem ela a equipe
      // nunca saberia que o cliente escreveu.
      const ultima = await ultimaJornadaDaPessoa(admin, pessoaId);
      return silencio("sem_jornada_aberta", "Cliente sem processo aberto escreveu no WhatsApp — o agente não respondeu.", ultima);
    }

    const sinais = await lerSinais(admin, jornadaId);
    if (!sinais) {
      return silencio("falha_ao_avaliar", `Não foi possível ler os sinais da jornada ${jornadaId}.`, jornadaId);
    }

    // 7 — demonstração nunca recebe.
    if (!ehDadoReal(sinais)) {
      return silencio(
        "origem_demonstracao",
        `Jornada ${jornadaId} é de demonstração (pessoa=${sinais.pessoa_origem_dado}, jornada=${sinais.jornada_origem_dado}).`,
        jornadaId,
      );
    }

    // 8 — só processo aberto (redundante com o casamento, mas a jornada pode
    // ter fechado entre uma consulta e outra; trava barata, erro caro).
    if (sinais.desfecho !== "aberta") {
      return silencio("sem_jornada_aberta", `Processo com desfecho "${sinais.desfecho}" — o agente não fala.`, jornadaId);
    }

    // 9 — B63: o onboarding começa no PAGO. Lead que não comprou a Sessão de
    // Viabilidade vira tarefa comercial, não conversa de onboarding.
    const nivel = typeof sinais.nivel_pago_vigente === "number" ? sinais.nivel_pago_vigente : 0;
    if (nivel < 1) {
      return silencio("sem_pagamento", "Escreveu antes de contratar a Sessão de Viabilidade (nível pago vigente 0).", jornadaId);
    }

    // 10 — consentimento de WhatsApp. Sem ele, nem uma palavra sai.
    const consenteWhatsapp = await temConsentimento(admin, pessoaId, "comunicacao_whatsapp");
    if (!consenteWhatsapp) {
      return silencio("sem_consentimento_whatsapp", "Escreveu sem consentimento vigente de comunicação por WhatsApp.", jornadaId);
    }

    const estado = await lerEstado(admin, jornadaId);

    // 11 — humano respondeu há pouco: o robô cala.
    if (humanoNoComando(estado, config.silencioHumanoMinutos, agora)) {
      return silencio("humano_no_comando", `Um humano respondeu nesta conversa há menos de ${config.silencioHumanoMinutos} min.`, jornadaId);
    }

    // 12 — "Assumir conversa".
    if (estaPausado(estado, agora)) {
      return silencio("pausado", `Conversa assumida pela equipe até ${estado!.pausado_ate}.`, jornadaId);
    }

    // 13 — teto por hora.
    const naUltimaHora = await contarRespostasNaJanela(admin, jornadaId, new Date(agora - 3_600_000).toISOString());
    if (naUltimaHora >= config.tetoRespostasHora) {
      return silencio(
        "teto_respostas_hora",
        `O agente já respondeu ${naUltimaHora} vezes nesta última hora (teto ${config.tetoRespostasHora}).`,
        jornadaId,
      );
    }

    // B56: sem `tratamento_ia`, o agente responde SÓ com texto fixo e nenhuma
    // palavra do cliente sai para o modelo. O texto vigente do consentimento
    // fala em preparar a Sessão de Viabilidade, não em conversar por chat (C6).
    const podeUsarIa = await temConsentimento(admin, pessoaId, "tratamento_ia");

    return {
      responder: true,
      contexto: {
        config,
        pessoaId,
        jornadaId,
        telefoneE164: e164,
        primeiroNome: sinais.primeiro_nome ?? null,
        podeUsarIa,
        sinais,
        estado,
      },
    };
  } catch (erro) {
    registrarErro("agente-whatsapp/porteiro", erro);
    // Falha de infraestrutura no porteiro NUNCA vira resposta ao cliente.
    return silencio("falha_ao_avaliar", "Falha ao avaliar as travas do agente — nada foi enviado.");
  }
}

// ---------------------------------------------------------------------------
// Acesso a banco (cada um com fallback para "a 0088/0089 ainda não foi aplicada")
// ---------------------------------------------------------------------------

const AUSENTE = new Set(["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"]);

export interface CasamentoTelefone {
  pessoaId: string | null;
  jornadaId: string | null;
  quantidade: number;
}

/**
 * Casa o telefone pela RPC da 0088 (uma consulta, índice de expressão,
 * cardinalidade garantida no banco). Se a 0088 ainda não foi aplicada, cai
 * para a busca por variantes — que também exige cardinalidade 1, porque o
 * `.limit(1)` do código antigo escolheria a pessoa ERRADA em silêncio.
 */
export async function casarPessoa(admin: SupabaseClient, e164: string): Promise<CasamentoTelefone> {
  const { data, error } = await admin.rpc("casar_pessoa_por_telefone", { p_telefone: e164 });
  if (!error && Array.isArray(data) && data.length > 0) {
    const linha = data[0] as { pessoa_id: string | null; jornada_id: string | null; quantidade: number };
    return { pessoaId: linha.pessoa_id, jornadaId: linha.jornada_id, quantidade: Number(linha.quantidade) || 0 };
  }
  if (error && !AUSENTE.has(error.code ?? "")) throw error;

  const { data: pessoas, error: erroPessoas } = await admin
    .from("pessoas")
    .select("id")
    .in("telefone", variantesTelefone(e164))
    .limit(2)
    .returns<Array<{ id: string }>>();
  if (erroPessoas) throw erroPessoas;
  const encontradas = pessoas ?? [];
  if (encontradas.length !== 1) {
    return { pessoaId: null, jornadaId: null, quantidade: encontradas.length };
  }
  const { data: jornada } = await admin
    .from("jornadas")
    .select("id")
    .eq("pessoa_id", encontradas[0].id)
    .eq("desfecho", "aberta")
    .maybeSingle<{ id: string }>();
  return { pessoaId: encontradas[0].id, jornadaId: jornada?.id ?? null, quantidade: 1 };
}

/** Os sinais da jornada — UMA chamada (0089). Sem a migration, `null` → o agente cala. */
export async function lerSinais(admin: SupabaseClient, jornadaId: string): Promise<SinaisBrutoAgente | null> {
  const { data, error } = await admin.rpc("sinais_agente_whatsapp", { p_jornada_id: jornadaId });
  if (error) {
    if (AUSENTE.has(error.code ?? "")) return null;
    throw error;
  }
  return (data as SinaisBrutoAgente | null) ?? null;
}

export async function lerEstado(admin: SupabaseClient, jornadaId: string): Promise<EstadoAgente | null> {
  const { data, error } = await admin
    .from("agente_whatsapp_estado")
    .select("jornada_id, passo_ultimo, ultima_intencao, esquivas_seguidas, humano_respondeu_em, pausado_ate, pausado_por, ultimo_link_em")
    .eq("jornada_id", jornadaId)
    .maybeSingle<EstadoAgente>();
  if (error) {
    if (AUSENTE.has(error.code ?? "")) return null;
    throw error;
  }
  return data ?? null;
}

/** A jornada mais recente da pessoa, aberta ou não — só para pendurar tarefa. */
export async function ultimaJornadaDaPessoa(admin: SupabaseClient, pessoaId: string): Promise<string | null> {
  const { data } = await admin
    .from("jornadas")
    .select("id")
    .eq("pessoa_id", pessoaId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

export async function contarRespostasNaJanela(admin: SupabaseClient, jornadaId: string, desdeIso: string): Promise<number> {
  const { count, error } = await admin
    .from("agente_whatsapp_respostas")
    .select("id", { count: "exact", head: true })
    .eq("jornada_id", jornadaId)
    .gte("criado_em", desdeIso);
  if (error) {
    if (AUSENTE.has(error.code ?? "")) return 0;
    throw error;
  }
  return count ?? 0;
}
