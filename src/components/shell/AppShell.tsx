"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Nav } from "./Nav";
import { TemaToggle } from "./TemaToggle";
import { PaletaComandos } from "@/components/comandos/PaletaComandos";
import { ROTULO_PAPEL, useUsuarioAtual } from "@/hooks/useUsuarioAtual";

function IconeBusca({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0 fill-current`}>
      <path d="M8.5 3a5.5 5.5 0 1 0 3.42 9.83l3.63 3.62a1 1 0 0 0 1.41-1.41l-3.62-3.63A5.5 5.5 0 0 0 8.5 3Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" />
    </svg>
  );
}

function Marca({ className = "" }: { className?: string }) {
  return (
    <Link href="/painel" className={`group flex min-h-11 items-center gap-2.5 rounded-controle ${className}`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] shadow-[0_2px_0_0_var(--latao-cta-forte)]">
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5 10 3.5l6.5 5M5.5 9v6.5M10 9v6.5M14.5 9v6.5M4 16.25h12" />
        </svg>
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-corpo font-bold text-tinta">SIC-HF</span>
        <span className="text-legenda text-tinta-fraca">Time Holding Brasil</span>
      </span>
    </Link>
  );
}

function CartaoUsuario() {
  const { usuario, carregando } = useUsuarioAtual();
  if (carregando) {
    return (
      <div className="flex items-center gap-3 px-2" aria-hidden="true">
        <span className="esqueleto h-9 w-9 rounded-full" />
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="esqueleto h-3 w-2/3" />
          <span className="esqueleto h-3 w-1/3" />
        </span>
      </div>
    );
  }
  if (!usuario) return null;
  const nome = usuario.nome ?? usuario.email;
  const inicial = nome.trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-3 px-2" title={usuario.email}>
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-latao-fraco text-sm font-bold text-[color:var(--latao)]">
        {inicial}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-bold text-tinta">{nome}</span>
        <span className="truncate text-legenda text-tinta-suave">{usuario.papel ? ROTULO_PAPEL[usuario.papel] : usuario.email}</span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [teclaAtalho, setTeclaAtalho] = useState("Ctrl K");
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const gavetaRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Leitura única de um sistema externo (o navegador) depois de montar —
    // mesmo caso legítimo de `useTema.ts`: no servidor não há `navigator`, e
    // decidir no render inicial causaria descompasso de hidratação no Mac.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setTeclaAtalho("⌘ K");
  }, []);

  useEffect(() => {
    if (!gavetaAberta) return;
    const overflowOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => gavetaRef.current?.querySelector<HTMLElement>("a, button")?.focus(), 0);
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setGavetaAberta(false);
        botaoMenuRef.current?.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.body.style.overflow = overflowOriginal;
      window.clearTimeout(id);
      document.removeEventListener("keydown", aoTeclar);
    };
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

  const botaoBuscar = (
    <button
      type="button"
      onClick={() => setPaletaAberta(true)}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-controle border border-linha-forte bg-papel-elevado px-3.5 text-sm text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-tinta"
    >
      <IconeBusca className="h-4 w-4 opacity-80" />
      <span className="flex-1 text-left">Buscar cliente…</span>
      <kbd className="rounded-md border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-legenda text-tinta-fraca">{teclaAtalho}</kbd>
    </button>
  );

  const conteudoLateral = (
    <>
      <Marca className="px-2" />
      {botaoBuscar}
      <Nav aoNavegar={() => setGavetaAberta(false)} />
      <div className="mt-auto flex flex-col gap-3 border-t border-linha pt-4">
        <CartaoUsuario />
        {/* Alinhado à direita, de propósito: o canto inferior esquerdo é onde o
            indicador de dev do Next se ancora, e os dois não podem se sobrepor. */}
        <div className="flex justify-end px-2">
          <TemaToggle />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <a
        href="#conteudo-principal"
        className="sr-only z-[70] rounded-controle bg-papel-elevado px-4 py-3 text-sm font-bold text-tinta shadow-flutuante focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Pular para o conteúdo
      </a>

      {/* Topo — só no celular/tablet. */}
      <header className="nao-imprimir sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-linha bg-papel px-3 py-2 lg:hidden">
        <button
          ref={botaoMenuRef}
          type="button"
          aria-expanded={gavetaAberta}
          aria-controls="navegacao-lateral"
          onClick={() => setGavetaAberta((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado text-tinta"
        >
          <span className="sr-only">{gavetaAberta ? "Fechar menu" : "Abrir menu"}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
            <path d="M2.5 5h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Zm0 6h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Zm0 6h15a1 1 0 1 0 0-2h-15a1 1 0 0 0 0 2Z" />
          </svg>
        </button>
        <Marca />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaletaAberta(true)}
            className="flex h-11 w-11 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado text-tinta"
          >
            <span className="sr-only">Buscar cliente ou tela</span>
            <IconeBusca />
          </button>
          <TemaToggle compacto />
        </div>
      </header>

      {gavetaAberta && (
        <button
          type="button"
          aria-label="Fechar menu"
          tabIndex={-1}
          onClick={() => setGavetaAberta(false)}
          className="nao-imprimir anim-esmaecer fixed inset-0 z-30 bg-[color:var(--veu)] lg:hidden"
        />
      )}

      <aside
        id="navegacao-lateral"
        ref={gavetaRef}
        aria-label="Menu"
        className={`nao-imprimir z-40 flex w-[19rem] max-w-[88vw] shrink-0 flex-col gap-5 overflow-y-auto border-r border-linha bg-papel px-3 py-5 transition-transform duration-[var(--transicao-normal)] ease-[var(--suavizacao)] lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:translate-x-0 lg:px-4 lg:py-6 ${
          gavetaAberta ? "fixed inset-y-0 left-0 translate-x-0 shadow-flutuante" : "fixed inset-y-0 left-0 -translate-x-full lg:relative lg:shadow-none"
        }`}
      >
        {conteudoLateral}
      </aside>

      <main id="conteudo-principal" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <PaletaComandos aberta={paletaAberta} aoFechar={() => setPaletaAberta(false)} />
    </div>
  );
}
