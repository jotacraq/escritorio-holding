/**
 * PDF do material pós-sessão (0055, agente C) — `GET` URL assinada (300 s)
 * e `POST` regerar em `/api/jornadas/[id]/material/[materialId]/pdf`.
 * 404 `pdf_indisponivel` = ainda sem arquivo; 409 `material_nao_aprovado` =
 * rascunho nunca vira PDF; 503 = sem service_role no servidor.
 */
import { chamar } from "./api";
import type { RespostaAprovarMaterial, RespostaUrlPdfMaterial } from "@/types/material";

export function buscarUrlPdfMaterial(jornadaId: string, materialId: string): Promise<RespostaUrlPdfMaterial> {
  return chamar<RespostaUrlPdfMaterial>(`/api/jornadas/${jornadaId}/material/${materialId}/pdf`);
}

export function regerarPdfMaterial(jornadaId: string, materialId: string): Promise<RespostaAprovarMaterial> {
  return chamar<RespostaAprovarMaterial>(`/api/jornadas/${jornadaId}/material/${materialId}/pdf`, { method: "POST" });
}
