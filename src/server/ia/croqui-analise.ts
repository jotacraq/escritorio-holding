import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { obterClienteAnthropic, type EffortIa } from "./cliente";
import { montarContextoAnaliseCroqui } from "./contexto-croqui";
import { CroquiAnaliseSchema, type CroquiAnalise } from "./schema-croqui-analise";
import { calcularCustoUsd } from "./precos";
import { temConsentimento } from "./consentimento";
import { erroServicoIndisponivel, erroNaoEncontrado, erroConsentimentoAusente, ErroIa } from "./erros";
import { resolverModoIa, gerarAnaliseCroquiDemonstracao } from "./demonstracao";

const CHAVE_PROMPT = "agente_croqui_analise";

export interface ResultadoAnaliseCroqui {
  execucaoId: string;
  analiseId: string;
  analise: CroquiAnalise;
  custoUsd: number | null;
}

interface PromptVersao {
  id: string;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: EffortIa;
}

/**
 * Orquestra a análise do Agente do Croqui: recebe a transcrição da SV (no corpo
 * da requisição, nunca persistida além do necessário) + dados de ficha já
 * registrados, e devolve as 14 seções carimbadas por categoria. Mesmas travas
 * do briefing: sem ANTHROPIC_API_KEY e sem modo demonstração ligado → 503 antes
 * de chamar; recusa/saída inválida → execução marcada `falhou`, nunca análise
 * fabricada. Com o modo demonstração ligado (`resolverModoIa`,
 * ARQUITETURA-FASE-2.md §3), devolve o exemplo fixo e marcado, ANTES de checar
 * consentimento — a demonstração não olha `pessoaId`/`transcricaoSessao` de
 * verdade, então a trava de consentimento (que existe para proteger dado real)
 * não se aplica a ela.
 *
 * ALTO 2 (pentest 03/09/2026): exige `tem_consentimento(pessoa,'tratamento_ia')`
 * ANTES de montar contexto ou registrar execução — nome completo, familiares,
 * valor real de patrimônio e a transcrição bruta da SV não podem sair para a
 * Anthropic sem esse consentimento. Diferente do Briefing (§4.4), aqui NÃO
 * existe modo reduzido: recusa com 409 `consentimento_ausente`.
 */
export async function gerarAnaliseCroqui(
  supabaseAdmin: SupabaseClient,
  params: { croquiId: string; jornadaId: string; pessoaId: string; transcricaoSessao: string; criadoPor: string | null },
): Promise<ResultadoAnaliseCroqui> {
  const { croquiId, jornadaId, pessoaId, transcricaoSessao, criadoPor } = params;

  const modoIa = resolverModoIa();
  if (modoIa === "indisponivel") {
    throw erroServicoIndisponivel("ANTHROPIC_API_KEY ausente — análise do croqui indisponível");
  }
  if (modoIa === "demonstracao") {
    return gerarAnaliseCroquiDemonstracao(supabaseAdmin, { croquiId, jornadaId, criadoPor });
  }

  const consentiu = await temConsentimento(supabaseAdmin, pessoaId, "tratamento_ia");
  if (!consentiu) {
    throw erroConsentimentoAusente(
      "Consentimento de tratamento por IA não registrado para esta pessoa — a Agente do Croqui não pode rodar sem ele.",
    );
  }

  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id, corpo_sistema, modelo_padrao, effort")
    .eq("chave", CHAVE_PROMPT)
    .eq("ativo", true)
    .maybeSingle<PromptVersao>();

  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado("prompt_ativo_nao_encontrado: agente_croqui_analise");
  }

  const contexto = await montarContextoAnaliseCroqui(supabaseAdmin, { jornadaId, pessoaId, transcricaoSessao });
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
        format: zodOutputFormat(CroquiAnaliseSchema),
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
            "Transcrição da Sessão de Viabilidade e dados de ficha já registrados (JSON):\n\n" +
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
      throw new ErroIa("A IA recusou analisar este conteúdo.", 502, "recusa_ia");
    }

    const analise = mensagemFinal.parsed_output;
    if (!analise) {
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
      throw new ErroIa("A saída da IA não validou contra o schema do Agente do Croqui.", 502, "saida_invalida");
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

    const { data: analiseGravada, error: erroAnalise } = await supabaseAdmin
      .rpc("registrar_croqui_analise", {
        p_croqui_id: croquiId,
        p_execucao_id: execucao.id,
        p_conteudo: analise,
        p_grau_confianca: analise.grau_confianca,
      })
      .single<{ id: string }>();

    if (erroAnalise || !analiseGravada) {
      throw new Error(`falha_ao_gravar_analise: ${erroAnalise?.message}`);
    }

    return { execucaoId: execucao.id, analiseId: analiseGravada.id, analise, custoUsd };
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
