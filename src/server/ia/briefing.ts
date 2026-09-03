import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropicConfigurado, obterClienteAnthropic, type EffortIa } from "./cliente";
import { montarContextoBriefing } from "./contexto-briefing";
import { BriefingSchema, type Briefing } from "./schema-briefing";
import { calcularCustoUsd } from "./precos";
import { erroServicoIndisponivel, erroNaoEncontrado, ErroIa } from "./erros";

const CHAVE_PROMPT = "protocolo_01_briefing";

export interface ResultadoBriefing {
  execucaoId: string;
  briefingId: string;
  briefing: Briefing;
  grauConfianca: number;
  fontesUsadas: string[];
  modoReduzido: boolean;
  custoUsd: number | null;
}

interface PromptVersao {
  id: string;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: EffortIa;
}

/**
 * Orquestra a geração do Briefing Estratégico (Protocolo 01). Nunca retorna
 * briefing de exemplo: se a IA não estiver configurada, lança 503 antes de
 * qualquer chamada. Se a IA recusar ou a saída não validar, grava a execução
 * como `falhou` e propaga o erro — nunca renderiza um briefing vazio como se
 * fosse análise.
 */
export async function gerarBriefing(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; criadoPor: string | null; forcarRegeracao?: boolean },
): Promise<ResultadoBriefing> {
  if (!anthropicConfigurado()) {
    throw erroServicoIndisponivel("ANTHROPIC_API_KEY ausente — geração de briefing indisponível");
  }

  const { jornadaId, criadoPor, forcarRegeracao } = params;

  if (!forcarRegeracao) {
    const { data: existente } = await supabaseAdmin
      .from("briefings")
      .select("id")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle();
    if (existente) {
      throw new ErroIa("briefing_atual_ja_existe: use forcar_regeracao=true para regerar", 409, "conflito");
    }
  }

  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id, corpo_sistema, modelo_padrao, effort")
    .eq("chave", CHAVE_PROMPT)
    .eq("ativo", true)
    .maybeSingle<PromptVersao>();

  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado("prompt_ativo_nao_encontrado: protocolo_01_briefing");
  }

  let contextoMontado;
  try {
    contextoMontado = await montarContextoBriefing(supabaseAdmin, jornadaId);
  } catch {
    throw erroNaoEncontrado(`jornada_nao_encontrada: ${jornadaId}`);
  }
  const { contexto, fontesUsadas, modoReduzido } = contextoMontado;
  const entradaSerializada = JSON.stringify(contexto);
  const hashEntrada = crypto.createHash("sha256").update(entradaSerializada).digest("hex");

  const { data: execucao, error: erroExecucao } = await supabaseAdmin
    .from("execucoes_ia")
    .insert({
      jornada_id: jornadaId,
      prompt_versao_id: prompt.id,
      modelo: prompt.modelo_padrao,
      status: "executando",
      hash_entrada: hashEntrada,
      criado_por: criadoPor,
    })
    .select("id")
    .single<{ id: string }>();

  if (erroExecucao || !execucao) {
    throw new Error(`falha_ao_registrar_execucao: ${erroExecucao?.message}`);
  }

  const inicio = Date.now();

  try {
    const client = obterClienteAnthropic();
    const stream = client.messages.stream({
      model: prompt.modelo_padrao,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: prompt.effort,
        format: zodOutputFormat(BriefingSchema),
      },
      system: [
        {
          type: "text",
          text: prompt.corpo_sistema,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            "Contexto da família e da jornada (JSON, allowlist — nunca contém valor absoluto de " +
            "patrimônio, CPF ou endereço completo):\n\n" +
            entradaSerializada,
        },
      ],
    });

    const mensagemFinal = await stream.finalMessage();
    const latenciaMs = Date.now() - inicio;

    if (mensagemFinal.stop_reason === "refusal") {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: `refusal: ${mensagemFinal.stop_details?.category ?? "sem_categoria"}`,
          latencia_ms: latenciaMs,
          stop_reason: mensagemFinal.stop_reason,
          request_id: (mensagemFinal as { _request_id?: string | null })._request_id ?? null,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa("A IA recusou gerar o briefing para este conteúdo.", 502, "recusa_ia");
    }

    const briefing = mensagemFinal.parsed_output;
    if (!briefing) {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: "saida_nao_validou_contra_o_schema",
          latencia_ms: latenciaMs,
          stop_reason: mensagemFinal.stop_reason,
          request_id: (mensagemFinal as { _request_id?: string | null })._request_id ?? null,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa("A saída da IA não validou contra o schema do Protocolo 01.", 502, "saida_invalida");
    }

    const uso = {
      tokensEntrada: mensagemFinal.usage.input_tokens,
      tokensSaida: mensagemFinal.usage.output_tokens,
      tokensCacheEscrita: mensagemFinal.usage.cache_creation_input_tokens ?? 0,
      tokensCacheLeitura: mensagemFinal.usage.cache_read_input_tokens ?? 0,
    };
    const custoUsd = await calcularCustoUsd(supabaseAdmin, prompt.modelo_padrao, uso);

    await supabaseAdmin
      .from("execucoes_ia")
      .update({
        status: "concluida",
        tokens_entrada: uso.tokensEntrada,
        tokens_saida: uso.tokensSaida,
        tokens_cache_escrita: uso.tokensCacheEscrita,
        tokens_cache_leitura: uso.tokensCacheLeitura,
        custo_usd: custoUsd,
        latencia_ms: latenciaMs,
        stop_reason: mensagemFinal.stop_reason,
        request_id: (mensagemFinal as { _request_id?: string | null })._request_id ?? null,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", execucao.id);

    const { data: briefingGravado, error: erroBriefing } = await supabaseAdmin
      .rpc("registrar_briefing", {
        p_jornada_id: jornadaId,
        p_execucao_id: execucao.id,
        p_conteudo: briefing,
        p_grau_confianca: briefing.grau_confianca,
        p_fontes_usadas: fontesUsadas,
        p_modo_reduzido: modoReduzido,
      })
      .single<{ id: string }>();

    if (erroBriefing || !briefingGravado) {
      throw new Error(`falha_ao_gravar_briefing: ${erroBriefing?.message}`);
    }

    return {
      execucaoId: execucao.id,
      briefingId: briefingGravado.id,
      briefing,
      grauConfianca: briefing.grau_confianca,
      fontesUsadas,
      modoReduzido,
      custoUsd,
    };
  } catch (erro) {
    if (erro instanceof ErroIa) throw erro;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await supabaseAdmin
      .from("execucoes_ia")
      .update({ status: "falhou", erro: mensagem, latencia_ms: Date.now() - inicio, concluido_em: new Date().toISOString() })
      .eq("id", execucao.id);
    throw erro;
  }
}
