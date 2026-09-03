import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarEmail, resendConfigurado } from "./email";
import { emitirLinkMaterialSistema } from "@/server/ia/material";

const MAX_TENTATIVAS = 5;
const LIMITE_LOTE = 50;

/**
 * Placeholder que `app.enfileirar_mensagem` (0013) NÃO sabe substituir — aquela
 * função só conhece `{{nome}}`/`{{data_sessao}}`/`{{link_sala}}`. O template
 * `pos_sessao` v2 (0031) usa `{{link_material}}` de propósito: G18 exige que o
 * token do material seja gerado NO MOMENTO DO ENVIO, não no enfileiramento — um
 * token minerado dias antes, quando a sessão termina, e só usado quando a régua
 * finalmente envia, já teria consumido parte da validade à toa. Este módulo é o
 * único ponto do sistema que resolve esse placeholder.
 */
const PLACEHOLDER_LINK_MATERIAL = "{{link_material}}";

interface MensagemAgendada {
  id: string;
  jornada_id: string;
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
    let corpo = mensagem.corpo_renderizado ?? "";

    // Mensagem com o link do material (template `pos_sessao` v2, 0031): o
    // token só é minerado AGORA, no envio de verdade — nunca no enfileiramento
    // (G18). `reivindicar_mensagens_pendentes` (0031) já garante que só
    // reivindica esta mensagem quando existe material ATUAL e APROVADO para a
    // jornada (BLOQUEIO B14) — se ainda assim a emissão falhar (corrida rara,
    // ou pepper ausente), trata como falha normal de envio: a mensagem
    // continua tentando, nunca manda o placeholder literal para o cliente.
    if (corpo.includes(PLACEHOLDER_LINK_MATERIAL)) {
      try {
        const urlMaterial = await emitirLinkMaterialSistema(supabaseAdmin, mensagem.jornada_id);
        corpo = corpo.split(PLACEHOLDER_LINK_MATERIAL).join(urlMaterial);
      } catch (erroLink) {
        falhas += 1;
        const esgotouTentativas = mensagem.tentativas >= MAX_TENTATIVAS;
        await supabaseAdmin
          .from("mensagens_agendadas")
          .update({
            status: esgotouTentativas ? "falhou" : "pendente",
            erro: erroLink instanceof Error ? erroLink.message : String(erroLink),
            proxima_tentativa_em: esgotouTentativas
              ? null
              : new Date(Date.now() + 2 ** mensagem.tentativas * 60_000).toISOString(),
          })
          .eq("id", mensagem.id);
        continue;
      }
    }

    const resultado = await enviarEmail({
      destinatario: mensagem.destinatario,
      assunto: mensagem.assunto_renderizado ?? "SIC-HF",
      corpoTexto: corpo,
    });

    if (resultado.sucesso) {
      enviadas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({
          status: "enviada",
          enviada_em: new Date().toISOString(),
          provedor_id: resultado.provedorId,
          // Congela o que foi REALMENTE mandado — inclusive o link real do
          // material, nunca o placeholder (coerente com o comentário da
          // própria coluna em 0013: "prova do que foi mandado").
          corpo_renderizado: corpo,
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
