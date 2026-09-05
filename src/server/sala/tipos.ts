/**
 * Provedor de sala de reunião (§1.3). Dois adaptadores:
 *   manual — o campo `link_sala` é colado na Ficha → Sessão (comportamento de sempre, B10);
 *   n8n    — o cron pede a sala ao workflow (Meet/Zoom, o que a casa tiver) e o
 *            webhook `/api/webhooks/n8n/sala` grava o link quando ele chega.
 * Ninguém espera resposta síncrona do n8n.
 */
export type NomeProvedorSala = "manual" | "n8n";

export interface PedidoSala {
  sessao_id: string;
  jornada_id: string;
  inicio_em: string;
  fim_em: string;
  titulo: string;
  /** Para onde o n8n devolve o link: `${APP_URL}/api/webhooks/n8n/sala`. */
  callback_url: string;
}

export type ResultadoPedidoSala = { ok: true; id_externo: string | null } | { ok: false; erro: string };

export interface ProvedorSala {
  nome: NomeProvedorSala;
  configurado(): boolean;
  /** Só nomes de variáveis — nunca valor. */
  faltam(): string[];
  solicitar(pedido: PedidoSala): Promise<ResultadoPedidoSala>;
}
