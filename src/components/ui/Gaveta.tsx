"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface GavetaProps {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  /** Rótulo pequeno em caixa alta acima do título (ex.: nome do cliente). */
  rotulo?: string;
  /** Uma linha explicando o que se faz aqui. */
  descricao?: string;
  /** Barra fixa no rodapé — onde vive o botão de salvar. */
  rodape?: ReactNode;
  /** `larga` para formulários com duas colunas. */
  largura?: "normal" | "larga";
  children: ReactNode;
}

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * "Camada 2" do padrão de navegação: painel lateral para ver/preencher UMA
 * coisa sem sair da Pasta do Cliente. `role="dialog"`, `aria-modal`, Esc
 * fecha, foco preso, foco devolvido a quem abriu, clique no véu fecha (o X
 * sempre está visível e com alvo ≥ 44px).
 */
export function Gaveta({ aberta, aoFechar, titulo, rotulo, descricao, rodape, largura = "normal", children }: GavetaProps) {
  const tituloId = useId();
  const descricaoId = useId();
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
      const painel = painelRef.current;
      if (!painel) return;
      const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)).filter((el) => el.offsetParent !== null);
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (evento.shiftKey) {
        if (ativo === primeiro || !painel.contains(ativo)) {
          evento.preventDefault();
          ultimo.focus();
        }
      } else if (ativo === ultimo || !painel.contains(ativo)) {
        evento.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberta, aoFechar]);

  if (!aberta) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" onClick={aoFechar} className="anim-esmaecer absolute inset-0 bg-[color:var(--veu)]" />
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descricao ? descricaoId : undefined}
        className={`anim-deslizar-direita relative flex h-full w-full flex-col bg-papel-elevado shadow-flutuante sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-cartao ${
          largura === "larga" ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-linha px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {rotulo && <p className="text-rotulo font-medium uppercase text-tinta-fraca">{rotulo}</p>}
            <h2 id={tituloId} className="text-titulo font-bold text-tinta">
              {titulo}
            </h2>
            {descricao && (
              <p id={descricaoId} className="mt-1 text-sm text-tinta-suave">
                {descricao}
              </p>
            )}
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-linha-forte px-3 text-sm font-medium text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
              <path d="M5.29 5.29a1 1 0 0 1 1.42 0L10 8.59l3.29-3.3a1 1 0 1 1 1.42 1.42L11.41 10l3.3 3.29a1 1 0 0 1-1.42 1.42L10 11.41l-3.29 3.3a1 1 0 0 1-1.42-1.42L8.59 10l-3.3-3.29a1 1 0 0 1 0-1.42Z" />
            </svg>
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {rodape && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-linha bg-papel px-5 py-3 sm:rounded-b-cartao sm:px-6">{rodape}</div>}
      </div>
    </div>
  );
}
