/**
 * O estado de uma compra da Hotmart vem do EVENTO, nunca de `purchase.status`.
 *
 * A regra é literal, do vault do João (04 Sistemas/"HM - esteira, boleto e o
 * gate de portal por produto"):
 *
 *   "O status vem do EVENTO, nunca de `purchase.status` — a Hotmart às vezes
 *    manda `APPROVED` no payload de um boleto só emitido."
 *
 * Até a Fase 8 este arquivo não existia e `mapearStatusHotmart(purchase.status)`
 * era a única fonte: o sistema estava a um `PURCHASE_BILLET_PRINTED` de dizer
 * que uma família pagou, avançar a etapa, disparar a régua e enfileirar a
 * ligação por IA.
 *
 * ESTE MÓDULO É O ESPELHO EM TypeScript DE `app.normaliza_evento_hotmart` E
 * `app.status_do_evento_hotmart` (migration 0085). As duas cópias existem de
 * propósito: o banco é quem decide (é ele que grava), e o TypeScript é quem
 * explica o resultado para a tela e para os testes. `eventos.test.ts` trava o
 * lado do TS; `scripts/verificacao-0083-0085.sql` trava o lado do banco.
 *
 * FONTE DOS NOMES (nada aqui é chute):
 *   · A Central de Ajuda da Hotmart lista os eventos em português (compra
 *     cancelada, compra completa, aguardando pagamento, compra aprovada,
 *     compra reembolsada, chargeback, compra expirada, pedido de reembolso,
 *     compra atrasada, abandono de carrinho). `developers.hotmart.com` respondeu
 *     CloudFront 403 em 07/09/2026 — a doc oficial não pôde ser citada.
 *   · Os nomes de máquina confirmados por evento REAL vêm do log cru
 *     `cs.hotmart_eventos` do ecossistema do João: PURCHASE_COMPLETE (89x),
 *     PURCHASE_BILLET_PRINTED (9x), PURCHASE_EXPIRED (8x), PURCHASE_APPROVED e
 *     os cancelamentos.
 *   · Por isso o desenho NÃO depende de a lista estar completa: evento
 *     desconhecido NUNCA aprova (`statusDoEvento` devolve `null`).
 */

export type StatusPagamento =
  | "pendente"
  | "em_analise"
  | "aprovado"
  | "cancelado"
  | "estornado"
  | "reembolsado"
  | "boleto_gerado"
  | "expirado"
  | "atrasado";

/** Nomes já normalizados (sem o prefixo `PURCHASE_`, sem grafia alternativa). */
export type EventoHotmartConhecido =
  | "APPROVED"
  | "COMPLETE"
  | "BILLET_PRINTED"
  | "DELAYED"
  | "EXPIRED"
  | "CANCELED"
  | "REFUNDED"
  | "CHARGEBACK"
  | "PROTEST"
  | "OUT_OF_SHOPPING_CART";

/**
 * Padrão P4 do vault ("mesmo status em duas grafias"): `COMPLETE`(16) vs
 * `COMPLETED`(94), `BILLET_PRINTED`(3) vs `PRINTED_BILLET`(3). Filtro escrito
 * com uma grafia só perde a outra metade EM SILÊNCIO. Aqui as grafias colapsam
 * antes de qualquer comparação — uma vez, num lugar.
 */
const SINONIMOS: Record<string, EventoHotmartConhecido> = {
  COMPLETED: "COMPLETE",
  PRINTED_BILLET: "BILLET_PRINTED",
  BILLET: "BILLET_PRINTED",
  CANCELLED: "CANCELED",
  PROTESTED: "PROTEST",
  DISPUTE: "CHARGEBACK",
  CHARGE_BACK: "CHARGEBACK",
  REFUND: "REFUNDED",
  OVERDUE: "DELAYED",
};

/** O mapa da §A3 do plano da Fase 8. */
export const MAPA_EVENTO_HOTMART: Record<EventoHotmartConhecido, StatusPagamento> = {
  APPROVED: "aprovado",
  /** pix/boleto COMPENSADO — o evento que o outro projeto do João descartava. */
  COMPLETE: "aprovado",
  BILLET_PRINTED: "boleto_gerado",
  DELAYED: "atrasado",
  EXPIRED: "expirado",
  CANCELED: "cancelado",
  REFUNDED: "reembolsado",
  CHARGEBACK: "estornado",
  PROTEST: "estornado",
  OUT_OF_SHOPPING_CART: "em_analise",
};

/** `PURCHASE_COMPLETED` → `COMPLETE`. Devolve `null` para vazio/ausente. */
export function normalizarEventoHotmart(bruto: string | null | undefined): string | null {
  if (bruto == null) return null;
  const limpo = bruto.trim();
  if (limpo === "") return null;
  const semPrefixo = limpo.toUpperCase().replace(/^PURCHASE[_-]/, "").replace(/-/g, "_");
  return SINONIMOS[semPrefixo] ?? semPrefixo;
}

/** `null` = evento desconhecido. Quem chama NUNCA pode traduzir isso em "aprovado". */
export function statusDoEventoHotmart(eventoNormalizado: string | null): StatusPagamento | null {
  if (eventoNormalizado === null) return null;
  return MAPA_EVENTO_HOTMART[eventoNormalizado as EventoHotmartConhecido] ?? null;
}

/**
 * Mapeamento do `purchase.status` do payload. **Só vale quando não há `event`**
 * — linha antiga reprocessada pelo Admin, seed, registro manual. Mantida com o
 * nome de sempre porque continua sendo o fallback legítimo, não porque continua
 * sendo a fonte principal.
 */
export function mapearStatusHotmart(statusBruto: string | undefined | null): StatusPagamento {
  const status = (statusBruto ?? "").toUpperCase().trim();
  if (status === "APPROVED" || status === "COMPLETE" || status === "COMPLETED") return "aprovado";
  if (status === "CANCELLED" || status === "CANCELED") return "cancelado";
  if (status === "EXPIRED") return "expirado";
  if (status === "REFUNDED") return "reembolsado";
  if (status === "CHARGEBACK" || status === "DISPUTE" || status === "PROTESTED") return "estornado";
  if (status === "BILLET_PRINTED" || status === "PRINTED_BILLET") return "boleto_gerado";
  if (status === "DELAYED" || status === "OVERDUE") return "atrasado";
  if (status === "STARTED" || status === "PRE_ORDER" || status === "PROCESSING_TRANSACTION") return "pendente";
  return "em_analise";
}

export interface EstadoDaCompra {
  /** Nome normalizado do evento, ou `null` quando o payload não trouxe `event`. */
  evento: string | null;
  status: StatusPagamento;
  /** De onde saiu o estado. `purchase.status` só aparece quando NÃO há evento. */
  fonte: "evento" | "purchase.status";
  /** `false` quando veio um `event` que o mapa não conhece (D3). */
  conhecido: boolean;
}

/**
 * A decisão inteira, num lugar só.
 *
 *   com `event` conhecido    → o mapa manda; `purchase.status` é ignorado.
 *   com `event` desconhecido → `em_analise` e `conhecido = false`. NUNCA aprova.
 *   sem `event`              → cai em `purchase.status` (reprocesso/seed).
 */
export function estadoDaCompraHotmart(evento: string | null | undefined, statusDoPayload: string | undefined | null): EstadoDaCompra {
  const normalizado = normalizarEventoHotmart(evento);
  if (normalizado === null) {
    return { evento: null, status: mapearStatusHotmart(statusDoPayload), fonte: "purchase.status", conhecido: false };
  }
  const status = statusDoEventoHotmart(normalizado);
  if (status === null) {
    return { evento: normalizado, status: "em_analise", fonte: "evento", conhecido: false };
  }
  return { evento: normalizado, status, fonte: "evento", conhecido: true };
}
