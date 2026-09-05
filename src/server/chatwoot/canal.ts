import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAVE_CANAL_WHATSAPP, lerConfiguracaoTexto } from "@/server/integracoes/config";
import { chatwootConfigurado, enviarWhatsapp } from "./cliente";

/**
 * Canal de SAÍDA do WhatsApp da régua (§2.5). Contrato para `processar.ts`
 * do agente A: reivindicar `'whatsapp'` só quando `canalWhatsappViaChatwoot()`
 * for true; caso contrário a fila manual continua idêntica.
 *
 *   const canais = (await canalWhatsappViaChatwoot(admin)) ? ['email','whatsapp'] : ['email'];
 *   ... para cada mensagem canal='whatsapp': await enviarWhatsappDaFila(admin, mensagem)
 */
export async function canalWhatsappViaChatwoot(admin: SupabaseClient): Promise<boolean> {
  const canal = await lerConfiguracaoTexto(admin, CHAVE_CANAL_WHATSAPP, "manual");
  return canal === "chatwoot" && chatwootConfigurado();
}

export interface MensagemDaFilaWhatsapp {
  id: string;
  destinatario: string;
  corpo_renderizado: string | null;
  tentativas: number;
}

const MAX_TENTATIVAS = 5;

/**
 * Envia UMA mensagem já reivindicada pela régua via Chatwoot e grava o
 * resultado em `mensagens_agendadas` (provedor 'chatwoot', conversa_externa_id,
 * provedor_id) — mesmo backoff do e-mail; nunca some, nunca vira "enviada" sem
 * o provedor confirmar.
 */
export async function enviarWhatsappDaFila(
  admin: SupabaseClient,
  mensagem: MensagemDaFilaWhatsapp,
  opcoes: { nome?: string | null; corpo?: string } = {},
): Promise<{ sucesso: boolean; erro: string | null }> {
  const corpo = opcoes.corpo ?? mensagem.corpo_renderizado ?? "";
  const resultado = await enviarWhatsapp({ telefone: mensagem.destinatario, texto: corpo, nome: opcoes.nome ?? null });

  if (resultado.sucesso) {
    await admin
      .from("mensagens_agendadas")
      .update({
        status: "enviada",
        enviada_em: new Date().toISOString(),
        provedor: "chatwoot",
        provedor_id: resultado.provedorId,
        conversa_externa_id: resultado.conversaId,
        corpo_renderizado: corpo,
        erro: null,
      })
      .eq("id", mensagem.id);
    return { sucesso: true, erro: null };
  }

  const esgotou = mensagem.tentativas >= MAX_TENTATIVAS;
  await admin
    .from("mensagens_agendadas")
    .update({
      status: esgotou ? "falhou" : "pendente",
      provedor: "chatwoot",
      erro: resultado.erro,
      proxima_tentativa_em: esgotou ? null : new Date(Date.now() + 2 ** mensagem.tentativas * 60_000).toISOString(),
    })
    .eq("id", mensagem.id);
  return { sucesso: false, erro: resultado.erro };
}
