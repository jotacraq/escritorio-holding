import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variante = "secundario" | "perigo" | "fantasma" | "cta";

/* Mesmas classes visuais de `ui/Botao` (secundário/perigo/fantasma), mas em
   um `<a>` — navegação é `<a>`, ação é `<button>` (regra de a11y do agente
   frontend). `cta` = a pílula laranja do primário, para o único link forte de
   um bloco ("Contatar agora"). Alvo ≥ 44px em todos. */
const VARIANTES: Record<Variante, string> = {
  secundario: "rounded-controle border-linha-controle bg-papel-elevado text-tinta hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]",
  perigo: "rounded-controle border-[color:var(--vermelho)] bg-transparent text-[color:var(--vermelho)] hover:bg-vermelho-fraco",
  fantasma: "rounded-controle border-transparent bg-transparent text-tinta-suave hover:bg-papel hover:text-tinta",
  cta: "rounded-pilula border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] hover:-translate-y-px hover:bg-[color:var(--latao-cta-forte)]",
};

interface Props extends Omit<ComponentProps<typeof Link>, "className"> {
  variante?: Variante;
  tamanho?: "normal" | "compacto";
  icone?: ReactNode;
  className?: string;
}

export function LinkBotao({ variante = "secundario", tamanho = "compacto", icone, className = "", children, ...props }: Props) {
  return (
    <Link
      className={`inline-flex min-h-11 items-center justify-center gap-2 border text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] ${
        tamanho === "compacto" ? "px-3.5 py-1.5" : "px-5 py-2"
      } ${VARIANTES[variante]} ${className}`}
      {...props}
    >
      {icone}
      {children}
    </Link>
  );
}
