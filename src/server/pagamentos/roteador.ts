/**
 * Roteamento por produto: UM endpoint, três produtos (C3/D2).
 *
 * O João configura TRÊS produtos na Hotmart (Sessão de Viabilidade, Croqui
 * Estrutural, Holding) apontando para a MESMA URL de webhook. Quem separa é o
 * `data.product.id` do payload, conferido contra `produtos.hotmart_produto_id`
 * — e a conferência acontece no banco, dentro de `processar_pagamento_hotmart`,
 * na mesma transação que grava o dinheiro.
 *
 * POR QUE NÃO TRÊS URLs (a ordem literal dizia "três webhooks"):
 *   · três URLs = três hottoks, três rate limits, três caminhos de idempotência;
 *   · e AINDA assim seria preciso validar o `product.id`, senão um evento do
 *     produto A postado na URL do produto B seria aceito. É exatamente a
 *     armadilha `guard({portal:"HM"}) + ?produto=AURUM` que o vault do João
 *     documenta em 11 handlers do sistema-disparos;
 *   · com uma URL, a verdade é o banco: produto novo = 1 UPDATE em
 *     Admin → Produtos, sem deploy.
 * Do lado da Hotmart a configuração dele continua sendo três produtos.
 */

export interface PayloadHotmart {
  /** Id do EVENTO (não da transação). Base da idempotência. */
  id?: string;
  event?: string;
  version?: string;
  /** Epoch em milissegundos. */
  creation_date?: number | string;
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

/** `data.product.id` como texto, ou `null`. Número e string dão o mesmo resultado. */
export function produtoIdDoPayload(payload: PayloadHotmart | null | undefined): string | null {
  const bruto = payload?.data?.product?.id;
  if (bruto === null || bruto === undefined) return null;
  const texto = String(bruto).trim();
  return texto === "" ? null : texto;
}

/** Id da COMPRA (`data.purchase.transaction`). É a chave única em `pagamentos`. */
export function transacaoDoPayload(payload: PayloadHotmart | null | undefined): string | null {
  const bruto = payload?.data?.purchase?.transaction;
  if (bruto === null || bruto === undefined) return null;
  const texto = String(bruto).trim();
  return texto === "" ? null : texto;
}

/**
 * Id do EVENTO. Cai na transação quando o payload não traz `id` — é o que a
 * rota já fazia desde a Fase 1, e o que mantém a idempotência funcionando com
 * payloads antigos. Nunca inventa: sem os dois, devolve `null` e a rota
 * responde 400.
 */
export function eventoExternoIdDoPayload(payload: PayloadHotmart | null | undefined): string | null {
  const proprio = payload?.id;
  if (proprio !== null && proprio !== undefined && String(proprio).trim() !== "") return String(proprio).trim();
  return transacaoDoPayload(payload);
}

/**
 * Instante do evento, em ISO. Ordem de precedência igual à de
 * `processar_pagamento_hotmart` (0085): `creation_date` do webhook 2.0, depois
 * `approved_date`, depois `order_date` — todos epoch em MILISSEGUNDOS.
 * `null` quando nenhum deles é utilizável: data ilegível não vira `now()`
 * disfarçado de dado da Hotmart.
 */
export function instanteDoEvento(payload: PayloadHotmart | null | undefined): string | null {
  const candidatos = [
    payload?.creation_date,
    payload?.data?.purchase?.approved_date,
    payload?.data?.purchase?.order_date,
  ];
  for (const bruto of candidatos) {
    if (bruto === null || bruto === undefined) continue;
    const numero = typeof bruto === "number" ? bruto : Number(String(bruto).trim());
    if (!Number.isFinite(numero) || numero <= 0) continue;
    const data = new Date(numero);
    if (Number.isNaN(data.getTime())) continue;
    return data.toISOString();
  }
  return null;
}
