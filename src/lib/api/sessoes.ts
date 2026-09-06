/** Sessão de Viabilidade e o relatório que sai dela. */
import { chamar } from "./nucleo";
import type { OrigemLinkSala } from "@/types/banco";

export interface SessaoViabilidade {
  id: string;
  jornada_id: string;
  advogada_id: string | null;
  link_sala: string | null;
  realizada_em: string | null;
  resultado: "fechou" | "nao_fechou" | "indefinido" | null;
  motivo_resultado: string | null;
  /** 0051 (Fase 4) — opcionais pelo mesmo motivo de `Agendamento.presenca_*`. */
  link_sala_origem?: OrigemLinkSala;
  link_sala_atualizado_em?: string | null;
  sala_solicitada_em?: string | null;
}

export interface RelatorioSessao {
  id: string;
  sessao_id: string;
  [campo: string]: unknown;
}

export function buscarRelatorio(jornadaId: string) {
  return chamar<{ relatorio: Record<string, unknown> | null }>(`/api/jornadas/${jornadaId}/relatorio`);
}
export function salvarRelatorio(jornadaId: string, payload: Record<string, unknown>) {
  return chamar<{ relatorio: Record<string, unknown> }>(`/api/jornadas/${jornadaId}/relatorio`, { method: "PUT", body: JSON.stringify(payload) });
}
