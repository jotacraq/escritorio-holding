import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config-publica";
import { gerarSugestoesAgendamento } from "@/server/agenda/sugestoes";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro } from "@/server/erros";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { CHAVE_LIGACAO_JANELA, CHAVE_LIGACAO_PROVEDOR, lerConfiguracoes } from "@/server/integracoes/config";
import { telefoneParaLigacao } from "@/server/integracoes/telefone";
import type { LigacaoIa, ProvedorLigacaoIaNome } from "@/types/integracoes";
import { paraHorarioOfertado } from "./horarios";
import { dentroDaJanela, proximaAbertura, rotuloAbertura, sanitizarJanela } from "./janela";
import { MOTIVOS_MANUAL, criarTarefaLigarParaAgendar } from "./manual";
import { n8nLigacaoConfigurado } from "./n8n";
import { cifrarToken, decifrarToken } from "./token-cifrado";
import type { OfertaHorarios } from "./tipos";

/**
 * Entrada na fila + preparação da oferta (link `/p/a` + `agendamentos_sugestoes`).
 *
 * A oferta é preparada AO DISPARAR (não ao enfileirar): assim o gatilho de
 * pagamento (SQL, sem pepper) e o botão da Ficha convergem no mesmo caminho,
 * e os horários são calculados o mais perto possível da ligação.
 *
 * O token do link só existe em claro no momento da emissão (`links_publicos`
 * guarda só o hash). Ele é guardado em DOIS lugares:
 *   - memória do processo (`tokensPorLink`) — caminho rápido;
 *   - `ligacoes_ia.token_link_cifrado` (0073), cifrado com chave derivada do
 *     `LINK_PUBLICO_PEPPER` — sobrevive a restart/deploy.
 * Sem a 0073 aplicada, o segundo caminho simplesmente não existe e o código
 * volta ao comportamento de memória (ver `guardarToken`).
 */
const tokensPorLink = new Map<string, string>();
const QUANTIDADE_OFERTADA_A_IA = 4; // melhor horário + 3 alternativas

/** Coluna da 0073 ainda não aplicada: nunca derruba a ligação por causa disso. */
export function colunaAusente(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || /column .*(token_link_cifrado|expurgado_em)/i.test(error.message ?? "")));
}

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

/** Os 3 estados que `uniq_ligacao_ia_ativa` (0053) considera "ativa". */
const STATUS_ATIVOS = ["na_fila", "discando", "em_ligacao"] as const;

/**
 * O que fazer quando `uniq_ligacao_ia_ativa` recusa o INSERT (23505).
 *
 * `na_fila` = ninguém discou ainda; o telefone do cliente não tocou e nada foi
 * gasto. Devolver 409 aí era mandar o operador CANCELAR para poder repetir o
 * mesmo pedido — três cliques para chegar onde "Ligar por IA agora" já queria
 * chegar, e uma linha `cancelada` no histórico que não conta nada. Reaproveitar
 * a ligação que já existe faz o botão significar exatamente o que ele diz.
 *
 * `discando`/`em_ligacao` continuam 409: a chamada está EM CURSO: pedir de novo
 * não a acelera e, se o provedor discasse de novo, tocaria duas vezes.
 */
export function decidirColisaoLigacaoAtiva(existente: { status: string } | null | undefined): "reaproveitar" | "conflito" {
  return existente?.status === "na_fila" ? "reaproveitar" : "conflito";
}

/** Mensagem do 409 nomeando o estado — "em andamento" não dizia o que fazer. */
function mensagemLigacaoAtiva(status: string | undefined): string {
  if (status === "em_ligacao") return "A IA está em ligação com esta pessoa agora. Recarregue a ficha em instantes para ver o resultado.";
  if (status === "discando") return "A IA está discando para esta pessoa agora. Recarregue a ficha em instantes para ver o resultado.";
  return "Já existe uma ligação por IA em andamento para esta jornada.";
}

/**
 * Enfileira uma ligação por IA para a jornada (botão "Ligar por IA" da Ficha).
 * Erros com código estável: `jornada_fechada` (409), `sem_pagamento` (409),
 * `sem_telefone` (409), `telefone_invalido` (409), `ligacao_ativa` (409),
 * `nao_encontrado` (404).
 *
 * `reaproveitada: true` = não houve INSERT; a ligação devolvida já existia
 * `na_fila` e quem chamou deve dispará-la (a rota faz isso e responde 200).
 *
 * `telefone_invalido` NÃO enfileira (Fase 7 · entrega 2): discar um número que
 * não existe queima crédito e, no pior caso, toca na casa de um estranho. Em vez
 * disso cria a tarefa humana com o número COMO ESTÁ, para a equipe corrigir o
 * cadastro — e o 409 diz isso com todas as letras.
 */
export async function enfileirarLigacaoIa(
  admin: SupabaseClient,
  params: { jornadaId: string; solicitadaPor: string | null },
): Promise<{ ligacao: LigacaoIa; aviso: string | null; reaproveitada: boolean }> {
  const jornada = await carregarJornada(admin, params.jornadaId);
  if (jornada.desfecho !== "aberta") throw erroConflito("jornada_fechada", "A jornada não está aberta.");
  if (jornada.nivel_pago < 1) {
    throw erroConflito("sem_pagamento", "A ligação por IA marca a Sessão de Viabilidade contratada — esta jornada ainda não tem pagamento aprovado.");
  }
  const bruto = jornada.pessoas?.telefone?.trim() ?? "";
  if (!bruto) throw erroConflito("sem_telefone", "A pessoa não tem telefone cadastrado.");

  const telefone = telefoneParaLigacao(bruto);
  if (!telefone.valido) {
    await criarTarefaLigarParaAgendar(admin, {
      jornadaId: params.jornadaId,
      responsavelId: jornada.responsavel_id,
      descricao: `${MOTIVOS_MANUAL.telefone_invalido}\nTelefone cadastrado (como está): ${bruto}\nMotivo: ${telefone.motivo}.`,
    });
    throw erroConflito(
      "telefone_invalido",
      `O telefone cadastrado (${bruto}) não é um número discável. Criamos a tarefa para a equipe ligar; corrija o cadastro para a IA poder discar.`,
    );
  }

  // Uma leitura só para as duas chaves — a janela não custa query nova.
  const cfg = await lerConfiguracoes(admin, [CHAVE_LIGACAO_PROVEDOR, CHAVE_LIGACAO_JANELA]);
  const provedorConfigurado = cfg.get(CHAVE_LIGACAO_PROVEDOR)?.valor;
  let provedor: ProvedorLigacaoIaNome = provedorConfigurado === "n8n" ? "n8n" : "manual";
  let aviso: string | null = null;
  if (provedor === "n8n" && !n8nLigacaoConfigurado()) {
    provedor = "manual";
    aviso = "Ligação por IA não configurada no servidor (N8N_WEBHOOK_LIGACAO_URL, LIGACAO_IA_WEBHOOK_SECRET, VAPI_ASSISTENTE_ID): vai virar tarefa para a equipe ligar.";
  } else if (provedor === "manual") {
    aviso = "Ligação por IA em modo manual (Admin → Integrações): vai virar tarefa para a equipe ligar.";
  } else {
    // §1c: o botão é ordem de gente e vale fora do horário — mas quem apertou
    // tem de saber que o telefone do cliente vai tocar AGORA, fora da janela.
    const janela = sanitizarJanela(cfg.get(CHAVE_LIGACAO_JANELA)?.valor);
    const agora = new Date();
    if (!dentroDaJanela(agora, janela)) {
      aviso = `Fora do horário de ligação configurado (${janela.inicio}–${janela.fim}). A ligação vai sair AGORA porque foi pedida à mão; a próxima abertura automática seria ${rotuloAbertura(proximaAbertura(agora, janela), janela.fuso)}.`;
    }
  }

  const { data, error } = await admin
    .from("ligacoes_ia")
    .insert({
      jornada_id: params.jornadaId,
      provedor,
      telefone: telefone.e164,
      origem: "equipe",
      solicitada_por: params.solicitadaPor,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code !== "23505") throw error;
    // A única ativa da jornada — é o próprio índice único que garante "uma só".
    const { data: existente } = await admin
      .from("ligacoes_ia")
      .select("*")
      .eq("jornada_id", params.jornadaId)
      .in("status", STATUS_ATIVOS)
      .maybeSingle<LigacaoIa>();
    if (decidirColisaoLigacaoAtiva(existente) === "conflito") {
      throw erroConflito("ligacao_ativa", mensagemLigacaoAtiva(existente?.status));
    }
    return { ligacao: existente as LigacaoIa, aviso, reaproveitada: true };
  }
  return { ligacao: data as LigacaoIa, aviso, reaproveitada: false };
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

interface LinkAtivo {
  id: string;
  /** `null` = emitido pelo SISTEMA (`emitir_link_agendamento_sistema`, 0053). */
  criado_por: string | null;
}

/**
 * O link de agendamento ATIVO da jornada, se houver. Consulta única, servida
 * pelo índice `uniq_link_ativo (jornada_id, tipo) where estado='ativo'` (0028).
 * É a peça que impede o sistema de revogar, sem avisar, o link que uma pessoa
 * da equipe já mandou ao cliente.
 */
async function linkAgendamentoAtivo(admin: SupabaseClient, jornadaId: string): Promise<LinkAtivo | null> {
  const { data, error } = await admin
    .from("links_publicos")
    .select("id, criado_por, expira_em")
    .eq("jornada_id", jornadaId)
    .eq("tipo", "agendamento")
    .eq("estado", "ativo")
    .maybeSingle<{ id: string; criado_por: string | null; expira_em: string }>();
  if (error || !data) return null;
  if (new Date(data.expira_em).getTime() <= Date.now()) return null;
  return { id: data.id, criado_por: data.criado_por };
}

/** Memória do processo → coluna cifrada da própria ligação. `null` = não temos o token. */
function tokenDoLink(linkId: string, ligacao: LigacaoIa): string | null {
  const emMemoria = tokensPorLink.get(linkId);
  if (emMemoria) return emMemoria;
  if (ligacao.link_id !== linkId) return null;
  const decifrado = decifrarToken(ligacao.token_link_cifrado ?? null, ligacao.id);
  if (decifrado) tokensPorLink.set(linkId, decifrado);
  return decifrado;
}

function urlDoToken(token: string): string {
  return `${APP_URL}/p/a/${token}`;
}

/**
 * Guarda o token do link recém-emitido: memória sempre, coluna cifrada quando a
 * 0073 existe. Falha na persistência NUNCA derruba a ligação — o pior caso é
 * voltar ao comportamento anterior à Fase 7.
 */
async function guardarToken(admin: SupabaseClient, ligacaoId: string, linkId: string, token: string): Promise<void> {
  tokensPorLink.set(linkId, token);
  const cifrado = cifrarToken(token, ligacaoId);
  if (!cifrado) return;
  const { error } = await admin.from("ligacoes_ia").update({ token_link_cifrado: cifrado }).eq("id", ligacaoId);
  if (error && !colunaAusente(error)) {
    registrarErro("ligacao-ia/fila.guardarToken", error, { ligacao_id: ligacaoId });
  }
}

/**
 * Emite um link de agendamento pelo sistema e grava os slots que
 * `gerarSugestoesAgendamento` calcula (o mesmo cálculo do link da equipe).
 * Devolve null SÓ quando não há advogada na sessão (aí não há o que ofertar);
 * sem disponibilidade, devolve o link com `sugestoes: []` — quem chama decide,
 * e o `link_id` fica fixado para não emitir de novo na passagem seguinte.
 *
 * ATENÇÃO: emitir REVOGA o link ativo do mesmo tipo (0053). Só chame depois de
 * `linkAgendamentoAtivo` provar que não há link humano ativo.
 */
async function emitirLinkComSugestoes(
  admin: SupabaseClient,
  ligacao: LigacaoIa,
  criadoPor: string | null,
): Promise<{ linkId: string; url: string; sugestoes: LinhaSugestao[] } | null> {
  const { data: sessao } = await admin
    .from("sessoes_viabilidade")
    .select("advogada_id")
    .eq("jornada_id", ligacao.jornada_id)
    .maybeSingle<{ advogada_id: string | null }>();
  const advogadaId = sessao?.advogada_id ?? null;
  if (!advogadaId) return null;

  const pepper = exigirPepper();
  const token = gerarToken();
  const { data: link, error } = await admin
    .rpc("emitir_link_agendamento_sistema", {
      p_jornada_id: ligacao.jornada_id,
      p_token_hash: hashToken(token, pepper),
      p_token_prefixo: token.slice(0, 6),
    })
    .single<{ id: string }>();
  if (error || !link) throw new Error(`falha_ao_emitir_link_agendamento_sistema: ${error?.message}`);

  await guardarToken(admin, ligacao.id, link.id, token);

  const sugestoes = await gerarSugestoesAgendamento(admin, { jornadaId: ligacao.jornada_id, advogadaId, criadoPor });
  if (sugestoes.itens.length === 0) return { linkId: link.id, url: urlDoToken(token), sugestoes: [] };

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

  return {
    linkId: link.id,
    url: urlDoToken(token),
    sugestoes: sugestoes.itens.slice(0, QUANTIDADE_OFERTADA_A_IA).map((i) => ({ inicio_em: i.inicio_em, fim_em: i.fim_em, posicao: i.posicao })),
  };
}

async function fixarLinkNaLigacao(admin: SupabaseClient, ligacao: LigacaoIa, linkId: string): Promise<void> {
  const { error } = await admin.from("ligacoes_ia").update({ link_id: linkId }).eq("id", ligacao.id);
  if (error) throw error;
  ligacao.link_id = linkId;
}

/**
 * Garante que a ligação tem um link válido com horários. A ordem importa —
 * REUSAR antes de EMITIR (Fase 7 · entrega 3):
 *   1. o `link_id` da própria ligação, se ainda serve e tem horários;
 *   2. o link de agendamento ATIVO da jornada (mesmo emitido por uma pessoa),
 *      adotando-o: a IA oferece os MESMOS horários do link que o cliente já tem
 *      na mão, e nada é revogado;
 *   3. só então emite um novo — e apenas quando o ativo é do sistema ou não
 *      existe. Link humano ativo sem horários vira `null` (→ tarefa rotulada),
 *      nunca revogação silenciosa.
 * Devolve null (e NÃO lança) quando não há horário para oferecer.
 */
export async function prepararOferta(admin: SupabaseClient, ligacao: LigacaoIa): Promise<OfertaHorarios | null> {
  const comLink = async (linkId: string): Promise<OfertaHorarios | null> => {
    const sugestoes = await sugestoesDoLink(admin, linkId);
    if (sugestoes.length === 0) return null;
    const token = tokenDoLink(linkId, ligacao);
    return { link_id: linkId, url: token ? urlDoToken(token) : null, horarios: sugestoes.map(paraHorarioOfertado) };
  };

  if (ligacao.link_id && (await linkAindaServe(admin, ligacao.link_id))) {
    const oferta = await comLink(ligacao.link_id);
    if (oferta) return oferta;
  }

  const ativo = await linkAgendamentoAtivo(admin, ligacao.jornada_id);
  if (ativo && ativo.id !== ligacao.link_id) {
    const oferta = await comLink(ativo.id);
    if (oferta) {
      await fixarLinkNaLigacao(admin, ligacao, ativo.id);
      return { ...oferta, link_id: ativo.id };
    }
  }
  // Link humano ativo e SEM horários: emitir agora o revogaria. Não vale a pena
  // — a equipe reemite pela barra "Enviar" e o motivo vai na tarefa.
  if (ativo && ativo.criado_por !== null) return null;

  const novo = await emitirLinkComSugestoes(admin, ligacao, ligacao.solicitada_por);
  if (!novo) return null;

  await fixarLinkNaLigacao(admin, ligacao, novo.linkId);
  if (novo.sugestoes.length === 0) return null;
  return { link_id: novo.linkId, url: novo.url, horarios: novo.sugestoes.map(paraHorarioOfertado) };
}

export interface LinkParaFallback {
  url: string | null;
  /** Chave de `MOTIVOS_MANUAL` quando não deu para mandar o link. */
  motivo?: keyof typeof MOTIVOS_MANUAL | string;
}

/**
 * URL do link de agendamento para o fallback (e-mail/WhatsApp). Prefere sempre
 * o link que o cliente já poderia ter na mão. NUNCA revoga link emitido por
 * pessoa: sem o token dele, o sistema prefere abrir tarefa para a equipe
 * reenviar a matar o link que já foi mandado (Fase 7 · entrega 3).
 */
export async function urlDoLinkAgendamento(admin: SupabaseClient, ligacao: LigacaoIa): Promise<LinkParaFallback> {
  try {
    if (ligacao.link_id && (await linkAindaServe(admin, ligacao.link_id))) {
      const token = tokenDoLink(ligacao.link_id, ligacao);
      if (token) return { url: urlDoToken(token) };
    }

    const ativo = await linkAgendamentoAtivo(admin, ligacao.jornada_id);
    if (ativo) {
      const token = tokenDoLink(ativo.id, ligacao);
      if (token) return { url: urlDoToken(token) };
      if (ativo.criado_por !== null) return { url: null, motivo: "link_humano_ativo" };
      // Ativo do próprio sistema e sem token recuperável (processo reiniciado
      // antes da 0073): reemitir revoga só o que o sistema mesmo criou.
    }

    const novo = await emitirLinkComSugestoes(admin, ligacao, ligacao.solicitada_por);
    if (!novo) return { url: null, motivo: "sem_horarios" };
    await fixarLinkNaLigacao(admin, ligacao, novo.linkId);
    // Link sem horário nenhum não serve de convite: a página abriria vazia.
    if (novo.sugestoes.length === 0) return { url: null, motivo: "sem_horarios" };
    return { url: novo.url };
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 503) {
      registrarErro("ligacao-ia/fila.urlDoLinkAgendamento#pepper", erro, { ligacao_id: ligacao.id });
      return { url: null, motivo: "sem_link" };
    }
    registrarErro("ligacao-ia/fila.urlDoLinkAgendamento", erro, { ligacao_id: ligacao.id });
    return { url: null, motivo: "sem_link" };
  }
}

/** Só para testes de mesa: esvazia o cache de tokens deste processo. */
export function esquecerTokens(): void {
  tokensPorLink.clear();
}
