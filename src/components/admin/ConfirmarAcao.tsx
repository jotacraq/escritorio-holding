"use client";

import { useEffect, useId, useRef } from "react";
import { Botao } from "@/components/ui/Botao";

interface Props {
  aberto: boolean;
  titulo: string;
  /** O efeito por extenso, em português — regra do projeto: nunca esconder o que a ação faz. */
  efeito: string;
  rotuloConfirmar?: string;
  confirmando?: boolean;
  perigo?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

/**
 * Confirmação para ação destrutiva ou de efeito amplo (ativar prompt novo,
 * reprocessar webhook, desativar acesso...). Regra do briefing da tarefa:
 * o efeito vai escrito por extenso, nunca "tem certeza?" genérico.
 */
export function ConfirmarAcao({ aberto, titulo, efeito, rotuloConfirmar = "Confirmar", confirmando, perigo, aoConfirmar, aoCancelar }: Props) {
  const tituloId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    containerRef.current?.focus();
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoCancelar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoCancelar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={aoCancelar}>
      <div
        ref={containerRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="w-full max-w-sm rounded-sm border border-linha-forte bg-papel-elevado p-5 shadow-lg outline-none"
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 id={tituloId} className="font-serif text-lg font-semibold text-tinta">
          {titulo}
        </h2>
        <p className="mt-2 text-sm text-tinta-suave">{efeito}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="fantasma" onClick={aoCancelar} disabled={confirmando}>
            Cancelar
          </Botao>
          <Botao variante={perigo ? "perigo" : "primario"} onClick={aoConfirmar} carregando={confirmando}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}
