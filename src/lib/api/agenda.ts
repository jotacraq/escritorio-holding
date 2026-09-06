/** Agendamentos da Sessão de Viabilidade. */
import { chamar, chamarOpcional, paraQueryString } from "./nucleo";
import type { ViaPresencaConfirmada } from "@/types/banco";

export type StatusAgendamento = "agendado" | "confirmado" | "realizado" | "nao_compareceu" | "cancelado" | "remarcado";

export interface Agendamento {
  id: string;
  sessao_id: string;
  jornada_id?: string;
  pessoa_nome?: string;
  inicio_em: string;
  fim_em: string;
  status: StatusAgendamento;
  origem: "equipe" | "cliente" | "ia";
  observacoes: string | null;
  advogada_id?: string | null;
  /** 0051 (Fase 4). Opcionais: `undefined` = coluna ainda não existe no banco
   * (as telas checam `hasOwnProperty`); `null` = aguardando confirmação do
   * cliente — não confundir com `status='confirmado'` (C23). */
  presenca_confirmada_em?: string | null;
  presenca_confirmada_via?: ViaPresencaConfirmada | null;
}

/** ASSUMIDO — F7 exige lista global de próximos agendamentos; §3 só tem criar/atualizar por jornada. */
export function listarProximosAgendamentos(params: { de?: string; ate?: string } = {}) {
  return chamarOpcional<{ itens: Agendamento[] }>(`/api/agendamentos${paraQueryString(params)}`);
}

export function criarAgendamento(jornadaId: string, payload: { inicio_em: string; fim_em: string; advogada_id?: string }) {
  return chamar<{ agendamento: Agendamento }>(`/api/jornadas/${jornadaId}/agendamentos`, { method: "POST", body: JSON.stringify(payload) });
}

export function atualizarAgendamento(id: string, payload: { status?: StatusAgendamento; inicio_em?: string; fim_em?: string }) {
  return chamar<{ agendamento: Agendamento }>(`/api/agendamentos/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
