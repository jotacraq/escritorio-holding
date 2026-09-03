import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { executarComAuditoria } from "@/server/ia/executar";
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
 *
 * A checagem de conjunto é regra de DOMÍNIO desta função, não algo que o
 * schema Zod (nem `executarComAuditoria`) sabe validar sozinho — por isso
 * roda depois, e se falhar, corrige `execucoes_ia` de volta para `falhou`
 * (a execução já foi gravada `concluida` por `executarComAuditoria`).
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
  const entrada = {
    horarios_disponiveis: params.slots.map((s) => s.inicio_em),
    evidencia: params.evidencia,
  };

  const { execucaoId, saida } = await executarComAuditoria(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT,
    jornadaId: params.jornadaId,
    criadoPor: params.criadoPor,
    entrada,
    prefixoUsuario: "Horários disponíveis e evidência estrita da ligação estratégica (JSON):",
    schema: OrdemHorariosSchema,
    nomeSchema: CHAVE_PROMPT,
    maxTokens: 4000,
  });

  const entradaHorarios = new Set(params.slots.map((s) => s.inicio_em));
  const saidaHorarios = saida.ordenacao.map((o) => o.inicio_em);
  const conjuntoBate =
    saidaHorarios.length === entradaHorarios.size &&
    saidaHorarios.every((h) => entradaHorarios.has(h)) &&
    new Set(saidaHorarios).size === saidaHorarios.length;

  if (!conjuntoBate) {
    await supabaseAdmin
      .from("execucoes_ia")
      .update({ status: "falhou", erro: "saida_nao_preserva_o_conjunto_de_horarios_recebido" })
      .eq("id", execucaoId);
    throw new Error("saida_invalida_ordenacao_horarios");
  }

  const porHorario = new Map(params.slots.map((s) => [s.inicio_em, s]));
  const slots: SlotOrdenado[] = saida.ordenacao.map((item) => {
    const original = porHorario.get(item.inicio_em)!;
    return { inicio_em: original.inicio_em, fim_em: original.fim_em, motivo_sugestao: item.motivo };
  });

  return { slots, execucaoIaId: execucaoId };
}
