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
 */
export function AvisoInline({ tom, children }: { tom: Tom; children: React.ReactNode }) {
  return (
    <p role={tom === "erro" ? "alert" : "status"} className={`rounded-sm border px-3 py-2 text-sm font-medium ${ESTILOS[tom]}`}>
      {children}
    </p>
  );
}
