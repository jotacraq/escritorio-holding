import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverModoIa } from "@/server/ia/demonstracao";
import { registrarErro } from "@/server/erros";
import type { SlotDisponivel } from "@/types/agenda";
import { CHAVE_SLOTS_OFERTADOS_AO_CLIENTE, lerConfiguracaoInt } from "./config";
import { listarSlotsDisponiveis } from "./slots";
import { ordenarSlotsPorIa } from "./ordenar-horarios";

export interface ItemSugestao {
  inicio_em: string;
  fim_em: string;
  posicao: number;
  motivo_sugestao: string | null;
  execucao_ia_id: string | null;
}

export interface ResultadoGerarSugestoes {
  itens: ItemSugestao[];
  ordenadoPorIa: boolean;
}

/**
 * PONTO DE INTEGRAÇÃO com B-1A: `POST /api/jornadas/[id]/links` (fronteira
 * deles, `src/server/publico/**`) deve chamar isto quando `tipo === 'agendamento'`
 * para obter as linhas de `agendamentos_sugestoes` a gravar junto com o link
 * recém-criado, na mesma transação. Esta função NÃO GRAVA a tabela — só
 * calcula. Exige `supabaseAdmin` (service_role): tanto a leitura de
 * `execucoes_ia`/`prompts_versoes` quanto qualquer INSERT em
 * `agendamentos_sugestoes`/`execucoes_ia` não têm policy para `authenticated`
 * (mesma razão de `briefings`/`execucoes_ia`, 0009: conteúdo derivado não pode
 * ser forjado por quem está logado).
 *
 * CONFLITO C10 (ARQUITETURA-FASE-2.md §4.2/§6): sem ligação estratégica
 * registrada para a jornada, a ordem é cronológica pura e `motivo_sugestao`
 * fica `null` em toda linha — nenhuma chamada de IA acontece, custo zero, e a
 * tela nunca usa a palavra "sugestão". Com ligação e IA configurada
 * (`resolverModoIa() === 'real'`) e sem o cooldown de custo ativo
 * (`app.pode_executar_ia`, 0027), a ordem vem de `ordenarSlotsPorIa`. Qualquer
 * falha no caminho de IA (recusa, saída inválida, erro de rede, cooldown
 * ativo, chave ausente) degrada para cronológica em vez de derrubar a emissão
 * do link inteira — a REGRA DE OURO é "nunca invente", não "nunca funcione
 * sem IA".
 */
export async function gerarSugestoesAgendamento(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; advogadaId: string; criadoPor: string | null },
): Promise<ResultadoGerarSugestoes> {
  const quantidade = await lerConfiguracaoInt(supabaseAdmin, CHAVE_SLOTS_OFERTADOS_AO_CLIENTE, 6);
  const todosOsSlots = await listarSlotsDisponiveis(supabaseAdmin, { advogadaId: params.advogadaId });
  const candidatos: SlotDisponivel[] = todosOsSlots.slice(0, Math.max(quantidade, 0));

  const cronologico = (): ResultadoGerarSugestoes => ({
    itens: candidatos.map((s, indice) => ({
      inicio_em: s.inicio_em,
      fim_em: s.fim_em,
      posicao: indice + 1,
      motivo_sugestao: null,
      execucao_ia_id: null,
    })),
    ordenadoPorIa: false,
  });

  if (candidatos.length === 0) {
    return { itens: [], ordenadoPorIa: false };
  }

  const { data: ligacao } = await supabaseAdmin
    .from("ligacoes_estrategicas")
    .select("respostas, preocupacao_principal, ritmo, estilo_resposta, decisores_presentes_na_sessao")
    .eq("jornada_id", params.jornadaId)
    .order("realizada_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Sem evidência (sem ligação registrada), não existe critério — cronológica
  // pura, sem a palavra "sugestão" na tela (CONFLITO C10). Nenhuma chamada de IA.
  if (!ligacao) return cronologico();

  if (resolverModoIa() !== "real") return cronologico();

  const { data: podeExecutar, error: erroCooldown } = await supabaseAdmin.rpc("verificar_cooldown_ia", {
    p_jornada_id: params.jornadaId,
    p_perfil_id: params.criadoPor,
  });
  if (erroCooldown || podeExecutar !== true) return cronologico();

  try {
    const { slots, execucaoIaId } = await ordenarSlotsPorIa(supabaseAdmin, {
      jornadaId: params.jornadaId,
      criadoPor: params.criadoPor,
      slots: candidatos,
      evidencia: ligacao,
    });
    return {
      itens: slots.map((s, indice) => ({
        inicio_em: s.inicio_em,
        fim_em: s.fim_em,
        posicao: indice + 1,
        motivo_sugestao: s.motivo_sugestao,
        execucao_ia_id: execucaoIaId,
      })),
      ordenadoPorIa: true,
    };
  } catch (erro) {
    // A execução já foi marcada 'falhou' em `execucoes_ia` dentro de
    // `ordenarSlotsPorIa`; isto aqui é só o log de aplicação — nunca falha
    // a emissão do link por causa de uma ordenação que não é essencial.
    registrarErro("server/agenda/sugestoes.gerarSugestoesAgendamento", erro, {
      jornada_id: params.jornadaId,
    });
    return cronologico();
  }
}
