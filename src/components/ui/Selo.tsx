import type { ReactNode } from "react";

/**
 * Toda funcionalidade não pronta carrega este selo. Stub sem selo é
 * reprovação automática na revisão final (CLAUDE.md do projeto).
 */
export function SeloStub({ texto, className = "" }: { texto: string; className?: string }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-sm border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)] ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
        <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
      </svg>
      <span className="font-medium leading-snug">{texto}</span>
    </div>
  );
}

/** Marca uma linha de seed (`origem_dado = 'exemplo'`) para não confundir com cliente real. */
export function SeloDadoExemplo({ className = "" }: { className?: string }) {
  return (
    <span
      title="Este registro é dado de exemplo (seed de desenvolvimento), não cliente real."
      className={`inline-flex items-center gap-1 rounded-sm border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tinta-fraca ${className}`}
    >
      exemplo
    </span>
  );
}

export function Selo({ tom, children }: { tom: "verde" | "vermelho" | "azul" | "neutro"; children: ReactNode }) {
  const tons: Record<typeof tom, string> = {
    verde: "bg-verde-fraco text-[color:var(--verde)] border-transparent",
    vermelho: "bg-vermelho-fraco text-[color:var(--vermelho)] border-transparent",
    azul: "bg-azul-fraco text-[color:var(--azul)] border-transparent",
    neutro: "bg-papel-elevado text-tinta-suave border-linha",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none ${tons[tom]}`}>{children}</span>
  );
}
