import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { CHAVE_DURACAO_PADRAO_MINUTOS, lerConfiguracaoInt } from "./config";
import type { AgendamentoSessao, SessaoViabilidade } from "@/types/banco";

/** Código de exclusion violation do Postgres — a Dra. Elaine não pode estar em duas salas ao mesmo tempo. */
export const SQLSTATE_EXCLUSION_VIOLATION = "23P01";

export interface ResultadoIniciarSessaoImediata {
  sessao: SessaoViabilidade;
  agendamento: AgendamentoSessao;
  /** `true` quando um agendamento já vivo agora foi reaproveitado — nenhum INSERT novo. */
  reaproveitado: boolean;
}

/**
 * Garante `sessoes_viabilidade` (1:1 com a jornada, cria na primeira vez) e
 * um `agendamentos` "vivo agora" para ela — o miolo de "Iniciar sessão agora"
 * (17/09/2026, Fatia 1), reusado por `POST /api/jornadas/[id]/agendamentos`
 * (`modo: "imediato"`) e por `POST /api/jornadas/[id]/sessao/iniciar`.
 *
 * 🔴 IDEMPOTÊNCIA POR JANELA, NÃO POR ADVOGADA: `IniciarSessaoAgora.tsx` não
 * manda `advogada_id` (grava `null`), e a `EXCLUDE CONSTRAINT`
 * `ex_agenda_sem_sobreposicao` (0008:36) é `(advogada_id with =, tstzrange
 * &&)` — NULL nunca conflita com NULL no Postgres, então a exclusion fica
 * INERTE nesse fluxo: clicar "Iniciar sessão agora" duas vezes criaria dois
 * agendamentos silenciosos. Corrigido aqui — e NÃO preenchendo `advogada_id`,
 * o que mudaria a EXCLUDE para todo o fluxo normal de agendar (decisão de
 * escopo própria, fora desta fatia) — buscando antes um agendamento já VIVO
 * AGORA da MESMA sessão (`status in ('agendado','confirmado')` e o intervalo
 * contém `now()`). Achou → reaproveita. Não achou → insere.
 */
export async function iniciarSessaoImediata(
  supabase: SupabaseClient,
  params: { jornadaId: string; advogadaId?: string | null; observacoes?: string | null },
): Promise<ResultadoIniciarSessaoImediata> {
  const { data: sessaoExistente, error: erroSessao } = await supabase
    .from("sessoes_viabilidade")
    .select("*")
    .eq("jornada_id", params.jornadaId)
    .maybeSingle();
  if (erroSessao) throw erroSessao;

  let sessao = sessaoExistente as SessaoViabilidade | null;

  if (!sessao) {
    const { data: novaSessao, error: erroCriarSessao } = await supabase
      .from("sessoes_viabilidade")
      .insert({ jornada_id: params.jornadaId, advogada_id: params.advogadaId ?? null })
      .select("*")
      .single();
    if (erroCriarSessao) {
      registrarErro("server/agenda/iniciar-sessao.iniciarSessaoImediata sessao", erroCriarSessao, { jornada_id: params.jornadaId });
      throw erroCriarSessao;
    }
    sessao = novaSessao as SessaoViabilidade;
  }

  const agora = new Date().toISOString();
  const { data: agendamentoVivo, error: erroVivo } = await supabase
    .from("agendamentos")
    .select("*")
    .eq("sessao_id", sessao.id)
    .in("status", ["agendado", "confirmado"])
    .lte("inicio_em", agora)
    .gt("fim_em", agora)
    .maybeSingle();
  if (erroVivo) throw erroVivo;

  if (agendamentoVivo) {
    return { sessao, agendamento: agendamentoVivo as AgendamentoSessao, reaproveitado: true };
  }

  // Mesma leitura de `POST /api/disponibilidades` — `padrao` só cobre chave
  // ausente/falha pontual, nunca mascara um valor real diferente do padrão.
  const fimEm = new Date(Date.now() + (await lerConfiguracaoInt(supabase, CHAVE_DURACAO_PADRAO_MINUTOS, 60)) * 60_000).toISOString();

  const { data: agendamento, error } = await supabase
    .from("agendamentos")
    .insert({
      sessao_id: sessao.id,
      inicio_em: agora,
      fim_em: fimEm,
      advogada_id: params.advogadaId ?? null,
      observacoes: params.observacoes ?? null,
      status: "agendado",
      origem: "equipe",
    })
    .select("*")
    .single();

  if (error) {
    registrarErro("server/agenda/iniciar-sessao.iniciarSessaoImediata agendamento", error, { jornada_id: params.jornadaId, sessao_id: sessao.id });
    throw error;
  }

  return { sessao, agendamento: agendamento as AgendamentoSessao, reaproveitado: false };
}
