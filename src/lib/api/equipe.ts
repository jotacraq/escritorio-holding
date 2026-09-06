/** Equipe interna e vínculo do login com `perfis`. */
import { chamar, chamarOpcional } from "./nucleo";

export type PapelEquipe = "admin" | "advogada" | "relacionamento" | "assistente";

export interface MembroEquipe {
  id: string;
  nome: string;
  papel: PapelEquipe;
  ativo: boolean;
}

/** ASSUMIDO — necessário para o filtro "responsável" (F2) mostrar nome, não uuid. */
export function listarEquipe() {
  return chamarOpcional<{ itens: MembroEquipe[] }>("/api/equipe");
}

export function vincularAuth() {
  return chamar<{ vinculado: boolean; papel: PapelEquipe | null }>("/api/auth/vincular", { method: "POST" });
}
