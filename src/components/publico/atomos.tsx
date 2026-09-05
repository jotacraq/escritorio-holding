import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Átomos das páginas públicas (`/p/**`) — a cara do seminário
 * (`guardioesdolegado.com.br/ak1`): creme no fundo (vem do layout), cartão
 * branco de raio 1.25rem com sombra marrom, rótulo pequeno em caixa alta +
 * título grande, CTA em pílula laranja com texto ESCURO. Tudo em tokens de
 * `globals.css` (`.area-publica` redeclara o tema claro), nenhum hex aqui.
 *
 * Quem toca é o cliente da Dra. Elaine, no celular, muitas vezes com 60+
 * anos: alvo ≥ 52px nos botões, fonte ≥ 16px, um único CTA por tela.
 */

type VarianteBotaoPublico = "primario" | "secundario";

const BASE_BOTAO =
  "inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-pilula px-7 text-center text-base font-bold leading-tight transition-[background-color,border-color,box-shadow,transform,opacity] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0";

const VARIANTES_BOTAO: Record<VarianteBotaoPublico, string> = {
  primario:
    "border-2 border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] uppercase tracking-[0.05em] shadow-[0_4px_0_0_var(--latao-cta-forte),0_0.625rem_1.5rem_rgba(255,116,0,0.28)] hover:-translate-y-px hover:bg-[color:var(--latao-cta-forte)] active:translate-y-px active:shadow-none",
  secundario: "border-2 border-linha-forte bg-papel-elevado text-tinta hover:border-[color:var(--latao-cta)] active:bg-papel",
};

export function classesBotaoPublico(variante: VarianteBotaoPublico, largo = false, className = ""): string {
  return `${BASE_BOTAO} ${VARIANTES_BOTAO[variante]} ${largo ? "w-full" : ""} ${className}`;
}

export interface BotaoPublicoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotaoPublico;
  /** Giro + bloqueio de clique — feedback imediato de que o toque foi recebido. */
  carregando?: boolean;
  largo?: boolean;
  icone?: ReactNode;
}

export const BotaoPublico = forwardRef<HTMLButtonElement, BotaoPublicoProps>(function BotaoPublico(
  { variante = "secundario", carregando, largo, icone, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={classesBotaoPublico(variante, largo, className)}
      {...props}
    >
      {carregando ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icone}
      {children}
    </button>
  );
});

/** Mesma forma do botão, para navegação (`<a>`). */
export function LinkBotaoPublico({
  variante = "secundario",
  largo,
  className = "",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variante?: VarianteBotaoPublico; largo?: boolean }) {
  return (
    <a className={`botao ${classesBotaoPublico(variante, largo, className)}`} {...props}>
      {children}
    </a>
  );
}

/** Rótulo pequeno em caixa alta acima do título — a "seção" do seminário. */
export function RotuloPublico({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-rotulo font-medium uppercase text-tinta-fraca ${className}`}>{children}</p>;
}

/** Cartão branco, raio grande, sombra marrom — a superfície do seminário. */
export function CartaoPublico({
  children,
  className = "",
  como: Tag = "div",
  realce,
}: {
  children: ReactNode;
  className?: string;
  como?: "div" | "section" | "article";
  /** Filete lateral por estado — o único lugar em que o cartão fala cor. */
  realce?: "verde" | "ambar" | "vermelho";
}) {
  const filete =
    realce === "verde"
      ? "border-l-4 border-l-[color:var(--verde)]"
      : realce === "ambar"
        ? "border-l-4 border-l-ambar-borda"
        : realce === "vermelho"
          ? "border-l-4 border-l-[color:var(--vermelho)]"
          : "";
  return <Tag className={`rounded-cartao border border-linha bg-papel-elevado px-5 py-6 shadow-cartao sm:px-8 sm:py-8 ${filete} ${className}`}>{children}</Tag>;
}

/** Ícone de "feito" — o mesmo nas três telas de conclusão (formulário, agendamento, confirmação). */
export function IconeFeito({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-verde-fraco ${className}`}>
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 fill-none stroke-[color:var(--verde)] stroke-[2.5]">
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
      </svg>
    </span>
  );
}

const CONTATO_WHATSAPP = process.env.NEXT_PUBLIC_CONTATO_WHATSAPP?.trim() || null;
const CONTATO_EMAIL = process.env.NEXT_PUBLIC_CONTATO_EMAIL?.trim() || null;

/**
 * Como falar com a equipe — nunca um número/e-mail inventado. Sem
 * `NEXT_PUBLIC_CONTATO_*` configurado, a orientação é "fale com quem te mandou
 * este link", verdadeira em qualquer cenário. Links em tinta escura com
 * sublinhado laranja: o laranja puro sobre branco não passa AA como texto.
 */
export function ContatoEquipe({ antes = "Precisa de ajuda?" }: { antes?: string }) {
  if (!CONTATO_WHATSAPP && !CONTATO_EMAIL) {
    return (
      <p className="text-sm text-tinta-suave">
        {antes} Fale com quem te enviou este link — a equipe da Dra. Elaine Montenegro.
      </p>
    );
  }
  return (
    <p className="text-sm text-tinta-suave">
      {antes}{" "}
      {CONTATO_WHATSAPP && (
        <>
          WhatsApp{" "}
          <a
            href={`https://wa.me/${CONTATO_WHATSAPP.replace(/\D/g, "")}`}
            className="inline-flex min-h-11 items-center font-bold text-tinta underline decoration-[color:var(--latao-cta)] decoration-2 underline-offset-4"
          >
            {CONTATO_WHATSAPP}
          </a>
        </>
      )}
      {CONTATO_WHATSAPP && CONTATO_EMAIL && " ou "}
      {CONTATO_EMAIL && (
        <>
          e-mail{" "}
          <a href={`mailto:${CONTATO_EMAIL}`} className="inline-flex min-h-11 items-center font-bold text-tinta underline decoration-[color:var(--latao-cta)] decoration-2 underline-offset-4">
            {CONTATO_EMAIL}
          </a>
        </>
      )}
      .
    </p>
  );
}
