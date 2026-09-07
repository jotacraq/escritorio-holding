"use client";

import type { ReactNode } from "react";

/**
 * A ação principal da tela, fixa na zona do polegar (Fase 8, §C3 M5).
 *
 * No celular, o CTA no topo da página é o CTA que ninguém aperta: a mão
 * segura o aparelho embaixo, e no primeiro paint o que se vê é cabeçalho. A
 * barra resolve pelo caminho contrário — a ação vem até o polegar e fica lá,
 * visível sem rolar, enquanto a pessoa lê o resto.
 *
 * Três cuidados que ela já traz:
 *  - **espaçador no fluxo** — sem ele a barra tapa a última linha da página e
 *    o foco do teclado cai atrás dela (WCAG 2.4.11);
 *  - **acima da `NavInferior`** — o `bottom` acompanha `--altura-nav-inferior`,
 *    que zera sozinho a partir de `md`; as duas nunca se sobrepõem;
 *  - **`nao-imprimir`** — a folha que vai para a reunião não leva botão.
 *
 * ```tsx
 * <BarraAcaoMobile contexto="Passo de agora">
 *   <Botao variante="primario" largo onClick={ligar}>Ligar para a cliente</Botao>
 * </BarraAcaoMobile>
 * ```
 */
export interface BarraAcaoMobileProps {
  /** A ação primária. Uma só — se há duas, a segunda vai em `secundaria`. */
  children: ReactNode;
  /** Ação de apoio, à esquerda da primária. */
  secundaria?: ReactNode;
  /** Uma linha curta acima do botão ("Passo de agora", "3 pendências"). */
  contexto?: string;
  /** Mantém a barra também no desktop. Padrão: só abaixo de `md`. */
  sempre?: boolean;
  className?: string;
}

export function BarraAcaoMobile({ children, secundaria, contexto, sempre = false, className = "" }: BarraAcaoMobileProps) {
  const visibilidade = sempre ? "" : "md:hidden";
  return (
    <>
      {/* Espaçador: reserva no FLUXO a altura que a barra ocupa por cima. */}
      <div aria-hidden="true" className={`h-24 shrink-0 ${visibilidade}`} />
      <div
        className={`nao-imprimir anim-surgir fixed inset-x-0 z-30 border-t border-linha bg-papel-elevado px-3 py-2 shadow-flutuante ${visibilidade} ${className}`}
        style={{ bottom: "calc(var(--altura-nav-inferior) + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-alvo">
          {secundaria}
          <div className="min-w-0 flex-1">
            {contexto && <p className="mb-1 truncate text-legenda text-tinta-fraca">{contexto}</p>}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
