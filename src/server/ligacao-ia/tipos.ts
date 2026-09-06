import type { SupabaseClient } from "@supabase/supabase-js";
import type { HorarioOfertadoIa, LigacaoIa, ProvedorLigacaoIaNome } from "@/types/integracoes";

/** Os horários que a IA pode oferecer — SEMPRE os de `agendamentos_sugestoes` do link. */
export interface OfertaHorarios {
  link_id: string;
  /** URL completa `/p/a/<token>`; só existe se o token foi minerado neste processo. */
  url: string | null;
  horarios: HorarioOfertadoIa[]; // ordenados por posicao; [0] = melhor horário
}

export interface ContextoDisparo {
  admin: SupabaseClient;
  ligacao: LigacaoIa;
  nome: string;
  responsavelId: string | null;
  oferta: OfertaHorarios | null;
  /** Por que caiu no manual (rotulado na tarefa). */
  motivoManual?: string;
}

export type ResultadoDisparo =
  | { tipo: "disparada"; id_externo: string | null }
  | { tipo: "manual"; tarefa_id: string | null };

export interface ProvedorLigacaoIa {
  nome: ProvedorLigacaoIaNome;
  configurado(): boolean;
  /** Nomes de env vars que faltam — nunca valores. */
  faltam(): string[];
  disparar(ctx: ContextoDisparo): Promise<ResultadoDisparo>;
}

export const STATUS_TERMINAIS = new Set(["concluida", "sem_resposta", "falhou", "cancelada"]);
export const LIMITE_LOTE_FILA = 10;

/**
 * Colunas de `ligacoes_ia` que a EQUIPE (cliente `authenticated`) pode ler.
 * Desde a 0073b o grant de SELECT é por coluna — `token_link_cifrado` fica de
 * fora de propósito — e `select("*")` responde 42501. Toda leitura com o
 * cliente do usuário passa por aqui; o cliente `service_role` continua livre.
 */
export const CAMPOS_LIGACAO_IA_EQUIPE = [
  "id",
  "jornada_id",
  "provedor",
  "status",
  "tentativa",
  "nao_antes_de",
  "telefone",
  "origem",
  "solicitada_por",
  "link_id",
  "id_externo",
  "disparada_em",
  "atendida_em",
  "encerrada_em",
  "duracao_segundos",
  "resultado",
  "horario_escolhido",
  "agendamento_id",
  "transcricao",
  "resumo",
  "gravacao_url",
  "custo_usd",
  "erro",
  "expurgado_em",
  "criado_em",
  "atualizado_em",
] as const;

export const COLUNAS_LIGACAO_IA_EQUIPE = CAMPOS_LIGACAO_IA_EQUIPE.join(", ");

/**
 * Recorta uma linha vinda do cliente `service_role` (que lê `*`) para o que a
 * equipe pode ver. Existe porque um FALLBACK não pode ser mais permissivo que o
 * caminho feliz: se a releitura projetada falha, a resposta ainda assim não
 * pode carregar `token_link_cifrado` (achado I1 do pentest, 06/09/2026).
 */
export function projetarParaEquipe(linha: LigacaoIa): LigacaoIa {
  const bruta = linha as unknown as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const campo of CAMPOS_LIGACAO_IA_EQUIPE) {
    if (campo in bruta) saida[campo] = bruta[campo];
  }
  return saida as unknown as LigacaoIa;
}
