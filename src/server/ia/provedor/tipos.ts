import type { z } from "zod";
import type { EffortIa } from "../cliente";
import type { TokensUso } from "../precos";

/**
 * Contrato comum aos provedores de IA do SIC-HF (OpenRouter, hoje; Anthropic
 * direto, como caminho de reversão sem deploy). Nenhum chamador (`briefing.ts`,
 * `croqui-analise.ts`, `material.ts`, `ordenar-horarios.ts`) fala com o SDK ou
 * com `fetch` diretamente — tudo passa por `ProvedorIa.executar()`.
 *
 * `recusou`/`stopReason` são normalizados AQUI, no adaptador — nenhum chamador
 * testa `stop_reason`/`finish_reason` cru depois deste ponto.
 */

export interface PedidoIa<T> {
  modelo: string;
  sistema: string;
  usuario: string;
  schema: z.ZodType<T>;
  nomeSchema: string;
  maxTokens: number;
  effort: EffortIa;
}

export interface RespostaIa<T> {
  saida: T | null;
  recusou: boolean;
  motivoRecusa: string | null;
  /** Normalizado (`refusal` | `length` | `stop` | ...). Para telemetria, ver `stopReasonNativo`. */
  stopReason: string;
  /** `finish_reason` nativo do provedor, quando distinto do normalizado — grava em `execucoes_ia.stop_reason` com prioridade. */
  stopReasonNativo?: string | null;
  requestId: string | null;
  uso: TokensUso;
  custoUsdInformado: number | null;
  /** True quando a saída só validou depois do re-prompt de B1-3 — grava `execucoes_ia.erro = "reprompt_1"`. */
  usouReprompt?: boolean;
}

export interface ProvedorIa {
  nome: string;
  /** True quando as env vars necessárias estão presentes e não-vazias. Usar SEMPRE antes de chamar `executar()`. */
  configurado(): boolean;
  executar<T>(pedido: PedidoIa<T>): Promise<RespostaIa<T>>;
}
