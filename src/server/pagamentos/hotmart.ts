import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";

/**
 * Miolo do webhook Hotmart, extraído de `POST /api/webhooks/hotmart` (§1.5)
 * para ser o MESMO código em três portas:
 *   1) primeira entrega do evento (rota do webhook);
 *   2) reentrega da Hotmart de evento com `processado_em is null` (rota);
 *   3) botão Admin → Pendências → "Reprocessar" (`POST /api/admin/webhooks/[id]/reprocessar`).
 * Lê o bruto já persistido em `webhooks_eventos` — nunca reprocessa a partir
 * do corpo da requisição, para que o clique do admin e a reentrega vejam
 * exatamente o mesmo payload que foi assinado.
 */

export type StatusPagamento = "pendente" | "em_analise" | "aprovado" | "cancelado" | "estornado" | "reembolsado";

/**
 * Mapeamento best-effort do status de compra da Hotmart. Os valores exatos
 * dependem da versão/contrato do webhook contratado — BLOQUEIO B7 do plano.
 * Nunca assume "aprovado" por default: status desconhecido cai em 'em_analise'.
 */
export function mapearStatusHotmart(statusBruto: string | undefined): StatusPagamento {
  const status = (statusBruto ?? "").toUpperCase();
  if (status === "APPROVED" || status === "COMPLETE" || status === "COMPLETED") return "aprovado";
  if (status === "CANCELLED" || status === "CANCELED" || status === "EXPIRED") return "cancelado";
  if (status === "REFUNDED") return "reembolsado";
  if (status === "CHARGEBACK" || status === "DISPUTE") return "estornado";
  if (status === "BILLET_PRINTED" || status === "STARTED" || status === "PRE_ORDER" || status === "PROCESSING_TRANSACTION") {
    return "pendente";
  }
  return "em_analise";
}

export interface PayloadHotmart {
  id?: string;
  event?: string;
  data?: {
    purchase?: {
      transaction?: string;
      status?: string;
      price?: { value?: number; currency_value?: string };
      payment?: { installments_number?: number };
      approved_date?: number;
      order_date?: number;
    };
    product?: { id?: number | string };
    buyer?: { email?: string; name?: string; checkout_phone?: string };
  };
}

export type ResultadoProcessamentoHotmart =
  | { tipo: "assinatura_invalida" }
  | { tipo: "ja_processado"; processado_em: string }
  | { tipo: "sem_compra" }
  | { tipo: "produto_nao_mapeado" }
  /** Dinheiro sem registro — crítico: quem chama responde 500 para a Hotmart reentregar. */
  | { tipo: "pagamento_nao_registrado"; observacao: string }
  | { tipo: "processado"; pagamento_id: string; jornada_id: string | null; observacao: string | null };

interface LinhaWebhookEvento {
  id: string;
  origem: string;
  evento_externo_id: string;
  assinatura_valida: boolean;
  bruto: PayloadHotmart;
  processado_em: string | null;
}

/**
 * Processa (ou reprocessa) um evento já persistido. Idempotente no banco:
 * `processar_pagamento_hotmart` faz `on conflict (origem, transacao_externa_id)
 * do update` (0011:456). Regras:
 *   - `assinatura_valida=false` NUNCA processa (pentest Onda 4);
 *   - `processado_em` preenchido → devolve `ja_processado` sem tocar em nada
 *     (a menos que `forcar=true`, o caminho do botão de admin, que já zerou via
 *     `reprocessar_webhook`);
 *   - erro real → lança (o chamador registra e responde 500) depois de gravar
 *     `erro` na linha.
 */
export async function processarEventoHotmart(
  supabaseAdmin: SupabaseClient,
  webhookEventoId: string,
  opcoes: { forcar?: boolean } = {},
): Promise<ResultadoProcessamentoHotmart> {
  const { data: evento, error: erroLeitura } = await supabaseAdmin
    .from("webhooks_eventos")
    .select("id, origem, evento_externo_id, assinatura_valida, bruto, processado_em")
    .eq("id", webhookEventoId)
    .maybeSingle<LinhaWebhookEvento>();

  if (erroLeitura) throw new Error(`falha_ao_ler_webhook_evento: ${erroLeitura.message}`);
  if (!evento) throw new Error(`webhook_evento_nao_encontrado: ${webhookEventoId}`);
  if (evento.origem !== "hotmart") throw new Error(`origem_sem_processador: ${evento.origem}`);

  if (!evento.assinatura_valida) return { tipo: "assinatura_invalida" };
  if (evento.processado_em && !opcoes.forcar) return { tipo: "ja_processado", processado_em: evento.processado_em };

  const payload = evento.bruto ?? {};
  const purchase = payload.data?.purchase;
  const produto = payload.data?.product;
  const buyer = payload.data?.buyer;
  const agora = new Date().toISOString();

  if (!purchase) {
    // Evento sem dados de compra (ex.: outro tipo de notificação): registrado, nada a processar.
    await supabaseAdmin.from("webhooks_eventos").update({ processado_em: agora, erro: null }).eq("id", evento.id);
    return { tipo: "sem_compra" };
  }

  const statusPagamento = mapearStatusHotmart(purchase.status);
  const pagoEm = purchase.approved_date
    ? new Date(purchase.approved_date).toISOString()
    : purchase.order_date
      ? new Date(purchase.order_date).toISOString()
      : null;

  try {
    const { data: resultado, error: erroProcessamento } = await supabaseAdmin
      .rpc("processar_pagamento_hotmart", {
        p_hotmart_produto_id: produto?.id != null ? String(produto.id) : null,
        p_transacao_externa_id: purchase.transaction ?? evento.evento_externo_id,
        p_status: statusPagamento,
        p_valor: purchase.price?.value ?? null,
        p_moeda: purchase.price?.currency_value ?? "BRL",
        p_parcelas: purchase.payment?.installments_number ?? null,
        p_comprador_email: buyer?.email ?? null,
        p_comprador_nome: buyer?.name ?? null,
        p_comprador_telefone: buyer?.checkout_phone ?? null,
        p_pago_em: pagoEm,
        p_bruto: payload,
      })
      .single<{
        pagamento_id: string | null;
        jornada_id: string | null;
        produto_mapeado: boolean;
        etapa_avancada: boolean;
        observacao: string | null;
      }>();

    if (erroProcessamento) throw new Error(erroProcessamento.message);

    if (!resultado?.produto_mapeado) {
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ erro: "produto_nao_mapeado", processado_em: agora })
        .eq("id", evento.id);
      return { tipo: "produto_nao_mapeado" };
    }

    if (!resultado.pagamento_id) {
      const observacao = resultado.observacao ?? "pagamento_nao_registrado";
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ erro: observacao, processado_em: null })
        .eq("id", evento.id);
      registrarErro("server/pagamentos/hotmart#pagamento_nao_registrado", new Error(observacao), { webhook_evento_id: evento.id });
      return { tipo: "pagamento_nao_registrado", observacao };
    }

    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ erro: resultado.observacao, processado_em: agora })
      .eq("id", evento.id);

    return { tipo: "processado", pagamento_id: resultado.pagamento_id, jornada_id: resultado.jornada_id, observacao: resultado.observacao };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await supabaseAdmin.from("webhooks_eventos").update({ erro: mensagem, processado_em: null }).eq("id", evento.id);
    throw erro;
  }
}
