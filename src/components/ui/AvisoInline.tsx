import type { ReactNode } from "react";

type Tom = "sucesso" | "aviso" | "erro";

const ESTILOS: Record<Tom, string> = {
  sucesso: "border-transparent bg-verde-fraco text-[color:var(--verde)]",
  aviso: "border-ambar-borda bg-ambar-fraco text-[color:var(--ambar)]",
  erro: "border-vermelho bg-vermelho-fraco text-[color:var(--vermelho)]",
};

/**
 * Aviso inline de resultado de ação (convite criado sem e-mail, versão
 * ativada, falha ao salvar...). Diferente de `<EstadoErro>` (que é para falha
 * de CARGA de dados): este é para o resultado de uma AÇÃO que o usuário
 * acabou de disparar, e fica visível até a próxima ação — nunca some sozinho,
 * porque "linha criada, e-mail indisponível" não pode passar batido.
 *
 * Movido de `components/admin/` (Fase 4, agente L) — é genérico, não só do
 * Admin (a Ficha 360 também usa). O caminho antigo foi removido.
 */
export function AvisoInline({ tom, children }: { tom: Tom; children: ReactNode }) {
  return (
    <p role={tom === "erro" ? "alert" : "status"} className={`rounded-controle border px-3.5 py-2.5 text-sm font-medium ${ESTILOS[tom]}`}>
      {children}
    </p>
  );
}
