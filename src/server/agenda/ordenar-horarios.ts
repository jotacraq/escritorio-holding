import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { obterClienteAnthropic, type EffortIa } from "@/server/ia/cliente";
import { calcularCustoUsd } from "@/server/ia/precos";
import type { SlotDisponivel } from "@/types/agenda";

const CHAVE_PROMPT = "ordenar_horarios_agenda";

/**
 * Saída estruturada da IA: só ordem + motivo. Nenhum campo de horário livre —
 * a IA nunca escreve um timestamp novo, só referencia um dos que recebeu
 * (validado por igualdade de conjunto logo abaixo, nunca por confiança cega).
 */
const OrdemHorariosSchema = z.object({
  ordenacao: z
    .array(
      z.object({
        inicio_em: z.string().min(1),
        motivo: z.string().min(1).max(300),
      }),
    )
    .min(1),
});

export interface SlotOrdenado extends SlotDisponivel {
  motivo_sugestao: string;
}

export interface ResultadoOrdenacaoIa {
  slots: SlotOrdenado[];
  execucaoIaId: string;
}

export interface EvidenciaLigacao {
  respostas: unknown;
  preocupacao_principal: string | null;
  ritmo: string | null;
  estilo_resposta: string | null;
  decisores_presentes_na_sessao: boolean | null;
}

interface PromptOrdenacao {
  id: string;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: EffortIa;
}

/**
 * CONFLITO C10: a IA aqui ORDENA os slots que a advogada já abriu — nunca
 * escolhe, nunca inventa horário. Entrada restrita à allowlist da Ligação
 * Estratégica (`respostas`, `preocupacao_principal`, `ritmo`, `estilo_resposta`,
 * `decisores_presentes_na_sessao`) — nada de patrimônio, briefing completo ou
 * qualquer outro dado da família.
 *
 * Pré-condição (o CHAMADOR garante, não esta função — mesmo princípio de
 * `gerarBriefingDemonstracao` em `src/server/ia/demonstracao.ts`): já se
 * confirmou `resolverModoIa() === 'real'` e que existe ligação para a jornada.
 * Lança se a IA recusar OU se a saída não preservar EXATAMENTE o conjunto de
 * horários recebido (sem invenção, sem perda, sem duplicata) — o chamador
 * (`gerarSugestoesAgendamento`) deve capturar e cair para ordem cronológica,
 * nunca renderizar uma ordenação parcialmente inventada.
 */
export async function ordenarSlotsPorIa(
  supabaseAdmin: SupabaseClient,
  params: {
    jornadaId: string;
    criadoPor: string | null;
    slots: SlotDisponivel[];
    evidencia: EvidenciaLigacao;
  },
): Promise<ResultadoOrdenacaoIa> {
  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id, corpo_sistema, modelo_padrao, effort")
    .eq("chave", CHAVE_PROMPT)
    .eq("ativo", true)
    .maybeSingle<PromptOrdenacao>();

  if (erroPrompt || !prompt) {
    throw new Error(`prompt_ativo_nao_encontrado: ${CHAVE_PROMPT}`);
  }

  const entrada = {
    horarios_disponiveis: params.slots.map((s) => s.inicio_em),
    evidencia: params.evidencia,
  };
  const entradaSerializada = JSON.stringify(entrada);
  const hashEntrada = crypto.createHash("sha256").update(entradaSerializada).digest("hex");

  const { data: execucao, error: erroExecucao } = await supabaseAdmin
    .from("execucoes_ia")
    .insert({
      jornada_id: params.jornadaId,
      prompt_versao_id: prompt.id,
      modelo: prompt.modelo_padrao,
      status: "executando",
      hash_entrada: hashEntrada,
      criado_por: params.criadoPor,
    })
    .select("id")
    .single<{ id: string }>();

  if (erroExecucao || !execucao) {
    throw new Error(`falha_ao_registrar_execucao_ordenacao: ${erroExecucao?.message}`);
  }

  const inicio = Date.now();
  const marcarFalha = async (motivo: string, stopReason?: string | null, requestId?: string | null) => {
    await supabaseAdmin
      .from("execucoes_ia")
      .update({
        status: "falhou",
        erro: motivo,
        latencia_ms: Date.now() - inicio,
        stop_reason: stopReason ?? null,
        request_id: requestId ?? null,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", execucao.id);
  };

  try {
    const client = obterClienteAnthropic();
    const stream = client.messages.stream({
      model: prompt.modelo_padrao,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: prompt.effort,
        format: zodOutputFormat(OrdemHorariosSchema),
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
            "Horários disponíveis e evidência estrita da ligação estratégica (JSON):\n\n" + entradaSerializada,
        },
      ],
    });

    const mensagemFinal = await stream.finalMessage();
    const requestId = (mensagemFinal as { _request_id?: string | null })._request_id ?? null;

    if (mensagemFinal.stop_reason === "refusal") {
      await marcarFalha(
        `refusal: ${mensagemFinal.stop_details?.category ?? "sem_categoria"}`,
        mensagemFinal.stop_reason,
        requestId,
      );
      throw new Error("recusa_ia_ordenacao_horarios");
    }

    const saida = mensagemFinal.parsed_output;
    const entradaHorarios = new Set(params.slots.map((s) => s.inicio_em));
    const saidaHorarios = saida ? saida.ordenacao.map((o) => o.inicio_em) : [];
    const conjuntoBate =
      saida != null &&
      saidaHorarios.length === entradaHorarios.size &&
      saidaHorarios.every((h) => entradaHorarios.has(h)) &&
      new Set(saidaHorarios).size === saidaHorarios.length;

    if (!conjuntoBate) {
      await marcarFalha(
        "saida_nao_preserva_o_conjunto_de_horarios_recebido",
        mensagemFinal.stop_reason,
        requestId,
      );
      throw new Error("saida_invalida_ordenacao_horarios");
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
        latencia_ms: Date.now() - inicio,
        stop_reason: mensagemFinal.stop_reason,
        request_id: requestId,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", execucao.id);

    const porHorario = new Map(params.slots.map((s) => [s.inicio_em, s]));
    const slots: SlotOrdenado[] = saida!.ordenacao.map((item) => {
      const original = porHorario.get(item.inicio_em)!;
      return { inicio_em: original.inicio_em, fim_em: original.fim_em, motivo_sugestao: item.motivo };
    });

    return { slots, execucaoIaId: execucao.id as string };
  } catch (erro) {
    if (
      erro instanceof Error &&
      (erro.message === "recusa_ia_ordenacao_horarios" || erro.message === "saida_invalida_ordenacao_horarios")
    ) {
      throw erro;
    }
    await marcarFalha(erro instanceof Error ? erro.message : String(erro));
    throw erro;
  }
}
