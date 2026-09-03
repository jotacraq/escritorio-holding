import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarEmail, resendConfigurado } from "./email";

const MAX_TENTATIVAS = 5;
const LIMITE_LOTE = 50;

interface MensagemAgendada {
  id: string;
  destinatario: string;
  assunto_renderizado: string | null;
  corpo_renderizado: string | null;
  tentativas: number;
}

export interface ResultadoProcessamento {
  processadas: number;
  enviadas: number;
  falhas: number;
}

/**
 * Worker chamado por POST /api/cron/regua. Reivindica o lote (FOR UPDATE SKIP
 * LOCKED via RPC, §5.2), envia por Resend e atualiza status. WhatsApp nunca
 * entra aqui — a claim (`reivindicar_mensagens_pendentes`) já filtra
 * `canal = 'email'` no banco; fila de WhatsApp é sempre manual.
 */
export async function processarFilaRegua(supabaseAdmin: SupabaseClient): Promise<ResultadoProcessamento> {
  const { data: lote, error } = await supabaseAdmin.rpc("reivindicar_mensagens_pendentes", {
    p_limite: LIMITE_LOTE,
  });

  if (error) {
    throw new Error(`falha_ao_reivindicar_fila: ${error.message}`);
  }

  const mensagens = (lote ?? []) as MensagemAgendada[];
  if (mensagens.length === 0) {
    return { processadas: 0, enviadas: 0, falhas: 0 };
  }

  if (!resendConfigurado()) {
    // Sem credencial de e-mail: a mensagem NUNCA vira "enviada". Marca falhou e
    // deixa visível na tela de pendências — nunca some em silêncio.
    await supabaseAdmin
      .from("mensagens_agendadas")
      .update({ status: "falhou", erro: "remetente nao configurado" })
      .in(
        "id",
        mensagens.map((m) => m.id),
      );
    return { processadas: mensagens.length, enviadas: 0, falhas: mensagens.length };
  }

  let enviadas = 0;
  let falhas = 0;

  for (const mensagem of mensagens) {
    const resultado = await enviarEmail({
      destinatario: mensagem.destinatario,
      assunto: mensagem.assunto_renderizado ?? "SIC-HF",
      corpoTexto: mensagem.corpo_renderizado ?? "",
    });

    if (resultado.sucesso) {
      enviadas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({
          status: "enviada",
          enviada_em: new Date().toISOString(),
          provedor_id: resultado.provedorId,
          erro: null,
        })
        .eq("id", mensagem.id);
    } else {
      falhas += 1;
      const esgotouTentativas = mensagem.tentativas >= MAX_TENTATIVAS;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({
          status: esgotouTentativas ? "falhou" : "pendente",
          erro: resultado.erro,
          proxima_tentativa_em: esgotouTentativas
            ? null
            : new Date(Date.now() + 2 ** mensagem.tentativas * 60_000).toISOString(),
        })
        .eq("id", mensagem.id);
    }
  }

  return { processadas: mensagens.length, enviadas, falhas };
}
