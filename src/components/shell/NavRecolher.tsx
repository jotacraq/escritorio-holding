"use client";

import { useEffect, useState } from "react";

/**
 * Recolher/expandir a navegação lateral do desktop (pedido do Marcio,
 * 14/09: "corrija a navbar, para poder RECOLHER a navbar e poder puxar ela
 * de volta"). A lateral come ~256px fixos — caro na tela de Conduzir Sessão,
 * que já briga por espaço horizontal para o mosaico de quadros.
 *
 * Mesma técnica de `EscalaTexto.tsx` (Fase 8): atributo no `documentElement`
 * (`data-nav-recolhida`), aplicado por SCRIPT INLINE antes do 1º paint — sem
 * isso a lateral nasceria expandida e encolheria de repente na frente de
 * quem já tinha escolhido recolher, na tela inteira do sistema (não só
 * nesta rota: é o MESMO shell para todas as telas — B71 vale aqui também,
 * "nada desloca conteúdo sob o dedo").
 *
 * Só afeta `lg:` (desktop) — no celular a lateral já é uma gaveta que abre
 * por cima (`AppShell.tsx`, `gavetaAberta`), problema diferente, solução
 * diferente; este controle nem aparece abaixo de `lg`.
 */

export const CHAVE_NAV_RECOLHIDA = "sic-hf-nav-recolhida";

export const SCRIPT_NAV_RECOLHIDA_INICIAL = `
(function () {
  try {
    var salvo = localStorage.getItem('${CHAVE_NAV_RECOLHIDA}');
    if (salvo === '1') document.documentElement.setAttribute('data-nav-recolhida', '1');
  } catch (erro) {
    /* sem localStorage — nasce expandida, que é o padrão seguro */
  }
})();
`;

function lerRecolhidaAtual(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-nav-recolhida") === "1";
}

/** Ícone de seta dupla — aponta para o lado que a ação VAI abrir (para
 * dentro = recolher, para fora = expandir), não um hambúrguer genérico. */
function IconeRecolher({ recolhida }: { recolhida: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {recolhida ? <path d="M7.5 4.5 13 10l-5.5 5.5M4 4.5v11" /> : <path d="M12.5 4.5 7 10l5.5 5.5M16 4.5v11" />}
    </svg>
  );
}

/**
 * Botão de alternância — vive no topo da lateral (`AppShell.tsx`), sempre
 * visível e alcançável por Tab tanto recolhida quanto expandida (é o único
 * jeito de "puxar ela de volta"). `aria-pressed` comunica o estado a leitor
 * de tela; o rótulo textual muda com o estado, nunca só o ícone.
 */
export function NavRecolher() {
  const [recolhida, setRecolhida] = useState(false);

  useEffect(() => {
    // Leitura do DOM depois de montar — mesmo padrão de `EscalaTexto`: no
    // servidor não há `document`, decidir no 1º render causaria descompasso
    // de hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecolhida(lerRecolhidaAtual());
  }, []);

  function alternar() {
    const proximo = !recolhida;
    document.documentElement.setAttribute("data-nav-recolhida", proximo ? "1" : "0");
    setRecolhida(proximo);
    try {
      window.localStorage.setItem(CHAVE_NAV_RECOLHIDA, proximo ? "1" : "0");
    } catch {
      // Sem armazenamento, a escolha vale só para esta visita e nada quebra.
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={recolhida}
      title={recolhida ? "Expandir menu" : "Recolher menu"}
      className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-tinta lg:flex"
    >
      <IconeRecolher recolhida={recolhida} />
      <span className="sr-only">{recolhida ? "Expandir menu" : "Recolher menu"}</span>
    </button>
  );
}
