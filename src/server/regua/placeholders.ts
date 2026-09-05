import type { SupabaseClient } from "@supabase/supabase-js";
import { emitirLinkMaterialSistema } from "@/server/ia/material";
import { emitirLinkConfirmacaoSistema } from "./links";
import { placeholdersRestantes } from "./render";

/**
 * Placeholders que `app.enfileirar_mensagem` (0013/0051) NÃO sabe substituir —
 * ela só conhece `{{nome}}`/`{{data_sessao}}` e, desde a 0051, `{{link_sala}}`
 * APENAS quando o link já existe no enfileiramento. Tudo abaixo é resolvido
 * NO ENVIO (cron) ou NO PREPARO (fila manual de WhatsApp, `POST
 * /api/mensagens/[id]/preparar`) — nunca no enfileiramento, porque:
 *   - link de material/confirmação são tokens que só devem nascer na hora (G18);
 *   - link da sala é colado à mão dias depois (B10) ou chega pelo n8n (§1.3).
 * Este módulo é o ÚNICO ponto do sistema que resolve esses três.
 */
export const PLACEHOLDER_LINK_MATERIAL = "{{link_material}}";
export const PLACEHOLDER_LINK_SALA = "{{link_sala}}";
export const PLACEHOLDER_LINK_CONFIRMACAO = "{{link_confirmacao}}";

export type MotivoHoldPlaceholder = "sessao_sem_sala" | "agendamento_indisponivel" | "material_nao_aprovado";

export interface MensagemParaResolver {
  id: string;
  jornada_id: string;
  agendamento_id: string | null;
  corpo_renderizado: string | null;
}

export type ResultadoResolucao =
  | { ok: true; corpo: string }
  /** Dado que o placeholder precisa ainda não existe — a mensagem NÃO pode sair. */
  | { ok: false; hold: MotivoHoldPlaceholder; mensagem: string };

async function lerLinkSala(supabaseAdmin: SupabaseClient, mensagem: MensagemParaResolver): Promise<string | null> {
  if (mensagem.agendamento_id) {
    const { data } = await supabaseAdmin
      .from("agendamentos")
      .select("sessoes_viabilidade(link_sala)")
      .eq("id", mensagem.agendamento_id)
      .maybeSingle<{ sessoes_viabilidade: { link_sala: string | null } | { link_sala: string | null }[] | null }>();
    const sessao = Array.isArray(data?.sessoes_viabilidade) ? data?.sessoes_viabilidade[0] : data?.sessoes_viabilidade;
    if (sessao?.link_sala) return sessao.link_sala;
  }
  const { data } = await supabaseAdmin
    .from("sessoes_viabilidade")
    .select("link_sala")
    .eq("jornada_id", mensagem.jornada_id)
    .maybeSingle<{ link_sala: string | null }>();
  return data?.link_sala ?? null;
}

/**
 * Resolve os placeholders de envio. Lança só em erro de infraestrutura (pepper
 * ausente, RPC quebrada) — o chamador trata como falha normal de envio com
 * backoff. Dado ausente (sala sem link, agendamento remarcado) NÃO é erro:
 * volta `hold`, e a mensagem continua pendente sem consumir tentativa.
 */
export async function resolverPlaceholdersDeEnvio(
  supabaseAdmin: SupabaseClient,
  mensagem: MensagemParaResolver,
): Promise<ResultadoResolucao> {
  let corpo = mensagem.corpo_renderizado ?? "";

  if (corpo.includes(PLACEHOLDER_LINK_SALA)) {
    const linkSala = await lerLinkSala(supabaseAdmin, mensagem);
    if (!linkSala) {
      return {
        ok: false,
        hold: "sessao_sem_sala",
        mensagem: "Sala não integrada: cole o link da reunião na Ficha → Sessão antes de enviar.",
      };
    }
    corpo = corpo.split(PLACEHOLDER_LINK_SALA).join(linkSala);
  }

  if (corpo.includes(PLACEHOLDER_LINK_CONFIRMACAO)) {
    if (!mensagem.agendamento_id) {
      return { ok: false, hold: "agendamento_indisponivel", mensagem: "Mensagem sem agendamento — não há o que confirmar." };
    }
    const url = await emitirLinkConfirmacaoSistema(supabaseAdmin, mensagem.agendamento_id);
    corpo = corpo.split(PLACEHOLDER_LINK_CONFIRMACAO).join(url);
  }

  if (corpo.includes(PLACEHOLDER_LINK_MATERIAL)) {
    const url = await emitirLinkMaterialSistema(supabaseAdmin, mensagem.jornada_id);
    corpo = corpo.split(PLACEHOLDER_LINK_MATERIAL).join(url);
  }

  return { ok: true, corpo };
}

/** Sobrou placeholder desconhecido? Nunca deixamos texto `{{x}}` chegar ao cliente. */
export function temPlaceholderSobrando(corpo: string): boolean {
  return placeholdersRestantes(corpo).length > 0;
}
