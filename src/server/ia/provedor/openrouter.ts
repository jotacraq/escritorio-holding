import { z } from "zod";
import type { ProvedorIa, PedidoIa, RespostaIa } from "./tipos";
import { paraJsonSchemaEstrito } from "./json-schema-estrito";
import type { EffortIa } from "../cliente";

/**
 * Cliente OpenRouter via `fetch` cru — mesmo padrão de `src/server/regua/email.ts`
 * (sem SDK novo, sem retry de rede, timeout explícito via `AbortSignal.timeout()`).
 *
 * Rota pinada só na Anthropic (`provider.order:["anthropic"], allow_fallbacks:false`):
 * mantém a mesma cadeia de subprocessador de hoje (Anthropic direto), sem risco de
 * roteamento silencioso a Bedrock/Vertex/Azure — LGPD, não performance.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 120_000;

/** effort → reasoning.max_tokens (extended thinking, repassado pelo provider Anthropic). */
const EFFORT_PARA_REASONING_MAX_TOKENS: Record<EffortIa, number> = {
  low: 1024,
  medium: 2048,
  high: 4096,
  xhigh: 8192,
  max: 16384,
};

export function openrouterConfigurado(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

// ===========================================================================
// Formato da API OpenRouter (só os campos que consumimos — a resposta real
// tem mais, mas não é nosso contrato ler o que não usamos).
// ===========================================================================
interface MensagemChoiceOpenRouter {
  message?: {
    content?: string | null;
    refusal?: string | null;
  };
  finish_reason?: string | null;
  native_finish_reason?: string | null;
}

interface RespostaOpenRouter {
  id?: string;
  choices?: MensagemChoiceOpenRouter[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: string | number };
}

interface MensagemChat {
  role: "system" | "user";
  content: unknown;
}

async function chamarOpenRouter(mensagens: MensagemChat[], modelo: string, nomeSchema: string, jsonSchema: Record<string, unknown>, effort: EffortIa, maxTokens: number): Promise<RespostaOpenRouter> {
  const resposta = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "",
      "X-Title": "SIC-HF",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelo,
      messages: mensagens,
      max_tokens: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: nomeSchema, strict: true, schema: jsonSchema },
      },
      reasoning: { max_tokens: EFFORT_PARA_REASONING_MAX_TOKENS[effort] },
      provider: { order: ["anthropic"], allow_fallbacks: false, require_parameters: true },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const corpo = (await resposta.json().catch(() => null)) as RespostaOpenRouter | null;

  if (!resposta.ok || corpo?.error) {
    // finish_reason === "error" ou corpo com campo `error`: lança — cai no catch
    // do chamador (`executar.ts`), que já marca `falhou`. Detalhe interno (mensagem
    // crua do provedor) fica só no log de erro, nunca é o que o cliente HTTP recebe.
    throw new Error(
      `openrouter_${resposta.status}: ${corpo?.error?.message ?? "erro desconhecido"}`,
    );
  }
  if (!corpo) {
    throw new Error("openrouter_resposta_vazia");
  }
  return corpo;
}

function extrairUso(corpo: RespostaOpenRouter) {
  const usage = corpo.usage;
  return {
    tokensEntrada: usage?.prompt_tokens ?? 0,
    tokensSaida: usage?.completion_tokens ?? 0,
    tokensCacheEscrita: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
    tokensCacheLeitura: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Normaliza recusa/stop conforme B1-6. `native_finish_reason` tem prioridade
 * sobre `finish_reason` para telemetria (grava em `execucoes_ia.stop_reason`).
 */
function normalizarParada(choice: MensagemChoiceOpenRouter): {
  recusou: boolean;
  motivoRecusa: string | null;
  stopReason: string;
  stopReasonNativo: string | null;
} {
  const finishReason = choice.finish_reason ?? "desconhecido";
  const nativeFinishReason = choice.native_finish_reason ?? null;
  const refusal = choice.message?.refusal ?? null;

  if (finishReason === "content_filter") {
    return {
      recusou: true,
      motivoRecusa: nativeFinishReason ?? "content_filter",
      stopReason: "content_filter",
      stopReasonNativo: nativeFinishReason,
    };
  }
  if (nativeFinishReason === "refusal" || refusal) {
    return {
      recusou: true,
      motivoRecusa: refusal ?? nativeFinishReason ?? "refusal",
      stopReason: "refusal",
      stopReasonNativo: nativeFinishReason,
    };
  }
  if (finishReason === "length") {
    // NÃO é recusa — sinal de max_tokens curto, diferente de recusa (a tela de
    // custo precisa distinguir os dois). Saída não vem completa: tratamos como null.
    return { recusou: false, motivoRecusa: null, stopReason: "length", stopReasonNativo: nativeFinishReason };
  }
  return { recusou: false, motivoRecusa: null, stopReason: finishReason, stopReasonNativo: nativeFinishReason };
}

export const provedorOpenRouter: ProvedorIa = {
  nome: "openrouter",
  configurado: openrouterConfigurado,

  async executar<T>(pedido: PedidoIa<T>): Promise<RespostaIa<T>> {
    if (!openrouterConfigurado()) {
      throw new Error("OPENROUTER_API_KEY ausente — provedor openrouter chamado sem configuração");
    }

    const jsonSchema = paraJsonSchemaEstrito(pedido.schema as z.ZodType<unknown>);
    const mensagens: MensagemChat[] = [
      {
        role: "system",
        content: [{ type: "text", text: pedido.sistema, cache_control: { type: "ephemeral" } }],
      },
      { role: "user", content: pedido.usuario },
    ];

    let corpo = await chamarOpenRouter(
      mensagens,
      pedido.modelo,
      pedido.nomeSchema,
      jsonSchema,
      pedido.effort,
      pedido.maxTokens,
    );
    let choice = corpo.choices?.[0];
    let usouReprompt = false;

    if (!choice) {
      throw new Error("openrouter_sem_choices_na_resposta");
    }

    const paradaInicial = normalizarParada(choice);
    if (paradaInicial.recusou || paradaInicial.stopReason === "length") {
      return {
        saida: null,
        recusou: paradaInicial.recusou,
        motivoRecusa: paradaInicial.motivoRecusa,
        stopReason: paradaInicial.stopReason,
        stopReasonNativo: paradaInicial.stopReasonNativo,
        requestId: corpo.id ?? null,
        uso: extrairUso(corpo),
        custoUsdInformado: corpo.usage?.cost ?? null,
      };
    }

    let parse = tentarParse(pedido.schema, choice.message?.content ?? null);

    // B1-3, passo 3: falha de parse OU safeParse → UMA nova tentativa, com os
    // erros do Zod formatados pedindo correção. Segunda falha → saida:null.
    if (!parse.sucesso) {
      const mensagemErro = formatarErrosParaReprompt(parse.erro);
      mensagens.push(
        { role: "user", content: choice.message?.content ?? "" },
        {
          role: "user",
          content:
            `A resposta anterior não validou contra o schema "${pedido.nomeSchema}". ` +
            `Corrija e responda de novo, só com o JSON válido. Erros:\n\n${mensagemErro}`,
        },
      );
      corpo = await chamarOpenRouter(mensagens, pedido.modelo, pedido.nomeSchema, jsonSchema, pedido.effort, pedido.maxTokens);
      choice = corpo.choices?.[0];
      usouReprompt = true;

      if (!choice) {
        throw new Error("openrouter_sem_choices_na_resposta_reprompt");
      }

      const paradaReprompt = normalizarParada(choice);
      if (paradaReprompt.recusou || paradaReprompt.stopReason === "length") {
        return {
          saida: null,
          recusou: paradaReprompt.recusou,
          motivoRecusa: paradaReprompt.motivoRecusa,
          stopReason: paradaReprompt.stopReason,
          stopReasonNativo: paradaReprompt.stopReasonNativo,
          requestId: corpo.id ?? null,
          uso: extrairUso(corpo),
          custoUsdInformado: corpo.usage?.cost ?? null,
          usouReprompt,
        };
      }

      parse = tentarParse(pedido.schema, choice.message?.content ?? null);
    }

    const paradaFinal = normalizarParada(choice);
    return {
      saida: parse.sucesso ? parse.valor : null,
      recusou: false,
      motivoRecusa: null,
      stopReason: paradaFinal.stopReason,
      stopReasonNativo: paradaFinal.stopReasonNativo,
      requestId: corpo.id ?? null,
      uso: extrairUso(corpo),
      custoUsdInformado: corpo.usage?.cost ?? null,
      usouReprompt,
    };
  },
};

type ResultadoParse<T> = { sucesso: true; valor: T } | { sucesso: false; erro: z.ZodError | Error };

function tentarParse<T>(schema: z.ZodType<T>, conteudo: string | null): ResultadoParse<T> {
  if (!conteudo) {
    return { sucesso: false, erro: new Error("conteudo_vazio") };
  }
  let json: unknown;
  try {
    json = JSON.parse(conteudo);
  } catch (erro) {
    return { sucesso: false, erro: erro instanceof Error ? erro : new Error(String(erro)) };
  }
  const resultado = schema.safeParse(json);
  if (!resultado.success) {
    return { sucesso: false, erro: resultado.error };
  }
  return { sucesso: true, valor: resultado.data };
}

function formatarErrosParaReprompt(erro: z.ZodError | Error): string {
  if (erro instanceof z.ZodError) {
    return erro.issues
      .map((issue) => `- ${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("\n");
  }
  return `- erro de parse JSON: ${erro.message}`;
}
