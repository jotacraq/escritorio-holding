import type { SupabaseClient } from "@supabase/supabase-js";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { emitirLinkConfirmacaoSistema } from "@/server/regua/links";
import { APP_URL } from "@/lib/config-publica";
import type { TipoLinkAgente } from "./passo";
import type { EstadoAgente } from "./porteiro";

/**
 * Emissão de link PELO AGENTE.
 *
 * C5/D15 — a regra que muda o desenho da conversa: o banco guarda só o HASH do
 * token, então "reenvia o link que já mandei" é fisicamente impossível. Toda
 * emissão nova REVOGA a anterior do mesmo tipo. Logo o cliente que pede o link
 * duas vezes derrubaria o dele mesmo — e derrubaria o que a equipe mandou por
 * e-mail. Daí o teto de 1 emissão por tipo a cada `intervalo_link_horas`.
 *
 * `criado_por = NULL` (B64/D28): autor é o SISTEMA. Criar um perfil-robô em
 * `perfis_equipe` o faria aparecer em Equipe, em responsável de tarefa e em
 * toda tela de gente.
 */

const CAMINHO_POR_TIPO: Record<TipoLinkAgente, string> = {
  formulario: "/p/f",
  documentos: "/p/d",
  confirmacao: "/p/c",
};

export type ResultadoLink =
  | { situacao: "emitido"; url: string; tipo: TipoLinkAgente }
  /** Já saiu um link deste tipo dentro da janela — apontar para trás, não emitir. */
  | { situacao: "recente"; tipo: TipoLinkAgente }
  /** Não deu para emitir (RPC ausente, jornada fechada, sem agendamento). */
  | { situacao: "indisponivel"; tipo: TipoLinkAgente; erro: string };

/**
 * Função pura: o link deste tipo saiu há menos de `horas`?
 *
 * DÉBITO CONHECIDO (achado INFO do pentest da Fase 9, não corrigido aqui de
 * propósito): a leitura acontece com o `estado` carregado pelo porteiro e a
 * gravação só depois do envio. Duas mensagens quase simultâneas do MESMO
 * cliente (ids diferentes, então a claim não barra) podem ler o mesmo estado e
 * as duas decidirem emitir. O pior caso é "emitiu duas vezes mais rápido que o
 * teto pretendia" — nunca dois links vivos, porque `emitir_link_sistema`
 * revoga o anterior na MESMA transação, e nunca exposição de dado.
 *
 * Não é conserto de uma linha: o estado pode NÃO EXISTIR na primeira emissão,
 * então não há `update ... where` que sirva — precisaria de uma RPC nova que
 * faça `insert ... on conflict do update ... where` e devolva se ganhou a
 * corrida, dentro da mesma transação do `emitir_link_sistema`. Fica anotado
 * para a próxima migration; mexer nisso agora abriria a superfície de banco
 * que esta fase acabou de fechar e provar.
 */
export function linkRecente(estado: EstadoAgente | null, tipo: TipoLinkAgente, horas: number, agora: number): boolean {
  const quando = estado?.ultimo_link_em?.[tipo];
  if (!quando) return false;
  const t = Date.parse(quando);
  return !Number.isNaN(t) && agora - t < horas * 3_600_000;
}

/**
 * Emite o link do tipo pedido, respeitando o teto.
 *
 * `formulario`/`documentos` passam pela RPC NOVA `emitir_link_sistema` (0089) —
 * nome novo, nunca sobrecarga de `emitir_link_publico`, que exige `auth.uid()`
 * e por isso é inalcançável para o agente.
 * `confirmacao` reusa `emitir_link_confirmacao_sistema` (0051/0074), que já
 * existe e já amarra o link ao agendamento.
 */
export async function emitirLinkDoAgente(
  admin: SupabaseClient,
  params: {
    jornadaId: string;
    tipo: TipoLinkAgente;
    estado: EstadoAgente | null;
    intervaloLinkHoras: number;
    agora?: number;
  },
): Promise<ResultadoLink> {
  const agora = params.agora ?? Date.now();
  if (linkRecente(params.estado, params.tipo, params.intervaloLinkHoras, agora)) {
    return { situacao: "recente", tipo: params.tipo };
  }

  try {
    if (params.tipo === "confirmacao") {
      const agendamentoId = await proximoAgendamento(admin, params.jornadaId);
      if (!agendamentoId) {
        return { situacao: "indisponivel", tipo: params.tipo, erro: "sem_agendamento_ativo" };
      }
      const { url } = await emitirLinkConfirmacaoSistema(admin, agendamentoId);
      return { situacao: "emitido", url, tipo: params.tipo };
    }

    const pepper = exigirPepper();
    const token = gerarToken();
    const { data, error } = await admin
      .rpc("emitir_link_sistema", {
        p_jornada_id: params.jornadaId,
        p_tipo: params.tipo,
        p_token_hash: hashToken(token, pepper),
        p_token_prefixo: token.slice(0, 6),
      })
      .single();
    if (error || !data) {
      return { situacao: "indisponivel", tipo: params.tipo, erro: error?.code ?? "sem_retorno" };
    }
    return { situacao: "emitido", url: `${APP_URL}${CAMINHO_POR_TIPO[params.tipo]}/${token}`, tipo: params.tipo };
  } catch (erro) {
    return { situacao: "indisponivel", tipo: params.tipo, erro: erro instanceof Error ? erro.message.slice(0, 120) : "erro" };
  }
}

async function proximoAgendamento(admin: SupabaseClient, jornadaId: string): Promise<string | null> {
  const { data } = await admin
    .from("agendamentos")
    .select("id, inicio_em, sessoes_viabilidade!inner(jornada_id)")
    .eq("sessoes_viabilidade.jornada_id", jornadaId)
    .in("status", ["agendado", "confirmado"])
    .gt("inicio_em", new Date().toISOString())
    .order("inicio_em", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
