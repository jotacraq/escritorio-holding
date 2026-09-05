/**
 * Diagnóstico da SV (0058, agente D) — `GET/POST/PATCH /api/jornadas/[id]/diagnostico`.
 * POST monta versão nova por função pura (zero IA); PATCH edita só a versão
 * atual (blocos por chave, visibilidade por bloco, aprovação). 409:
 * `bloco_interno` (o_que_falta nunca é visível — B31), `bloco_desconhecido`,
 * `diagnostico_invalido`, `sem_permissao`.
 */
import { chamar } from "./api";
import type { CorpoEditarDiagnostico, DiagnosticoSv, RespostaDiagnosticoJornada } from "@/types/cenario";

export function buscarDiagnostico(jornadaId: string): Promise<RespostaDiagnosticoJornada> {
  return chamar<RespostaDiagnosticoJornada>(`/api/jornadas/${jornadaId}/diagnostico`);
}

export function montarDiagnostico(jornadaId: string): Promise<DiagnosticoSv> {
  return chamar<{ diagnostico: DiagnosticoSv }>(`/api/jornadas/${jornadaId}/diagnostico`, { method: "POST" }).then((d) => d.diagnostico);
}

export function editarDiagnostico(jornadaId: string, corpo: CorpoEditarDiagnostico): Promise<DiagnosticoSv> {
  return chamar<{ diagnostico: DiagnosticoSv }>(`/api/jornadas/${jornadaId}/diagnostico`, {
    method: "PATCH",
    body: JSON.stringify(corpo),
  }).then((d) => d.diagnostico);
}

export const ROTULO_ERRO_DIAGNOSTICO: Record<string, string> = {
  bloco_interno: "O bloco “O que falta” é interno e nunca fica visível ao cliente.",
  bloco_desconhecido: "Este bloco não existe na versão atual — recarregue a tela.",
  diagnostico_invalido: "O banco recusou o conteúdo do diagnóstico. Confira os campos e tente de novo.",
  sem_permissao: "Só admin ou advogada monta o diagnóstico.",
};
