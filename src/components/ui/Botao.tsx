import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variante = "primario" | "secundario" | "perigo" | "fantasma";
type Tamanho = "normal" | "compacto" | "grande";

/* Primário = CTA de marca (pílula laranja com aresta inferior, mesma forma do
   CTA do seminário). Texto sempre `--latao-cta-texto` (escuro, fixo: 6,41:1
   sobre `#ff7400`) — nunca claro. Só o primário tem a forma de CTA: os
   outros são ações de suporte, com raio de controle, e não competem.
   Cada variante carrega seu próprio raio (Tailwind v4 resolve precedência
   pela ordem do CSS gerado, não pela ordem na string). */
const variantes: Record<Variante, string> = {
  primario:
    "rounded-pilula border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] hover:-translate-y-px hover:bg-[color:var(--latao-cta-forte)] hover:shadow-[0_4px_0_0_var(--latao-cta-forte),0_0.625rem_1.5rem_rgba(255,116,0,0.28)] active:translate-y-px active:shadow-none",
  secundario:
    "rounded-controle border-linha-controle bg-papel-elevado text-tinta hover:border-[color:var(--latao)] hover:text-[color:var(--latao)] active:bg-papel",
  perigo:
    "rounded-controle border-[color:var(--vermelho)] bg-transparent text-[color:var(--vermelho)] hover:bg-vermelho-fraco active:bg-vermelho-fraco",
  fantasma:
    "rounded-controle border-transparent bg-transparent text-tinta-suave hover:bg-papel hover:text-tinta active:bg-linha",
};

/* Alvo mínimo de 44px em todos os tamanhos (`compacto` mantém 44px de altura
   com menos padding lateral — cabe em cabeçalho de cartão sem virar alvo
   pequeno). Fonte nunca abaixo de 15px (`text-sm` remapeado). */
const tamanhos: Record<Tamanho, string> = {
  normal: "min-h-11 px-5 py-2 text-sm",
  compacto: "min-h-11 px-3.5 py-1.5 text-sm",
  grande: "min-h-14 px-7 py-3 text-corpo",
};

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  /** Mostra o giro e bloqueia clique — o feedback de <100ms que toda ação precisa dar. */
  carregando?: boolean;
  /** Ícone (SVG 20×20 já `aria-hidden`) à esquerda do texto. */
  icone?: ReactNode;
  /** Botão ocupando a largura toda (formulários, CTA de login). */
  largo?: boolean;
}

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = "secundario", tamanho = "normal", carregando, icone, largo, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 border font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:shadow-none ${variantes[variante]} ${tamanhos[tamanho]} ${largo ? "w-full" : ""} ${className}`}
      aria-busy={carregando || undefined}
      {...props}
    >
      {carregando ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        icone
      )}
      {children}
    </button>
  );
});
