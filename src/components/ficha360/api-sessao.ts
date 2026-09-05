/**
 * Sessão de Viabilidade na Ficha 360 (Fase 4 §1.2/§1.3): presença confirmada
 * pela equipe e link da sala colado à mão.
 *
 * - Presença: `PATCH /api/agendamentos/[id] {presenca_confirmada: true}`
 *   (agente A) — reusa o cliente da Agenda para as duas telas falarem com a
 *   MESMA rota e o mesmo tratamento de erro.
 * - Sala: `PATCH /api/jornadas/[id]/sessao {link_sala}` (agente K, Onda 3)
 *   — Zod (https absoluta) + `respostaErro`, no mesmo padrão das demais
 *   escritas. Os triggers da 0051 (`app.carimba_link_sala` →
 *   `origem='manual'` + `link_sala_atualizado_em`; `app.timeline_link_sala`)
 *   continuam carimbando no banco; a rota não manda origem. Substitui a
 *   escrita direta pelo cliente Supabase do navegador (H, Onda 2).
 */
import type { SessaoViabilidade } from "@/lib/api";
import { chamar } from "./api";

export { confirmarPresencaPelaEquipe } from "@/components/agenda/api-agendamentos";

/** Só URL https — o mesmo mínimo que o webhook do n8n exige (`link_sala https`). */
export function linkSalaValido(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  try {
    const url = new URL(limpo);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 422 link inválido · 404 jornada · 409 `sessao_inexistente` (ainda sem
 * sessão 1:1) · 409 `migracao_pendente` (0051 ausente) — todos chegam como
 * `ErroFicha360Api` com a mensagem humana da rota. `inalterada: true` quando
 * o link já era esse (sem escrita, sem evento de timeline).
 */
export function gravarLinkSala(jornadaId: string, linkSala: string | null): Promise<{ sessao: SessaoViabilidade; inalterada?: true }> {
  return chamar<{ sessao: SessaoViabilidade; inalterada?: true }>(`/api/jornadas/${encodeURIComponent(jornadaId)}/sessao`, {
    method: "PATCH",
    body: JSON.stringify({ link_sala: linkSala }),
  });
}
