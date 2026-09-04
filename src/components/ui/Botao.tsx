import type { ButtonHTMLAttributes } from "react";

type Variante = "primario" | "secundario" | "perigo" | "fantasma";

/* Primário = CTA de marca (fidelidade total ao seminário, decisão do Marcio,
   04/09/2026): `--latao-cta` é o laranja puro `#ff7400` nos dois temas —
   token separado de `--latao` (que no interno também serve de texto/borda,
   ver `globals.css`). Texto sempre `--latao-cta-texto` (`#141b22`, fixo,
   escuro) — nunca `--tinta`/`--papel-elevado`, que se invertem por tema e
   reprovariam contraste sobre laranja no escuro (medido: 2,23:1). Pílula +
   aresta inferior sólida + halo: mesma forma do CTA público (`globals.css`
   `.area-publica button[...]`), reaplicada aqui via classes utilitárias
   porque o botão interno não vive dentro do escopo `.area-publica`.
   Demais variantes (secundário/perigo/fantasma) NÃO mudam de forma — só o
   primário é CTA de marca; os outros são ações de suporte/neutras, e trocar
   a forma deles também viraria ruído (todo botão parecendo CTA). */
/* Raio por variante (não na base): Tailwind v4 não garante que `rounded-sm`
   fixo na string-base perca para `rounded-full` da variante por posição no
   className — a ordem de precedência é a de declaração no CSS gerado, não a
   da string. Cada variante carrega seu próprio raio para não depender disso. */
const variantes: Record<Variante, string> = {
  primario:
    "rounded-full border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] hover:bg-[color:var(--latao-cta-forte)] hover:shadow-none active:translate-y-[1px] active:shadow-none",
  secundario: "rounded-sm bg-transparent text-tinta border-linha-forte hover:bg-papel-elevado",
  perigo: "rounded-sm bg-transparent text-[color:var(--vermelho)] border-[color:var(--vermelho)] hover:bg-vermelho-fraco",
  fantasma: "rounded-sm bg-transparent text-tinta-suave border-transparent hover:text-tinta hover:bg-papel-elevado",
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
      className={`inline-flex items-center justify-center gap-2 border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantes[variante]} ${className}`}
      aria-busy={carregando}
      {...props}
    >
      {carregando && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}
