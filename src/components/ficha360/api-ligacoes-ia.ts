/**
 * Ligação por IA (0053, agente B) — `POST /api/jornadas/[id]/ligacoes-ia`
 * ("Ligar por IA agora") e `POST /api/ligacoes-ia/[id]/cancelar`. 503 =
 * integração não configurada (sem `N8N_WEBHOOK_LIGACAO_URL`/
 * `LIGACAO_IA_WEBHOOK_SECRET` ou sem service_role) — a tela rotula, não
 * esconde.
 */
import { chamar } from "./api";
import type { LigacaoIa, RespostaLigacaoIa, RespostaListarLigacoesIa } from "@/types/integracoes";

export function listarLigacoesIa(jornadaId: string): Promise<LigacaoIa[]> {
  return chamar<RespostaListarLigacoesIa>(`/api/jornadas/${jornadaId}/ligacoes-ia`).then((d) => d.itens);
}

export function ligarPorIaAgora(jornadaId: string): Promise<RespostaLigacaoIa> {
  return chamar<RespostaLigacaoIa>(`/api/jornadas/${jornadaId}/ligacoes-ia`, { method: "POST" });
}

export function cancelarLigacaoIa(ligacaoId: string): Promise<LigacaoIa> {
  return chamar<RespostaLigacaoIa>(`/api/ligacoes-ia/${ligacaoId}/cancelar`, { method: "POST" }).then((d) => d.ligacao);
}
