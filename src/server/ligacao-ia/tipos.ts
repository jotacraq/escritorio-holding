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
