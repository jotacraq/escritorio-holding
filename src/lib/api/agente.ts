/**
 * Cliente HTTP do agente de WhatsApp (Fase 9) — o contrato entre BACK e FRONT.
 *
 * O FRONT importa daqui e de `@/types/agente`; não monta URL nem `fetch` à mão.
 * Nenhuma função deste arquivo conhece componente, e nenhuma tela conhece a
 * forma das tabelas `agente_whatsapp_*`.
 */
import { chamar } from "./nucleo";
import type { AgenteAcao, AgenteJornada, AgenteResumo } from "@/types/agente";

/** Ficha 360 → aba Conversa: estado do agente, custo do dia e as últimas 20 respostas. */
export function lerAgenteDaJornada(jornadaId: string): Promise<AgenteJornada> {
  return chamar<AgenteJornada>(`/api/jornadas/${jornadaId}/agente-whatsapp`);
}

/**
 * "Assumir conversa" (`assumir`) e "Devolver ao agente" (`devolver`).
 * Reversível pelo mesmo botão — a pausa nunca apaga nada (D25).
 */
export function definirAgenteDaJornada(
  jornadaId: string,
  acao: AgenteAcao,
): Promise<{ pausado: boolean; pausado_ate: string | null }> {
  return chamar(`/api/jornadas/${jornadaId}/agente-whatsapp`, {
    method: "POST",
    body: JSON.stringify({ acao }),
  });
}

/** Admin → aba Agente de WhatsApp. Admin-only no servidor. */
export function lerResumoDoAgente(): Promise<AgenteResumo> {
  return chamar<AgenteResumo>("/api/admin/agente-whatsapp");
}
