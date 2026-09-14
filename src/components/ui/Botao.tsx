import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variante = "primario" | "secundario" | "perigo" | "fantasma";
type Tamanho = "normal" | "compacto" | "grande";

/* Primário = CTA de marca. Migração GPS-THB (14/09/2026, B2): retângulo
   CHAPADO — sem `rounded-pilula`, sem aresta 3D (`shadow-[0_3px_0_0_…]`),
   sem `hover:-translate-y-px`, sem transição de posição. Vira `rounded-
   controle` (`--raio-controle`), como os outros botões — só a cor de fundo
   distingue o primário agora, não mais a forma. Texto sempre
   `--latao-cta-texto` (escuro, fixo: 6,41:1 sobre `#ff7400`) — nunca claro.
   Cada variante carrega seu próprio raio (Tailwind v4 resolve precedência
   pela ordem do CSS gerado, não pela ordem na string). */
const variantes: Record<Variante, string> = {
  primario:
    "rounded-controle border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] hover:bg-[color:var(--latao-cta-forte)]",
  secundario:
    "rounded-controle border-linha-controle bg-papel-elevado text-tinta hover:border-[color:var(--latao)] hover:text-[color:var(--latao)] active:bg-papel",
  perigo:
    "rounded-controle border-[color:var(--vermelho)] bg-transparent text-[color:var(--vermelho)] hover:bg-vermelho-fraco active:bg-vermelho-fraco",
  fantasma:
    "rounded-controle border-transparent bg-transparent text-tinta-suave hover:bg-papel hover:text-tinta active:bg-linha",
};

/* Alvo mínimo de 44px em todos os tamanhos (`compacto` mantém 44px de altura
   com menos padding lateral — cabe em cabeçalho de cartão sem virar alvo
   pequeno). */
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
      className={`inline-flex items-center justify-center gap-2 border font-medium transition-[background-color,color,border-color] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] disabled:cursor-not-allowed disabled:opacity-50 ${variantes[variante]} ${tamanhos[tamanho]} ${largo ? "w-full" : ""} ${className}`}
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
