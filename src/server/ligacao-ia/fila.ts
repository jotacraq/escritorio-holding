import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config-publica";
import { gerarSugestoesAgendamento } from "@/server/agenda/sugestoes";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro } from "@/server/erros";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { CHAVE_LIGACAO_PROVEDOR, lerConfiguracaoTexto } from "@/server/integracoes/config";
import type { LigacaoIa, ProvedorLigacaoIaNome } from "@/types/integracoes";
import { paraHorarioOfertado } from "./horarios";
import { n8nLigacaoConfigurado } from "./n8n";
import type { OfertaHorarios } from "./tipos";

/**
 * Entrada na fila + preparação da oferta (link `/p/a` + `agendamentos_sugestoes`).
 *
 * A oferta é preparada AO DISPARAR (não ao enfileirar): assim o gatilho de
 * pagamento (SQL, sem pepper) e o botão da Ficha convergem no mesmo caminho,
 * e os horários são calculados o mais perto possível da ligação.
 *
 * O token do link só existe em claro neste processo, no momento da emissão
 * (`links_publicos` guarda só o hash). Guardamos em memória para o fallback
 * mandar o MESMO link por e-mail/WhatsApp; se o processo reiniciou ou o link
 * expirou, emite-se outro (que revoga o anterior — regra de `emitir_link_*`).
 */
const tokensPorLink = new Map<string, string>();
const QUANTIDADE_OFERTADA_A_IA = 4; // melhor horário + 3 alternativas

interface JornadaParaLigacao {
  id: string;
  desfecho: string;
  nivel_pago: number;
  responsavel_id: string | null;
  pessoas: { nome: string; telefone: string | null } | null;
}

async function carregarJornada(admin: SupabaseClient, jornadaId: string): Promise<JornadaParaLigacao> {
  const { data, error } = await admin
    .from("jornadas")
    .select("id, desfecho, nivel_pago, responsavel_id, pessoas(nome, telefone)")
    .eq("id", jornadaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Jornada não encontrada.");
  const linha = data as unknown as JornadaParaLigacao & { pessoas: JornadaParaLigacao["pessoas"] | JornadaParaLigacao["pessoas"][] };
  const pessoas = Array.isArray(linha.pessoas) ? (linha.pessoas[0] ?? null) : linha.pessoas;
  return { ...linha, pessoas };
}

export async function nomeEResponsavel(
  admin: SupabaseClient,
  jornadaId: string,
): Promise<{ nome: string; responsavelId: string | null }> {
  const jornada = await carregarJornada(admin, jornadaId);
  return { nome: jornada.pessoas?.nome ?? "", responsavelId: jornada.responsavel_id };
}

/**
 * Enfileira uma ligação por IA para a jornada (botão "Ligar por IA" da Ficha).
 * Erros com código estável: `jornada_fechada` (409), `sem_pagamento` (409),
 * `sem_telefone` (409), `ligacao_ativa` (409), `nao_encontrado` (404).
 */
export async function enfileirarLigacaoIa(
  admin: SupabaseClient,
  params: { jornadaId: string; solicitadaPor: string | null },
): Promise<{ ligacao: LigacaoIa; aviso: string | null }> {
  const jornada = await carregarJornada(admin, params.jornadaId);
  if (jornada.desfecho !== "aberta") throw erroConflito("jornada_fechada", "A jornada não está aberta.");
  if (jornada.nivel_pago < 1) {
    throw erroConflito("sem_pagamento", "A ligação por IA marca a Sessão de Viabilidade contratada — esta jornada ainda não tem pagamento aprovado.");
  }
  const telefone = jornada.pessoas?.telefone?.trim() ?? "";
  if (!telefone) throw erroConflito("sem_telefone", "A pessoa não tem telefone cadastrado.");

  const provedorConfigurado = (await lerConfiguracaoTexto(admin, CHAVE_LIGACAO_PROVEDOR, "manual")) as ProvedorLigacaoIaNome;
  let provedor: ProvedorLigacaoIaNome = provedorConfigurado === "n8n" ? "n8n" : "manual";
  let aviso: string | null = null;
  if (provedor === "n8n" && !n8nLigacaoConfigurado()) {
    provedor = "manual";
    aviso = "Ligação por IA não configurada no servidor (N8N_WEBHOOK_LIGACAO_URL, LIGACAO_IA_WEBHOOK_SECRET, VAPI_ASSISTENTE_ID): vai virar tarefa para a equipe ligar.";
  } else if (provedor === "manual") {
    aviso = "Ligação por IA em modo manual (Admin → Integrações): vai virar tarefa para a equipe ligar.";
  }

  const { data, error } = await admin
    .from("ligacoes_ia")
    .insert({
      jornada_id: params.jornadaId,
      provedor,
      telefone,
      origem: "equipe",
      solicitada_por: params.solicitadaPor,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw erroConflito("ligacao_ativa", "Já existe uma ligação por IA em andamento para esta jornada.");
    throw error;
  }
  return { ligacao: data as LigacaoIa, aviso };
}

interface LinhaSugestao {
  inicio_em: string;
  fim_em: string;
  posicao: number;
}

async function sugestoesDoLink(admin: SupabaseClient, linkId: string): Promise<LinhaSugestao[]> {
  const { data, error } = await admin
    .from("agendamentos_sugestoes")
    .select("inicio_em, fim_em, posicao")
    .eq("link_id", linkId)
    .order("posicao", { ascending: true })
    .limit(QUANTIDADE_OFERTADA_A_IA);
  if (error) throw error;
  return (data ?? []) as LinhaSugestao[];
}

async function linkAindaServe(admin: SupabaseClient, linkId: string): Promise<boolean> {
  const { data } = await admin
    .from("links_publicos")
    .select("estado, expira_em")
    .eq("id", linkId)
    .maybeSingle<{ estado: string; expira_em: string }>();
  return Boolean(data && data.estado === "ativo" && new Date(data.expira_em).getTime() > Date.now());
}

/**
 * Emite um link de agendamento pelo sistema e grava os slots que
 * `gerarSugestoesAgendamento` calcula (o mesmo cálculo do link da equipe).
 * Devolve null quando não há advogada na sessão ou não há disponibilidade.
 */
async function emitirLinkComSugestoes(
  admin: SupabaseClient,
  jornadaId: string,
  criadoPor: string | null,
): Promise<{ linkId: string; url: string; sugestoes: LinhaSugestao[] } | null> {
  const { data: sessao } = await admin
    .from("sessoes_viabilidade")
    .select("advogada_id")
    .eq("jornada_id", jornadaId)
    .maybeSingle<{ advogada_id: string | null }>();
  const advogadaId = sessao?.advogada_id ?? null;
  if (!advogadaId) return null;

  const pepper = exigirPepper();
  const token = gerarToken();
  const { data: link, error } = await admin
    .rpc("emitir_link_agendamento_sistema", {
      p_jornada_id: jornadaId,
      p_token_hash: hashToken(token, pepper),
      p_token_prefixo: token.slice(0, 6),
    })
    .single<{ id: string }>();
  if (error || !link) throw new Error(`falha_ao_emitir_link_agendamento_sistema: ${error?.message}`);

  const sugestoes = await gerarSugestoesAgendamento(admin, { jornadaId, advogadaId, criadoPor });
  if (sugestoes.itens.length === 0) {
    tokensPorLink.set(link.id, token);
    return null;
  }
  const { error: erroSugestoes } = await admin.from("agendamentos_sugestoes").insert(
    sugestoes.itens.map((item) => ({
      link_id: link.id,
      inicio_em: item.inicio_em,
      fim_em: item.fim_em,
      posicao: item.posicao,
      motivo_sugestao: item.motivo_sugestao,
      execucao_ia_id: item.execucao_ia_id,
    })),
  );
  if (erroSugestoes) throw erroSugestoes;

  tokensPorLink.set(link.id, token);
  return {
    linkId: link.id,
    url: `${APP_URL}/p/a/${token}`,
    sugestoes: sugestoes.itens.slice(0, QUANTIDADE_OFERTADA_A_IA).map((i) => ({ inicio_em: i.inicio_em, fim_em: i.fim_em, posicao: i.posicao })),
  };
}

function urlDoToken(linkId: string): string | null {
  const token = tokensPorLink.get(linkId);
  return token ? `${APP_URL}/p/a/${token}` : null;
}

/**
 * Garante que a ligação tem um link válido com horários. Reusa o `link_id`
 * da ligação se ainda serve; senão emite outro e grava em `ligacoes_ia.link_id`.
 * Devolve null (e NÃO lança) quando não há horário para oferecer.
 */
export async function prepararOferta(admin: SupabaseClient, ligacao: LigacaoIa): Promise<OfertaHorarios | null> {
  if (ligacao.link_id && (await linkAindaServe(admin, ligacao.link_id))) {
    const sugestoes = await sugestoesDoLink(admin, ligacao.link_id);
    if (sugestoes.length > 0) {
      return { link_id: ligacao.link_id, url: urlDoToken(ligacao.link_id), horarios: sugestoes.map(paraHorarioOfertado) };
    }
  }

  const novo = await emitirLinkComSugestoes(admin, ligacao.jornada_id, ligacao.solicitada_por);
  if (!novo) return null;

  const { error } = await admin.from("ligacoes_ia").update({ link_id: novo.linkId }).eq("id", ligacao.id);
  if (error) throw error;
  ligacao.link_id = novo.linkId;
  return { link_id: novo.linkId, url: novo.url, horarios: novo.sugestoes.map(paraHorarioOfertado) };
}

/**
 * URL do link de agendamento para o fallback (e-mail/WhatsApp). Prefere o
 * MESMO link já ofertado à IA (token em memória); senão emite outro. Devolve
 * null quando é impossível (sem pepper, sem advogada, sem disponibilidade).
 */
export async function urlDoLinkAgendamento(admin: SupabaseClient, ligacao: LigacaoIa): Promise<string | null> {
  try {
    if (ligacao.link_id && (await linkAindaServe(admin, ligacao.link_id))) {
      const url = urlDoToken(ligacao.link_id);
      if (url) return url;
    }
    const novo = await emitirLinkComSugestoes(admin, ligacao.jornada_id, ligacao.solicitada_por);
    if (!novo) {
      // Link pode ter sido emitido sem slots — ainda serve para o cliente ver "sem horários" com a equipe.
      return null;
    }
    await admin.from("ligacoes_ia").update({ link_id: novo.linkId }).eq("id", ligacao.id);
    return novo.url;
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 503) {
      registrarErro("ligacao-ia/fila.urlDoLinkAgendamento#pepper", erro, { ligacao_id: ligacao.id });
      return null;
    }
    registrarErro("ligacao-ia/fila.urlDoLinkAgendamento", erro, { ligacao_id: ligacao.id });
    return null;
  }
}

/** Só para testes de mesa: esvazia o cache de tokens deste processo. */
export function esquecerTokens(): void {
  tokensPorLink.clear();
}
