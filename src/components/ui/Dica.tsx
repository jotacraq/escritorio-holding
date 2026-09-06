"use client";

import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

interface DicaProps {
  /** O texto da dica — curto, uma frase. */
  texto: ReactNode;
  /** Um único elemento focável (botão, link). Recebe `aria-describedby`. */
  children: ReactElement<Record<string, unknown>>;
  posicao?: "acima" | "abaixo";
}

/**
 * Tooltip acessível: aparece no hover E no foco de teclado, some com Esc,
 * ligado ao gatilho por `aria-describedby` (`role="tooltip"`). O texto da dica
 * nunca é a única forma de entender o gatilho — é complemento.
 *
 * Fase 6, dois consertos medidos no navegador a 390 px:
 *
 * 1. **O balão escondido ocupava espaço.** Ele ficava sempre no DOM, só com
 *    `opacity-0` — e um balão de 256 px centrado num gatilho encostado na
 *    direita empurrava o documento para além da tela. Resultado: rolagem
 *    horizontal em `/hoje` no celular, com QUATRO tooltips invisíveis como
 *    causa. Agora ele só é renderizado quando aparece.
 * 2. **Podia nascer fora da tela.** Depois de montado, o balão se mede e se
 *    desloca para dentro da janela (`--desloque`), mantendo o
 *    `translateX(-50%)` do centramento. Sem isso, dica de gatilho na borda
 *    fica ilegível justamente onde mais se precisa dela: no celular.
 */
export function Dica({ texto, children, posicao = "acima" }: DicaProps) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);
  const balaoRef = useRef<HTMLSpanElement>(null);
  const [desloque, setDesloque] = useState(0);

  // Leitura do DOM depois do layout e antes da pintura: o balão nasce
  // centrado, se mede e corrige a própria posição sem piscar.
  useLayoutEffect(() => {
    if (!visivel) return;
    const el = balaoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margem = 8;
    if (r.right > window.innerWidth - margem) setDesloque(Math.round(window.innerWidth - margem - r.right));
    else if (r.left < margem) setDesloque(Math.round(margem - r.left));
  }, [visivel]);

  function esconder() {
    setVisivel(false);
    setDesloque(0);
  }

  if (!isValidElement(children)) return children;

  const gatilho = cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
    onMouseEnter: (e: unknown) => {
      (children.props.onMouseEnter as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(true);
    },
    onMouseLeave: (e: unknown) => {
      (children.props.onMouseLeave as ((e: unknown) => void) | undefined)?.(e);
      esconder();
    },
    onFocus: (e: unknown) => {
      (children.props.onFocus as ((e: unknown) => void) | undefined)?.(e);
      setVisivel(true);
    },
    onBlur: (e: unknown) => {
      (children.props.onBlur as ((e: unknown) => void) | undefined)?.(e);
      esconder();
    },
    onKeyDown: (e: KeyboardEvent) => {
      (children.props.onKeyDown as ((e: KeyboardEvent) => void) | undefined)?.(e);
      if (e.key === "Escape") esconder();
    },
  });

  return (
    <span className="relative inline-flex">
      {gatilho}
      {visivel && (
        <span
          ref={balaoRef}
          role="tooltip"
          id={id}
          style={{ transform: `translateX(calc(-50% + ${desloque}px))` }}
          className={`anim-esmaecer pointer-events-none absolute left-1/2 z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-controle bg-[color:var(--tinta)] px-3 py-2 text-legenda font-medium leading-snug text-[color:var(--papel-elevado)] shadow-flutuante ${
            posicao === "acima" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {texto}
        </span>
      )}
    </span>
  );
}
