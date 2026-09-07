"use client";

import { useEffect, useRef } from "react";

/**
 * Põe o foco no primeiro campo de um formulário que **acabou de aparecer**.
 *
 * Substitui o `autoFocus` do JSX, que a Fase 8 tirou da Ficha (avisos
 * `jsx-a11y/no-autofocus`). A regra do lint não é burocracia: `autoFocus`
 * dispara na MONTAGEM, então ele também rouba o foco quando o formulário já
 * nasce na tela (recarregar a página, voltar do histórico) — e, para quem usa
 * leitor de tela ou tem pouca visão, o cursor pular sozinho para o meio da
 * página é desorientador.
 *
 * O que a pessoa precisa é do outro caso, que continua valendo: **cliquei em
 * "Adicionar familiar" e o formulário surgiu** — aí o foco tem de ir para lá,
 * senão quem só usa teclado fica preso no botão que acabou de sumir. É
 * exatamente isso que este hook faz: foca quando `aberto` passa de `false`
 * para `true`, e só então.
 *
 * ```tsx
 * const refParentesco = useFocoAoAbrir<HTMLInputElement>(novo !== null);
 * <Entrada ref={refParentesco} … />
 * ```
 */
export function useFocoAoAbrir<T extends HTMLElement>(aberto: boolean) {
  const ref = useRef<T>(null);
  const jaFocado = useRef(false);

  useEffect(() => {
    if (!aberto) {
      jaFocado.current = false;
      return;
    }
    if (jaFocado.current) return;
    jaFocado.current = true;
    ref.current?.focus();
  }, [aberto]);

  return ref;
}
