"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { TemaToggle } from "./TemaToggle";

export function AppShell({ children }: { children: ReactNode }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!gavetaAberta) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setGavetaAberta(false);
        botaoMenuRef.current?.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [gavetaAberta]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Topo mobile */}
      <header className="nao-imprimir flex items-center justify-between border-b border-linha bg-papel px-4 py-3 lg:hidden">
        <button
          ref={botaoMenuRef}
          type="button"
          aria-expanded={gavetaAberta}
          aria-controls="navegacao-lateral"
          onClick={() => setGavetaAberta((v) => !v)}
          className="rounded-sm border border-linha p-2 text-tinta"
        >
          <span className="sr-only">Abrir menu de navegação</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
            <path d="M2.5 5h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Zm0 6h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Zm0 6h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Z" />
          </svg>
        </button>
        <span className="font-serif text-base font-semibold">SIC-HF</span>
        <TemaToggle />
      </header>

      {gavetaAberta && (
        <button
          aria-label="Fechar menu"
          onClick={() => setGavetaAberta(false)}
          className="nao-imprimir fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      <aside
        id="navegacao-lateral"
        className={`nao-imprimir z-40 flex w-64 shrink-0 flex-col gap-6 border-r border-linha bg-papel px-4 py-6 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          gavetaAberta ? "fixed inset-y-0 left-0 translate-x-0" : "fixed inset-y-0 left-0 -translate-x-full lg:relative"
        }`}
      >
        <div className="hidden px-2 lg:block">
          <Link href="/esteira" className="block">
            <span className="font-serif text-xl font-semibold leading-tight text-tinta">SIC-HF</span>
          </Link>
          <p className="mt-0.5 text-[11px] leading-snug text-tinta-fraca">Dra. Elaine Montenegro · Time Holding Brasil</p>
        </div>
        <Nav aoNavegar={() => setGavetaAberta(false)} />
        {/* Alinhado à direita, de propósito: o canto inferior esquerdo é onde o
            indicador de dev do Next se ancora, e os dois não podem se sobrepor. */}
        <div className="relative z-10 mt-auto hidden px-2 lg:flex lg:items-center lg:justify-end">
          <TemaToggle />
        </div>
      </aside>

      <main id="conteudo-principal" className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}
