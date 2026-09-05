"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Campo de formulário: rótulo sempre visível, ajuda e erro ligados ao
 * controle por `aria-describedby`, `aria-invalid` quando há erro. O controle
 * (`Entrada`/`Selecao`/`AreaTexto`) lê o contexto do `Campo` para pegar
 * `id` e descrições — nada de repetir id em cada tela.
 *
 * Alvo mínimo 44px, fonte 16px (também evita o zoom automático do iOS),
 * borda 3:1 (`--linha-controle`), foco = contorno + halo laranja.
 */
interface ContextoCampo {
  id: string;
  describedBy?: string;
  invalido: boolean;
}
const Contexto = createContext<ContextoCampo | null>(null);

interface CampoProps {
  rotulo: ReactNode;
  /** Explicação curta abaixo do rótulo — "o que colocar aqui". */
  ajuda?: ReactNode;
  /** Mensagem de erro humana, sempre dizendo o que fazer. */
  erro?: ReactNode;
  obrigatorio?: boolean;
  /** Texto à direita do rótulo (ex.: "opcional", contador). */
  extra?: ReactNode;
  /** Passe o `id` só se precisar de âncora externa; senão é gerado. */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Campo({ rotulo, ajuda, erro, obrigatorio, extra, id: idExterno, className = "", children }: CampoProps) {
  const idGerado = useId();
  const id = idExterno ?? idGerado;
  const idAjuda = `${id}-ajuda`;
  const idErro = `${id}-erro`;
  const describedBy = [ajuda ? idAjuda : null, erro ? idErro : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-bold text-tinta">
          {rotulo}
          {obrigatorio && (
            <span className="ml-1 text-[color:var(--latao)]" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {extra && <span className="text-legenda text-tinta-fraca">{extra}</span>}
      </div>
      {ajuda && (
        <p id={idAjuda} className="text-xs text-tinta-suave">
          {ajuda}
        </p>
      )}
      <Contexto.Provider value={{ id, describedBy, invalido: Boolean(erro) }}>{children}</Contexto.Provider>
      {erro && (
        <p id={idErro} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-[color:var(--vermelho)]">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-current">
            <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V7a1 1 0 0 0-1-1Zm0 7.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
          </svg>
          {erro}
        </p>
      )}
    </div>
  );
}

const CLASSE_CONTROLE =
  "w-full rounded-controle border bg-papel-elevado px-3.5 text-corpo text-tinta placeholder:text-tinta-fraca transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] focus:border-[color:var(--latao)] focus:outline-none focus:shadow-foco disabled:cursor-not-allowed disabled:bg-papel disabled:opacity-70";

function classesDoControle(invalido: boolean, className: string) {
  return `${CLASSE_CONTROLE} ${invalido ? "border-[color:var(--vermelho)]" : "border-linha-controle"} ${className}`;
}

function useCampo(idProprio?: string, describedByProprio?: string) {
  const ctx = useContext(Contexto);
  return {
    id: idProprio ?? ctx?.id,
    describedBy: [ctx?.describedBy, describedByProprio].filter(Boolean).join(" ") || undefined,
    invalido: ctx?.invalido ?? false,
  };
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalido?: boolean }>(function Entrada(
  { className = "", id, invalido: invalidoProprio, ...props },
  ref,
) {
  const campo = useCampo(id, props["aria-describedby"]);
  const invalido = invalidoProprio ?? campo.invalido;
  return (
    <input
      ref={ref}
      id={campo.id}
      aria-describedby={campo.describedBy}
      aria-invalid={invalido || undefined}
      className={`min-h-11 py-2 ${classesDoControle(invalido, className)}`}
      {...props}
    />
  );
});

export const Selecao = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalido?: boolean }>(function Selecao(
  { className = "", id, invalido: invalidoProprio, children, ...props },
  ref,
) {
  const campo = useCampo(id, props["aria-describedby"]);
  const invalido = invalidoProprio ?? campo.invalido;
  return (
    <div className="relative">
      <select
        ref={ref}
        id={campo.id}
        aria-describedby={campo.describedBy}
        aria-invalid={invalido || undefined}
        className={`min-h-11 appearance-none py-2 pr-10 ${classesDoControle(invalido, className)}`}
        {...props}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-suave" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8l5 5 5-5" />
      </svg>
    </div>
  );
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalido?: boolean }>(function AreaTexto(
  { className = "", id, invalido: invalidoProprio, rows = 4, ...props },
  ref,
) {
  const campo = useCampo(id, props["aria-describedby"]);
  const invalido = invalidoProprio ?? campo.invalido;
  return (
    <textarea
      ref={ref}
      id={campo.id}
      rows={rows}
      aria-describedby={campo.describedBy}
      aria-invalid={invalido || undefined}
      className={`min-h-[6.5rem] resize-y py-2.5 leading-relaxed ${classesDoControle(invalido, className)}`}
      {...props}
    />
  );
});

/**
 * Opção de escolha (rádio ou caixa) com alvo grande e rótulo clicável —
 * para listas de escolha onde um input nu de 13px é impossível de acertar.
 */
export function Opcao({
  tipo = "radio",
  rotulo,
  descricao,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { tipo?: "radio" | "checkbox"; rotulo: ReactNode; descricao?: ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-controle border border-linha-forte bg-papel-elevado px-3.5 py-2.5 transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] has-[:checked]:border-[color:var(--latao)] has-[:checked]:bg-latao-fraco has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${className}`}
    >
      <input id={id} type={tipo} className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--latao-cta)]" {...props} />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-tinta">{rotulo}</span>
        {descricao && <span className="text-xs text-tinta-suave">{descricao}</span>}
      </span>
    </label>
  );
}
