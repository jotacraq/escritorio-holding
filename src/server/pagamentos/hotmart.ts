import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { estadoDaCompraHotmart, type StatusPagamento } from "./eventos";
import {
  eventoExternoIdDoPayload,
  instanteDoEvento,
  produtoIdDoPayload,
  transacaoDoPayload,
  type PayloadHotmart,
} from "./roteador";

/**
 * Miolo do webhook Hotmart, extraído de `POST /api/webhooks/hotmart` (§1.5)
 * para ser o MESMO código em três portas:
 *   1) primeira entrega do evento (rota do webhook);
 *   2) reentrega da Hotmart de evento com `processado_em is null` (rota);
 *   3) botão Admin → Pendências → "Reprocessar" / "Mapear para…".
 * Lê o bruto já persistido em `webhooks_eventos` — nunca reprocessa a partir
 * do corpo da requisição, para que o clique do admin e a reentrega vejam
 * exatamente o mesmo payload que foi assinado.
 *
 * FASE 8 — o que mudou aqui:
 *   · o estado vem do EVENTO (`./eventos.ts`), não de `purchase.status` (D1);
 *   · `produto_nao_mapeado` deixa `processado_em` NULL (D8): dinheiro sem
 *     destino FICA na fila de pendências em vez de sumir carimbado;
 *   · evento desconhecido também deixa `processado_em` NULL (D3);
 *   · a mesma transação com outro produto é recusada e registrada (D10/B54).
 */

export type { PayloadHotmart } from "./roteador";
export type { StatusPagamento } from "./eventos";
export {
  MAPA_EVENTO_HOTMART,
  estadoDaCompraHotmart,
  mapearStatusHotmart,
  normalizarEventoHotmart,
  statusDoEventoHotmart,
} from "./eventos";

export type ResultadoProcessamentoHotmart =
  | { tipo: "assinatura_invalida" }
  | { tipo: "ja_processado"; processado_em: string }
  | { tipo: "sem_compra" }
  | { tipo: "produto_nao_mapeado"; hotmart_produto_id: string | null }
  /** D10/B54 — a transação já existe com OUTRO produto. Nunca sobrescreve. */
  | { tipo: "produto_divergente"; observacao: string }
  /** Dinheiro sem registro — crítico: quem chama responde 500 para a Hotmart reentregar. */
  | { tipo: "pagamento_nao_registrado"; observacao: string }
  | {
      tipo: "processado";
      pagamento_id: string;
      jornada_id: string | null;
      status: StatusPagamento;
      evento: string | null;
      /** `false` quando o `event` do payload não está no mapa (D3): não aprova e fica na fila. */
      evento_conhecido: boolean;
      observacao: string | null;
    };

interface LinhaWebhookEvento {
  id: string;
  origem: string;
  evento_externo_id: string;
  assinatura_valida: boolean;
  bruto: PayloadHotmart;
  processado_em: string | null;
}

interface RetornoRpc {
  pagamento_id: string | null;
  jornada_id: string | null;
  produto_mapeado: boolean;
  etapa_avancada: boolean;
  observacao: string | null;
}

/**
 * Processa (ou reprocessa) um evento já persistido. Idempotente no banco em
 * DOIS níveis desde a 0084: por `(origem, transacao_externa_id)` em
 * `pagamentos` e por id de EVENTO em `pagamentos_transicoes`. Regras:
 *   - `assinatura_valida=false` NUNCA processa (pentest Onda 4);
 *   - `processado_em` preenchido → devolve `ja_processado` sem tocar em nada
 *     (a menos que `forcar=true`, o caminho dos botões de admin, que já zeraram
 *     via `reprocessar_webhook`);
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
  const buyer = payload.data?.buyer;
  const agora = new Date().toISOString();

  if (!purchase) {
    // Evento sem dados de compra (assinatura, Club, carrinho abandonado):
    // registrado, nada a processar. NÃO é erro.
    await supabaseAdmin.from("webhooks_eventos").update({ processado_em: agora, erro: null }).eq("id", evento.id);
    return { tipo: "sem_compra" };
  }

  // D1 — o estado vem do EVENTO. `purchase.status` só é lido quando o payload
  // não traz `event` (linha antiga reprocessada, seed, registro manual).
  const estado = estadoDaCompraHotmart(payload.event, purchase.status);
  const hotmartProdutoId = produtoIdDoPayload(payload);

  // `pago_em` só existe quando o dinheiro entrou. Boleto emitido não tem data
  // de pagamento — inventá-la é o padrão P1 do vault virando dado na tela.
  const pagoEm =
    estado.status === "aprovado"
      ? (purchase.approved_date ? new Date(purchase.approved_date).toISOString() : instanteDoEvento(payload))
      : null;

  try {
    const { data: resultado, error: erroProcessamento } = await supabaseAdmin
      .rpc("processar_pagamento_hotmart", {
        p_hotmart_produto_id: hotmartProdutoId,
        p_transacao_externa_id: transacaoDoPayload(payload) ?? eventoExternoIdDoPayload(payload) ?? evento.evento_externo_id,
        p_status: estado.status,
        p_valor: purchase.price?.value ?? null,
        p_moeda: purchase.price?.currency_value ?? "BRL",
        p_parcelas: purchase.payment?.installments_number ?? null,
        p_comprador_email: buyer?.email ?? null,
        p_comprador_nome: buyer?.name ?? null,
        p_comprador_telefone: buyer?.checkout_phone ?? null,
        p_pago_em: pagoEm,
        p_bruto: payload,
      })
      .single<RetornoRpc>();

    if (erroProcessamento) throw new Error(erroProcessamento.message);

    const observacao = resultado?.observacao ?? null;

    // D10/B54 — order bump / assinatura mandando a MESMA transação com outro
    // produto. 200 para a Hotmart (reentregar não conserta), `processado_em`
    // NULL para ficar na fila de pendências com o erro por extenso.
    if (observacao?.includes("transacao_com_produto_divergente")) {
      await supabaseAdmin.from("webhooks_eventos").update({ erro: observacao, processado_em: null }).eq("id", evento.id);
      registrarErro("server/pagamentos/hotmart#produto_divergente", new Error(observacao), { webhook_evento_id: evento.id });
      return { tipo: "produto_divergente", observacao };
    }

    // D8 — `processado_em` fica NULL. Antes da Fase 8 esta linha carimbava
    // `processado_em = agora` e a pendência sumia do índice: dinheiro sem
    // destino virava silêncio.
    if (!resultado?.produto_mapeado) {
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ erro: "produto_nao_mapeado", processado_em: null })
        .eq("id", evento.id);
      return { tipo: "produto_nao_mapeado", hotmart_produto_id: hotmartProdutoId };
    }

    if (!resultado.pagamento_id) {
      const detalhe = observacao ?? "pagamento_nao_registrado";
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ erro: detalhe, processado_em: null })
        .eq("id", evento.id);
      registrarErro("server/pagamentos/hotmart#pagamento_nao_registrado", new Error(detalhe), { webhook_evento_id: evento.id });
      return { tipo: "pagamento_nao_registrado", observacao: detalhe };
    }

    // D3 — evento fora do mapa: a compra foi registrada em `em_analise` (nunca
    // aprovada) e o evento CONTINUA na fila, com o nome por extenso, para um
    // humano decidir se o mapa cresce.
    const eventoDesconhecido = estado.evento !== null && !estado.conhecido;
    await supabaseAdmin
      .from("webhooks_eventos")
      .update({
        erro: eventoDesconhecido ? `evento_desconhecido: ${estado.evento}` : observacao,
        processado_em: eventoDesconhecido ? null : agora,
      })
      .eq("id", evento.id);

    return {
      tipo: "processado",
      pagamento_id: resultado.pagamento_id,
      jornada_id: resultado.jornada_id,
      status: estado.status,
      evento: estado.evento,
      evento_conhecido: !eventoDesconhecido,
      observacao,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await supabaseAdmin.from("webhooks_eventos").update({ erro: mensagem, processado_em: null }).eq("id", evento.id);
    throw erro;
  }
}
