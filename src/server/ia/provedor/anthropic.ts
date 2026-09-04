import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ProvedorIa, PedidoIa, RespostaIa } from "./tipos";

/**
 * Adaptador Anthropic direto (SDK `@anthropic-ai/sdk`) — caminho de reversão
 * sem deploy: `IA_PROVEDOR=anthropic` na env volta a chamar a Anthropic sem
 * passar pelo OpenRouter. Era o código de `briefing.ts`/`croqui-analise.ts`
 * antes desta migração para o adaptador comum (`ProvedorIa`); a dependência
 * continua no `package.json` de propósito.
 */

// Mesmo timeout do adaptador OpenRouter (openrouter.ts TIMEOUT_MS) — pentest
// 03/09/2026 (achado médio): sem isto, o path de rollback de incidente (usado
// sob pressão, quando o OpenRouter falha) herdava o timeout default do SDK
// (10 min) em vez do comportamento conhecido/documentado do projeto.
// Mesmo teto do adaptador OpenRouter, e pelo mesmo motivo: 120s se provou
// apertado em producao (um briefing em modo reduzido levou 100,8s). Se este
// caminho de rollback for acionado, ele nao pode herdar o problema que o
// principal ja corrigiu. Lido da mesma env, para os dois andarem juntos.
const TIMEOUT_MS = Number(process.env.IA_TIMEOUT_MS ?? 300_000);

let clienteSingleton: Anthropic | null = null;

export function anthropicConfigurado(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

function obterCliente(): Anthropic {
  if (!anthropicConfigurado()) {
    throw new Error("ANTHROPIC_API_KEY ausente — provedor anthropic chamado sem configuração");
  }
  if (!clienteSingleton) {
    clienteSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS });
  }
  return clienteSingleton;
}

export const provedorAnthropic: ProvedorIa = {
  nome: "anthropic",
  configurado: anthropicConfigurado,

  async executar<T>(pedido: PedidoIa<T>): Promise<RespostaIa<T>> {
    const client = obterCliente();
    const stream = client.messages.stream({
      model: pedido.modelo,
      max_tokens: pedido.maxTokens,
      thinking: { type: "adaptive" },
      output_config: {
        effort: pedido.effort,
        format: zodOutputFormat(pedido.schema),
      },
      system: [
        {
          type: "text",
          text: pedido.sistema,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: pedido.usuario }],
    });

    const mensagemFinal = await stream.finalMessage();
    const requestId = (mensagemFinal as { _request_id?: string | null })._request_id ?? null;

    const uso = {
      tokensEntrada: mensagemFinal.usage.input_tokens,
      tokensSaida: mensagemFinal.usage.output_tokens,
      tokensCacheEscrita: mensagemFinal.usage.cache_creation_input_tokens ?? 0,
      tokensCacheLeitura: mensagemFinal.usage.cache_read_input_tokens ?? 0,
    };

    if (mensagemFinal.stop_reason === "refusal") {
      return {
        saida: null,
        recusou: true,
        motivoRecusa: mensagemFinal.stop_details?.category ?? "sem_categoria",
        stopReason: "refusal",
        requestId,
        uso,
        custoUsdInformado: null,
      };
    }

    return {
      saida: mensagemFinal.parsed_output ?? null,
      recusou: false,
      motivoRecusa: null,
      stopReason: mensagemFinal.stop_reason ?? "desconhecido",
      requestId,
      uso,
      custoUsdInformado: null,
    };
  },
};
