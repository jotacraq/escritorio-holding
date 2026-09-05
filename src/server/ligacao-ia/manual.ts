import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { LigacaoIa } from "@/types/integracoes";
import type { ContextoDisparo, ProvedorLigacaoIa, ResultadoDisparo } from "./tipos";

/**
 * Adaptador manual: NÃO liga. Cria uma tarefa humana rotulada em `tarefas`
 * (origem 'sistema', tipo 'ligar_para_agendar' — coluna da 0052) e encerra a
 * ligação como `concluida`/`manual`. Nunca falha em silêncio: sem config de
 * n8n, a equipe vê exatamente por quê na descrição da tarefa.
 */
export const TITULO_TAREFA_LIGAR = "Ligar para agendar a Sessão de Viabilidade";
export const TIPO_TAREFA_LIGAR = "ligar_para_agendar";

export const MOTIVOS_MANUAL: Record<string, string> = {
  provedor_manual: "Ligação por IA em modo manual (Admin → Integrações: ligacao_ia.provedor = manual).",
  n8n_nao_configurado:
    "Ligação por IA não configurada: falta N8N_WEBHOOK_LIGACAO_URL, LIGACAO_IA_WEBHOOK_SECRET ou VAPI_ASSISTENTE_ID no servidor. Vira tarefa para a equipe ligar.",
  sem_horarios:
    "Sem horários ofertáveis na agenda (sem advogada na sessão ou sem disponibilidade aberta). A IA não liga sem horário para oferecer.",
  sem_link: "Não foi possível emitir o link de agendamento (LINK_PUBLICO_PEPPER ausente?).",
  fallback_sem_link:
    "A ligação por IA não agendou e não foi possível enviar o link de agendamento. Ligue e marque à mão.",
};

function descricaoTarefa(ctx: ContextoDisparo): string {
  const motivo = MOTIVOS_MANUAL[ctx.motivoManual ?? "provedor_manual"] ?? ctx.motivoManual ?? "";
  const linhas = [motivo, `Telefone: ${ctx.ligacao.telefone}`];
  if (ctx.oferta && ctx.oferta.horarios.length > 0) {
    linhas.push("Horários ofertáveis (os mesmos do link /p/a):");
    ctx.oferta.horarios.slice(0, 4).forEach((h, i) => linhas.push(`${i + 1}. ${h.rotulo}`));
    if (ctx.oferta.url) linhas.push(`Link para o cliente escolher: ${ctx.oferta.url}`);
  }
  linhas.push(`Ligação por IA #${ctx.ligacao.id.slice(0, 8)} (tentativa ${ctx.ligacao.tentativa}).`);
  return linhas.join("\n");
}

/**
 * Insere a tarefa. Se `tarefas.tipo` (0052, agente A) ainda não existir no
 * banco, repete sem a coluna — a tarefa continua aparecendo pelo título.
 */
export async function criarTarefaLigarParaAgendar(
  admin: SupabaseClient,
  params: { jornadaId: string; responsavelId: string | null; descricao: string },
): Promise<string | null> {
  const vence = new Date();
  vence.setDate(vence.getDate() + 1);
  const base = {
    jornada_id: params.jornadaId,
    titulo: TITULO_TAREFA_LIGAR,
    descricao: params.descricao,
    responsavel_id: params.responsavelId,
    vence_em: vence.toISOString().slice(0, 10),
    origem: "sistema",
  };

  const primeira = await admin.from("tarefas").insert({ ...base, tipo: TIPO_TAREFA_LIGAR }).select("id").single();
  if (!primeira.error) return (primeira.data as { id: string }).id;

  if (primeira.error.code === "42703" || /column .*tipo/i.test(primeira.error.message)) {
    const segunda = await admin.from("tarefas").insert(base).select("id").single();
    if (!segunda.error) return (segunda.data as { id: string }).id;
    registrarErro("ligacao-ia/manual.criarTarefa#sem_tipo", segunda.error, { jornada_id: params.jornadaId });
    return null;
  }
  // Índice único parcial (jornada, tipo) aberto — já existe tarefa aberta: não duplica.
  if (primeira.error.code === "23505") {
    const { data } = await admin
      .from("tarefas")
      .select("id")
      .eq("jornada_id", params.jornadaId)
      .is("concluida_em", null)
      .eq("titulo", TITULO_TAREFA_LIGAR)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }
  registrarErro("ligacao-ia/manual.criarTarefa", primeira.error, { jornada_id: params.jornadaId });
  return null;
}

export const provedorManual: ProvedorLigacaoIa = {
  nome: "manual",
  configurado: () => true,
  faltam: () => [],
  async disparar(ctx): Promise<ResultadoDisparo> {
    const tarefaId = await criarTarefaLigarParaAgendar(ctx.admin, {
      jornadaId: ctx.ligacao.jornada_id,
      responsavelId: ctx.responsavelId,
      descricao: descricaoTarefa(ctx),
    });
    const motivo = MOTIVOS_MANUAL[ctx.motivoManual ?? "provedor_manual"] ?? ctx.motivoManual ?? null;
    const { error } = await ctx.admin
      .from("ligacoes_ia")
      .update({
        status: "concluida",
        resultado: "manual",
        encerrada_em: new Date().toISOString(),
        resumo: motivo,
        erro: tarefaId ? null : "tarefa_nao_criada",
      } satisfies Partial<LigacaoIa>)
      .eq("id", ctx.ligacao.id);
    if (error) throw new Error(`falha_ao_encerrar_manual: ${error.message}`);
    return { tipo: "manual", tarefa_id: tarefaId };
  },
};
