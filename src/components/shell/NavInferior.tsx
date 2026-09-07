"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICONES_NAVEGACAO, ITENS_NAVEGACAO, itemAtivo } from "./Nav";

/**
 * Barra inferior do celular (Fase 8, §C3 M1).
 *
 * As MESMAS cinco entradas do menu lateral, na MESMA ordem, com os MESMOS
 * rótulos — é a "harmonia desktop ↔ celular" que o João pediu. O que muda é o
 * container, não a informação (Material 3 chama isso de component swapping).
 *
 * Duas decisões que não são de gosto:
 *  - **rótulo sempre visível**, nunca só ícone. Ícone sozinho obriga a
 *    adivinhar, e a pessoa de 55+ que usa isto entre uma reunião e outra não
 *    tem por que decorar cinco pictogramas (regra do adendo do João, e a lei
 *    "nenhum ícone sem rótulo" do §12 do DS);
 *  - **hambúrguer não é navegação principal.** Ele continua existindo para o
 *    resto (busca, tema, usuário); as cinco áreas ficam a um toque.
 *
 * Some a partir de `md`, onde a lateral assume. O espaçador é irmão da barra
 * para o conteúdo não terminar embaixo dela — e para o foco do teclado não
 * cair atrás dela (WCAG 2.4.11).
 */
export function NavInferior() {
  const rota = usePathname();
  return (
    <>
      <div aria-hidden="true" className="shrink-0 md:hidden" style={{ height: "calc(var(--altura-nav-inferior) + env(safe-area-inset-bottom, 0px))" }} />
      <nav
        /* Nome diferente do `<nav>` da lateral de propósito: a lateral continua
           no DOM abaixo de `lg` (fechada por transform), e dois landmarks de
           navegação com o MESMO nome deixam quem usa leitor de tela sem saber
           em qual entrou (axe `landmark-unique`). */
        aria-label="Áreas do sistema"
        className="nao-imprimir fixed inset-x-0 bottom-0 z-40 border-t border-linha bg-papel-elevado md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="flex items-stretch justify-around">
          {ITENS_NAVEGACAO.map((item) => {
            const ativo = itemAtivo(rota, item.href);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={ativo ? "page" : undefined}
                  /* `px-0.5`: a 360px cada item tem 72px, e com `px-1` o rótulo
                     mais longo ("Mensagens") era cortado em "Mensage…". Rótulo
                     truncado é meio rótulo — a lei do §12.1 pede o nome inteiro. */
                  className={`flex h-full min-h-11 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 ${
                    ativo ? "text-[color:var(--latao)]" : "text-tinta-suave"
                  }`}
                  style={{ minHeight: "var(--altura-nav-inferior)" }}
                >
                  {/* A barrinha no topo do item ativo é a segunda pista, além
                      da cor e do peso do rótulo: estado nunca só por cor. */}
                  <span
                    aria-hidden="true"
                    className={`h-0.5 w-6 rounded-full ${ativo ? "bg-[color:var(--latao-cta)]" : "bg-transparent"}`}
                  />
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current">
                    {ICONES_NAVEGACAO[item.icone]}
                  </svg>
                  {/* O rótulo cresce com a escala do usuário ATÉ onde couber
                      inteiro. A 360px cada item tem 72px: em "Grande" (15,4px)
                      "Mensagens" era cortado em "Mensage…", e rótulo cortado é
                      meio rótulo. `clamp` resolve sem escolher um dos dois —
                      piso 12px (o mínimo absoluto do DS §6), teto 3,2vw (11,5px a 360px, então
                      o piso vence e fica 12px; 13,8px num aparelho de 430px), e no meio a escala.
                      Medido no navegador, não estimado. */}
                  <span
                    className={`w-full truncate text-center leading-tight ${ativo ? "font-bold" : "font-medium"}`}
                    style={{ fontSize: "clamp(0.75rem, calc(0.75rem * var(--fator-escala)), 3.2vw)" }}
                  >
                    {item.rotulo}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
