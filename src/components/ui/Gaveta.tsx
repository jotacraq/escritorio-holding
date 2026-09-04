"use client";

import { useEffect, useId, useRef } from "react";

interface GavetaProps {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  children: React.ReactNode;
}

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * "Camada 2" do padrão de navegação (arquitetura de informação, Fase 3):
 * painel lateral para ver/preencher UMA coisa sem sair da Pasta do Cliente —
 * ao contrário da Camada 1 (`ConfirmarAcao`, modal central pequeno) e da
 * Camada 3 (página cheia/aba), a Gaveta desliza da borda e deixa a tela de
 * origem "logo ali", coberta só por um véu semi-transparente.
 *
 * Acessibilidade no mesmo padrão de `PaletaComandos.tsx` (a única outra peça
 * do sistema com focus trap completo até aqui): `role="dialog"`,
 * `aria-modal`, Esc fecha, foco preso com Tab/Shift+Tab circulando dentro do
 * painel, foco devolvido a quem abriu ao fechar, clique no véu fecha (mas
 * não é o único jeito — o X sempre está visível e com alvo ≥44px).
 */
export function Gaveta({ aberta, aoFechar, titulo, children }: GavetaProps) {
  const tituloId = useId();
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberta) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    const documentoOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => fecharRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = documentoOriginal;
      window.clearTimeout(id);
      focoAnteriorRef.current?.focus();
    };
  }, [aberta]);

  useEffect(() => {
    if (!aberta) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        aoFechar();
        return;
      }
      if (evento.key !== "Tab") return;

      // Focus trap: Tab/Shift+Tab circulam só dentro do painel — nunca
      // escapam para a Pasta do Cliente visível atrás do véu.
      const painel = painelRef.current;
      if (!painel) return;
      const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;

      if (evento.shiftKey) {
        if (ativo === primeiro || !painel.contains(ativo)) {
          evento.preventDefault();
          ultimo.focus();
        }
      } else {
        if (ativo === ultimo || !painel.contains(ativo)) {
          evento.preventDefault();
          primeiro.focus();
        }
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberta, aoFechar]);

  if (!aberta) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Véu decorativo — clique fora fecha, mas não entra na ordem de tab:
          é um atalho de mouse, não uma ação com nome próprio para o leitor
          de tela navegar via Tab (o foco fica preso dentro do painel). */}
      <div aria-hidden="true" onClick={aoFechar} className="absolute inset-0 bg-black/40" />
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="relative flex h-full w-full max-w-md flex-col border-l border-linha-forte bg-papel-elevado shadow-[var(--sombra-cartao)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-linha px-4 py-3">
          <h2 id={tituloId} className="font-serif text-lg font-semibold text-tinta">
            {titulo}
          </h2>
          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-linha-forte px-3 text-sm font-medium text-tinta-suave hover:bg-papel hover:text-tinta"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
              <path d="M5.29 5.29a1 1 0 0 1 1.42 0L10 8.59l3.29-3.3a1 1 0 1 1 1.42 1.42L11.41 10l3.3 3.29a1 1 0 0 1-1.42 1.42L10 11.41l-3.29 3.3a1 1 0 0 1-1.42-1.42L8.59 10l-3.3-3.29a1 1 0 0 1 0-1.42Z" />
            </svg>
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
