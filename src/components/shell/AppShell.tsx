"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { TemaToggle } from "./TemaToggle";
import { PaletaComandos } from "@/components/comandos/PaletaComandos";

function BotaoBuscar({ comTexto = true }: { comTexto?: boolean }) {
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current opacity-80">
        <path d="M8.5 3a5.5 5.5 0 1 0 3.42 9.83l3.63 3.62a1 1 0 0 0 1.41-1.41l-3.62-3.63A5.5 5.5 0 0 0 8.5 3Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" />
      </svg>
      {comTexto ? (
        <>
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
        </>
      ) : (
        <span className="sr-only">Buscar pessoa ou tela</span>
      )}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
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

  // U7 — Ctrl+K / Cmd+K abre a paleta de comandos de qualquer tela.
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        setPaletaAberta(true);
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

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
        <span className="font-serif text-base font-bold">SIC-HF</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaletaAberta(true)}
            className="flex items-center rounded-sm border border-linha p-2 text-tinta"
          >
            <BotaoBuscar comTexto={false} />
          </button>
          <TemaToggle />
        </div>
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
            <span className="font-serif text-xl font-bold leading-tight text-tinta">SIC-HF</span>
          </Link>
          <p className="mt-0.5 text-[11px] leading-snug text-tinta-fraca">Dra. Elaine Montenegro · Time Holding Brasil</p>
        </div>
        <button
          type="button"
          onClick={() => setPaletaAberta(true)}
          className="hidden items-center gap-2 rounded-sm border border-linha px-3 py-2 text-sm text-tinta-suave transition-colors hover:border-linha-forte hover:bg-papel-elevado hover:text-tinta lg:flex"
        >
          <BotaoBuscar />
        </button>
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

      <PaletaComandos aberta={paletaAberta} aoFechar={() => setPaletaAberta(false)} />
    </div>
  );
}
