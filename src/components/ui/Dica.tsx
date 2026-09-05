"use client";

import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";

interface DicaProps {
  /** O texto da dica — curto, uma frase. */
  texto: ReactNode;
  /** Um único elemento focável (botão, link). Recebe `aria-describedby`. */
  children: ReactElement<Record<string, unknown>>;
  posicao?: "acima" | "abaixo";
}

/**
 * Tooltip acessível: aparece no hover E no foco de teclado, some com Esc,
 * ligado ao gatilho por `aria-describedby` (`role="tooltip"`). O texto da
 * dica nunca é a única forma de entender o gatilho — é complemento.
 */
export function Dica({ texto, children, posicao = "acima" }: DicaProps) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);

  if (!isValidElement(children)) return children;

  const gatilho = cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
    onMouseEnter: (e: unknown) => {
      (children.props.onMouseEnter as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(true);
    },
    onMouseLeave: (e: unknown) => {
      (children.props.onMouseLeave as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(false);
    },
    onFocus: (e: unknown) => {
      (children.props.onFocus as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(true);
    },
    onBlur: (e: unknown) => {
      (children.props.onBlur as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(false);
    },
    onKeyDown: (e: KeyboardEvent) => {
      (children.props.onKeyDown as ((e: KeyboardEvent) => void) | undefined)?.(e);
      if (e.key === "Escape") setVisivel(false);
    },
  });

  return (
    <span className="relative inline-flex">
      {gatilho}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-controle bg-[color:var(--tinta)] px-3 py-2 text-xs font-medium leading-snug text-[color:var(--papel-elevado)] shadow-flutuante transition-[opacity,transform] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] ${
          posicao === "acima" ? "bottom-full mb-2" : "top-full mt-2"
        } ${visivel ? "opacity-100" : "opacity-0"} ${visivel ? "translate-y-0" : posicao === "acima" ? "translate-y-1" : "-translate-y-1"}`}
      >
        {texto}
      </span>
    </span>
  );
}
