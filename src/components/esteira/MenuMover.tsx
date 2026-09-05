"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EtapaJornada, EtapaOrdem } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";

const ICONE_MOVER = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10h14M12 5l5 5-5 5" />
  </svg>
);

/**
 * "Mover para…" — o caminho sem mouse (e sem arrastar) para trocar a etapa de
 * uma jornada. Botão de 44px sempre visível (nada de aparecer só no hover: a
 * Dra. Elaine não descobre função escondida), menu com itens de 44px,
 * setas/Home/End navegam, Esc e clique fora fecham, foco volta ao botão.
 */
export function MenuMover({
  etapaAtual,
  etapas,
  ocupado,
  aoEscolher,
  rotulo = "Mover para…",
}: {
  etapaAtual: EtapaJornada;
  etapas: EtapaOrdem[];
  ocupado: boolean;
  aoEscolher: (etapa: EtapaJornada) => void;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const idMenu = useId();
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const destinos = etapas.filter((e) => e.etapa !== etapaAtual);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(evento: MouseEvent) {
      if (!raizRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        setAberto(false);
        botaoRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    const primeiro = raizRef.current?.querySelector<HTMLElement>("[role=menuitem]");
    primeiro?.focus();
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function navegar(evento: React.KeyboardEvent<HTMLUListElement>) {
    const itens = Array.from(evento.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
    const indice = itens.indexOf(document.activeElement as HTMLElement);
    let proximo: number | null = null;
    if (evento.key === "ArrowDown") proximo = (indice + 1) % itens.length;
    if (evento.key === "ArrowUp") proximo = (indice - 1 + itens.length) % itens.length;
    if (evento.key === "Home") proximo = 0;
    if (evento.key === "End") proximo = itens.length - 1;
    if (proximo !== null) {
      evento.preventDefault();
      itens[proximo]?.focus();
    }
  }

  return (
    <div ref={raizRef} className="relative">
      <Botao
        ref={botaoRef}
        variante="fantasma"
        tamanho="compacto"
        icone={ICONE_MOVER}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        carregando={ocupado}
        onClick={() => setAberto((v) => !v)}
      >
        {rotulo}
      </Botao>
      {aberto && (
        <ul
          id={idMenu}
          role="menu"
          aria-label="Mover para a etapa"
          onKeyDown={navegar}
          className="anim-surgir absolute right-0 z-20 mt-1 w-60 rounded-controle border border-linha bg-papel-elevado py-1.5 shadow-flutuante"
        >
          {destinos.map((destino) => (
            <li key={destino.etapa} role="none">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setAberto(false);
                  aoEscolher(destino.etapa);
                }}
                className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-sm text-tinta transition-colors duration-[var(--transicao-rapida)] hover:bg-papel focus-visible:bg-papel"
              >
                <span className="text-legenda font-medium tabular-nums text-tinta-fraca">{destino.ordem}</span>
                {destino.rotulo}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
