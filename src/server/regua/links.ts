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
export interface LinhaLinkConfirmacao {
  id: string;
  tipo: "confirmacao";
  estado: "ativo" | "usado" | "expirado" | "revogado";
  token_prefixo: string;
  expira_em: string;
  usos: number;
  criado_em: string;
  revogado_em: string | null;
}

export interface LinkConfirmacaoEmitido {
  /** Com o token em claro. Existe UMA vez: o banco guarda só o hash (0028:70-73). */
  url: string;
  /** A linha de `links_publicos` recém-criada — o que a rota devolve como resumo. */
  linha: LinhaLinkConfirmacao;
}

/**
 * A RPC devolve a linha inteira de `links_publicos` (0051:494 `returns
 * links_publicos`). Devolver o token E a linha permite que a rota da equipe
 * (Fase 6 §5.3) responda no MESMO formato de `emitir_link_publico`, sem uma
 * segunda consulta só para reler o que acabou de ser escrito.
 */
export async function emitirLinkConfirmacaoSistema(
  supabaseAdmin: SupabaseClient,
  agendamentoId: string,
): Promise<LinkConfirmacaoEmitido> {
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
    .single<LinhaLinkConfirmacao>();

  if (error || !data) {
    // A mensagem do Postgres pode nomear o agendamento; o TOKEN nunca entra
    // aqui — ele não existe fora do `return` desta função.
    const erro = new Error(`falha_ao_emitir_link_confirmacao_sistema: ${error?.message ?? "sem retorno"}`);
    if (error?.code) (erro as Error & { code?: string }).code = error.code;
    throw erro;
  }

  return { url: `${APP_URL}/p/c/${token}`, linha: data };
}
