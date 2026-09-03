import type { ButtonHTMLAttributes } from "react";

type Variante = "primario" | "secundario" | "perigo" | "fantasma";

const variantes: Record<Variante, string> = {
  primario: "bg-[color:var(--latao)] text-papel-elevado hover:bg-[color:var(--latao-forte)] border-transparent",
  secundario: "bg-transparent text-tinta border-linha-forte hover:bg-papel-elevado",
  perigo: "bg-transparent text-[color:var(--vermelho)] border-[color:var(--vermelho)] hover:bg-vermelho-fraco",
  fantasma: "bg-transparent text-tinta-suave border-transparent hover:text-tinta hover:bg-papel-elevado",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  carregando?: boolean;
}

export function Botao({ variante = "secundario", carregando, disabled, className = "", children, ...props }: Props) {
  return (
    <button
      type="button"
      disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantes[variante]} ${className}`}
      aria-busy={carregando}
      {...props}
    >
      {carregando && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}
