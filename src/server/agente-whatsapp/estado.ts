import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { AcaoAgente, IntencaoAgente } from "@/types/agente";
import type { EstadoAgente } from "./porteiro";
import type { TipoLinkAgente } from "./passo";

/**
 * A claim, o livro-razão e a memória curta do agente.
 *
 * A trava anti-resposta-dupla NÃO é um `if`: é o
 * `unique (mensagem_recebida_id)` de `agente_whatsapp_respostas` (0088). O
 * fluxo insere a linha ANTES de falar com qualquer provedor; sem linha de
 * volta, outro processo já pegou a mensagem e este sai calado. Duas entregas
 * simultâneas do mesmo `message_created` (o Chatwoot reentrega) não viram duas
 * mensagens no WhatsApp do cliente.
 */

const AUSENTE = new Set(["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"]);

export type ResultadoClaim =
  | { situacao: "claimada"; respostaId: string }
  /** Outro processo (ou uma reentrega) já tinha a mensagem. Sair calado. */
  | { situacao: "ja_claimada" }
  /** A 0088 não está aplicada — sem livro-razão não há resposta. */
  | { situacao: "indisponivel"; erro: string };

export async function reivindicarMensagem(
  admin: SupabaseClient,
  params: { mensagemRecebidaId: string; jornadaId: string; conversaExternaId: string },
): Promise<ResultadoClaim> {
  const { data, error } = await admin
    .from("agente_whatsapp_respostas")
    .insert({
      mensagem_recebida_id: params.mensagemRecebidaId,
      jornada_id: params.jornadaId,
      conversa_externa_id: params.conversaExternaId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === "23505") return { situacao: "ja_claimada" };
    if (AUSENTE.has(error.code ?? "")) return { situacao: "indisponivel", erro: "agente_whatsapp_respostas ausente (0088 não aplicada)" };
    throw error;
  }
  return { situacao: "claimada", respostaId: data.id };
}

export interface FechamentoResposta {
  intencao: IntencaoAgente | null;
  confianca: number | null;
  acao: AcaoAgente | null;
  texto: string | null;
  execucaoIaId: string | null;
  custoUsd: number | null;
  provedorId: string | null;
  enviadaEm: string | null;
  erro: string | null;
}

/** Fecha a linha da claim com o que aconteceu de verdade. Nunca lança. */
export async function fecharResposta(admin: SupabaseClient, respostaId: string, dados: FechamentoResposta): Promise<void> {
  const { error } = await admin
    .from("agente_whatsapp_respostas")
    .update({
      intencao: dados.intencao,
      confianca: dados.confianca,
      acao: dados.acao,
      texto: dados.texto,
      execucao_ia_id: dados.execucaoIaId,
      custo_usd: dados.custoUsd,
      provedor_id: dados.provedorId,
      enviada_em: dados.enviadaEm,
      erro: dados.erro,
    })
    .eq("id", respostaId);
  if (error) registrarErro("agente-whatsapp/estado.fecharResposta", error, { resposta_id: respostaId });
}

export interface AtualizacaoEstado {
  passoUltimo?: string | null;
  ultimaIntencao?: string | null;
  esquivasSeguidas?: number;
  humanoRespondeuEm?: string | null;
  pausadoAte?: string | null;
  pausadoPor?: string | null;
  /** Tipo de link recém-emitido → carimba `ultimo_link_em[tipo] = agora`. */
  linkEmitido?: TipoLinkAgente;
}

/**
 * Upsert do estado da jornada. `ultimo_link_em` é mesclado (não sobrescrito):
 * carimbar o link de documentos não pode apagar o carimbo do formulário.
 */
export async function salvarEstado(
  admin: SupabaseClient,
  jornadaId: string,
  atual: EstadoAgente | null,
  mudanca: AtualizacaoEstado,
  agora: number = Date.now(),
): Promise<void> {
  const ultimoLink = { ...(atual?.ultimo_link_em ?? {}) };
  if (mudanca.linkEmitido) ultimoLink[mudanca.linkEmitido] = new Date(agora).toISOString();

  const linha: Record<string, unknown> = {
    jornada_id: jornadaId,
    ultimo_link_em: ultimoLink,
  };
  if (mudanca.passoUltimo !== undefined) linha.passo_ultimo = mudanca.passoUltimo;
  if (mudanca.ultimaIntencao !== undefined) linha.ultima_intencao = mudanca.ultimaIntencao;
  if (mudanca.esquivasSeguidas !== undefined) linha.esquivas_seguidas = mudanca.esquivasSeguidas;
  if (mudanca.humanoRespondeuEm !== undefined) linha.humano_respondeu_em = mudanca.humanoRespondeuEm;
  if (mudanca.pausadoAte !== undefined) linha.pausado_ate = mudanca.pausadoAte;
  if (mudanca.pausadoPor !== undefined) linha.pausado_por = mudanca.pausadoPor;

  const { error } = await admin.from("agente_whatsapp_estado").upsert(linha, { onConflict: "jornada_id" });
  if (error && !AUSENTE.has(error.code ?? "")) {
    registrarErro("agente-whatsapp/estado.salvarEstado", error, { jornada_id: jornadaId });
  }
}

/**
 * Tarefa para a equipe. `uniq_tarefa_aberta_por_tipo` (0051) garante UMA
 * tarefa aberta por tipo por jornada — a segunda vez vira 23505 e isso é
 * sucesso, não erro: a fila não pode encher com a mesma coisa.
 *
 * `origem = 'sistema'`, `criado_por = NULL` (B64): quem abriu foi o robô, e o
 * robô não tem perfil em `perfis_equipe`.
 */
export async function abrirTarefa(
  admin: SupabaseClient,
  params: { jornadaId: string; tipo: string; titulo: string; descricao: string },
): Promise<void> {
  const { error } = await admin.from("tarefas").insert({
    jornada_id: params.jornadaId,
    tipo: params.tipo,
    titulo: params.titulo,
    descricao: params.descricao.slice(0, 1000),
    origem: "sistema",
  });
  if (error && error.code !== "23505" && !AUSENTE.has(error.code ?? "")) {
    registrarErro("agente-whatsapp/estado.abrirTarefa", error, { jornada_id: params.jornadaId, tipo: params.tipo });
  }
}

/**
 * D26 — a resposta do agente vira evento de timeline `mensagem`, com
 * `origem: 'agente_whatsapp'`, intenção, confiança e custo. A equipe vê o que
 * o robô disse no MESMO lugar em que vê o resto.
 *
 * `ator_tipo` é `ia` quando o modelo redigiu e `sistema` quando o texto é fixo:
 * a distinção importa para quem audita custo e alucinação.
 */
export async function registrarNaTimeline(
  admin: SupabaseClient,
  params: {
    jornadaId: string;
    texto: string;
    intencao: IntencaoAgente | null;
    confianca: number | null;
    custoUsd: number | null;
    promptVersao: number | null;
    usouIa: boolean;
  },
): Promise<void> {
  const { error } = await admin.from("eventos_timeline").insert({
    jornada_id: params.jornadaId,
    tipo: "mensagem",
    titulo: "Agente respondeu no WhatsApp",
    descricao: params.texto.slice(0, 1000),
    ator_tipo: params.usouIa ? "ia" : "sistema",
    dados: {
      direcao: "enviada",
      canal: "whatsapp",
      origem: "agente_whatsapp",
      intencao: params.intencao,
      confianca: params.confianca,
      custo_usd: params.custoUsd,
      prompt_versao: params.promptVersao,
    },
  });
  if (error && !AUSENTE.has(error.code ?? "")) {
    registrarErro("agente-whatsapp/estado.registrarNaTimeline", error, { jornada_id: params.jornadaId });
  }
}

/**
 * C8/D24 — carimba que um HUMANO falou na conversa.
 *
 * Chamado quando o webhook vê uma mensagem `outgoing` que NÃO é nossa. O que é
 * nosso se reconhece pelo `provedor_id` que a própria resposta gravou — não
 * por formato de `sender`, que é do Chatwoot e pode mudar de versão para
 * versão. `outgoing` nunca é gravado em `mensagens_recebidas`: aquela tabela é
 * de ENTRADA, e misturar os dois lados ali criaria um segundo vocabulário.
 */
export async function carimbarRespostaHumana(
  admin: SupabaseClient,
  params: { conversaExternaId: string; provedorId: string | null; quandoIso: string },
): Promise<{ carimbou: boolean; motivo: string }> {
  if (params.provedorId) {
    const { data: nossa } = await admin
      .from("agente_whatsapp_respostas")
      .select("id")
      .eq("provedor_id", params.provedorId)
      .maybeSingle<{ id: string }>();
    if (nossa) return { carimbou: false, motivo: "resposta_do_proprio_agente" };
  }

  const { data: recebida } = await admin
    .from("mensagens_recebidas")
    .select("jornada_id")
    .eq("provedor", "chatwoot")
    .eq("conversa_externa_id", params.conversaExternaId)
    .not("jornada_id", "is", null)
    .order("recebida_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ jornada_id: string }>();

  if (!recebida?.jornada_id) return { carimbou: false, motivo: "conversa_sem_jornada_conhecida" };

  const { error } = await admin
    .from("agente_whatsapp_estado")
    .upsert({ jornada_id: recebida.jornada_id, humano_respondeu_em: params.quandoIso }, { onConflict: "jornada_id" });
  if (error) {
    if (AUSENTE.has(error.code ?? "")) return { carimbou: false, motivo: "0088_nao_aplicada" };
    registrarErro("agente-whatsapp/estado.carimbarRespostaHumana", error, { conversa: params.conversaExternaId });
    return { carimbou: false, motivo: "falha_ao_carimbar" };
  }
  return { carimbou: true, motivo: "humano_respondeu" };
}
