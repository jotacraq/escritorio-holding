import type { SupabaseClient } from "@supabase/supabase-js";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { APP_URL } from "@/lib/config-publica";

/**
 * Emite o link público de CONFIRMAÇÃO de presença (`/p/c/[token]`) para um
 * agendamento, NO MOMENTO DO ENVIO da D-7 (G18 — mesmo motivo de
 * `emitirLinkMaterialSistema`: token minerado dias antes queima validade à
 * toa). Irmã de `emitir_link_material_sistema` (0031) — RPC `service_role`
 * `emitir_link_confirmacao_sistema` (0051), que revoga o link de confirmação
 * anterior da jornada e amarra o novo ao agendamento.
 *
 * O token nunca chega ao banco: só o hash com pepper (regra dura 2, Fase 2).
 */
export async function emitirLinkConfirmacaoSistema(supabaseAdmin: SupabaseClient, agendamentoId: string): Promise<string> {
  const pepper = exigirPepper();
  const token = gerarToken();
  const tokenHash = hashToken(token, pepper);
  const tokenPrefixo = token.slice(0, 6);

  const { data, error } = await supabaseAdmin
    .rpc("emitir_link_confirmacao_sistema", {
      p_agendamento_id: agendamentoId,
      p_token_hash: tokenHash,
      p_token_prefixo: tokenPrefixo,
    })
    .single();

  if (error || !data) {
    throw new Error(`falha_ao_emitir_link_confirmacao_sistema: ${error?.message ?? "sem retorno"}`);
  }

  return `${APP_URL}/p/c/${token}`;
}
