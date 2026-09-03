import Anthropic from "@anthropic-ai/sdk";

/**
 * Camada de IA do SIC-HF. Nenhum componente de UI importa este arquivo nem o SDK
 * da Anthropic — só rotas de servidor (briefing, análise de croqui).
 */

let clienteSingleton: Anthropic | null = null;

/** True quando a env var está presente e não-vazia. Usar SEMPRE antes de chamar a IA. */
export function anthropicConfigurado(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

/**
 * Cliente Anthropic. Lança se a chave não estiver configurada — a rota chamadora
 * DEVE checar `anthropicConfigurado()` antes e responder 503 com mensagem clara.
 * Nunca gerar briefing/análise "de exemplo" quando a chave falta.
 */
export function obterClienteAnthropic(): Anthropic {
  if (!anthropicConfigurado()) {
    throw new Error("ANTHROPIC_API_KEY ausente — camada de IA indisponível");
  }
  if (!clienteSingleton) {
    clienteSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return clienteSingleton;
}

/** Modelos suportados pelo SIC-HF, conforme ARQUITETURA.md §4.1. */
export type ModeloIa = "claude-opus-5" | "claude-sonnet-5";

export type EffortIa = "low" | "medium" | "high" | "xhigh" | "max";
