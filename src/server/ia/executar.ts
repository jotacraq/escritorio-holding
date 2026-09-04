import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { resolverProvedor, type EffortIa } from "./cliente";
import { calcularCustoUsd } from "./precos";
import { erroNaoEncontrado, ErroIa } from "./erros";

/**
 * Ponto central de execução de IA do SIC-HF (B1-8). Todo chamador real
 * (`briefing.ts`, `croqui-analise.ts`, `material.ts`, `ordenar-horarios.ts`)
 * passa por aqui — nenhum fala com `resolverProvedor()`/adaptador direto.
 *
 * Ordem de execução, fixa:
 * 1. busca prompt ativo por `chavePrompt` (404 se não houver)
 * 2. serializa entrada + hash sha256
 * 3. INSERT execucoes_ia status 'executando'
 * 4. resolve provedor via `resolverProvedor()`
 * 5. chama `executar()`
 *    - recusa → UPDATE falhou + lança ErroIa(502, 'recusa_ia')
 *    - saída inválida (após o re-prompt do adaptador) → UPDATE falhou + lança ErroIa(502, 'saida_invalida')
 *    - sucesso → UPDATE concluida com tokens/custo/latência/stop_reason/request_id
 * 6. retorna { execucaoId, saida, custoUsd }
 *
 * Cada chamador mantém a lógica específica dele (montagem de contexto, checagem
 * de consentimento, RPC de gravação do conteúdo) — este módulo não sabe nada
 * sobre briefing, croqui, material ou agenda.
 *
 * Modelo: fonte da verdade é `prompts_versoes.modelo_padrao` (o SEED/migration
 * decide o slug). `IA_MODELO_PADRAO`, se presente, VENCE — é só para rollback
 * rápido de incidente (ex.: modelo com problema no provedor), nunca a
 * configuração normal de operação.
 */

interface PromptAtivo {
  id: string;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: EffortIa;
}

export interface ParamsExecutarComAuditoria<T> {
  chavePrompt: string;
  jornadaId: string | null;
  criadoPor: string | null;
  /** Conteúdo serializável enviado como mensagem `user` (após o prefixo, se houver). */
  entrada: unknown;
  /** Texto fixo que precede a entrada serializada na mensagem `user` (ex.: "Contexto da família (JSON):"). */
  prefixoUsuario: string;
  schema: z.ZodType<T>;
  nomeSchema: string;
  maxTokens: number;
}

export interface ResultadoExecucaoAuditada<T> {
  execucaoId: string;
  saida: T;
  custoUsd: number | null;
}

export async function executarComAuditoria<T>(
  supabaseAdmin: SupabaseClient,
  params: ParamsExecutarComAuditoria<T>,
): Promise<ResultadoExecucaoAuditada<T>> {
  const { chavePrompt, jornadaId, criadoPor, entrada, prefixoUsuario, schema, nomeSchema, maxTokens } = params;

  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id, corpo_sistema, modelo_padrao, effort")
    .eq("chave", chavePrompt)
    .eq("ativo", true)
    .maybeSingle<PromptAtivo>();

  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado(`prompt_ativo_nao_encontrado: ${chavePrompt}`);
  }

  const modeloOverride = process.env.IA_MODELO_PADRAO?.trim();
  const modelo = modeloOverride ? modeloOverride : prompt.modelo_padrao;

  const entradaSerializada = JSON.stringify(entrada);
  const hashEntrada = crypto.createHash("sha256").update(entradaSerializada).digest("hex");

  const { data: execucao, error: erroExecucao } = await supabaseAdmin
    .from("execucoes_ia")
    .insert({
      jornada_id: jornadaId,
      prompt_versao_id: prompt.id,
      modelo,
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
    const provedor = resolverProvedor();
    const resposta = await provedor.executar({
      modelo,
      sistema: prompt.corpo_sistema,
      usuario: `${prefixoUsuario}\n\n${entradaSerializada}`,
      schema,
      nomeSchema,
      maxTokens,
      effort: prompt.effort,
    });

    const latenciaMs = Date.now() - inicio;
    const stopReasonGravado = resposta.stopReasonNativo ?? resposta.stopReason;

    if (resposta.recusou) {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: `refusal: ${resposta.motivoRecusa ?? "sem_categoria"}`,
          latencia_ms: latenciaMs,
          stop_reason: stopReasonGravado,
          request_id: resposta.requestId,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa("A IA recusou processar este conteúdo.", 502, "recusa_ia");
    }

    if (resposta.saida === null) {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: resposta.usouReprompt ? "reprompt_1: saida_nao_validou_contra_o_schema" : "saida_nao_validou_contra_o_schema",
          latencia_ms: latenciaMs,
          stop_reason: stopReasonGravado,
          request_id: resposta.requestId,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa(`A saída da IA não validou contra o schema "${nomeSchema}".`, 502, "saida_invalida");
    }

    const custoUsd = resposta.custoUsdInformado ?? (await calcularCustoUsd(supabaseAdmin, modelo, resposta.uso));

    await supabaseAdmin
      .from("execucoes_ia")
      .update({
        status: "concluida",
        tokens_entrada: resposta.uso.tokensEntrada,
        tokens_saida: resposta.uso.tokensSaida,
        tokens_cache_escrita: resposta.uso.tokensCacheEscrita,
        tokens_cache_leitura: resposta.uso.tokensCacheLeitura,
        // Ja contido em tokens_saida — grava separado so para saber quanto da
        // saida foi raciocinio, que e o que da para calibrar sem mexer no metodo.
        tokens_raciocinio: resposta.uso.tokensRaciocinio || null,
        custo_usd: custoUsd,
        latencia_ms: latenciaMs,
        stop_reason: stopReasonGravado,
        request_id: resposta.requestId,
        erro: resposta.usouReprompt ? "reprompt_1" : null,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", execucao.id);

    return { execucaoId: execucao.id, saida: resposta.saida, custoUsd };
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
