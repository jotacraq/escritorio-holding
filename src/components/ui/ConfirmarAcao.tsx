"use client";

import { useEffect, useId, useRef } from "react";
import { Botao } from "./Botao";

interface Props {
  aberto: boolean;
  titulo: string;
  /** O efeito por extenso, em português — regra do projeto: nunca esconder o que a ação faz. */
  efeito: string;
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
  confirmando?: boolean;
  perigo?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

/**
 * "Camada 1" do padrão de navegação: confirmação para ação destrutiva ou de
 * efeito amplo. O efeito vai escrito por extenso, nunca "tem certeza?".
 * `role="alertdialog"`, Esc cancela, foco vai para o botão de cancelar (o
 * caminho seguro) ao abrir e volta a quem abriu ao fechar.
 */
export function ConfirmarAcao({
  aberto,
  titulo,
  efeito,
  rotuloConfirmar = "Confirmar",
  rotuloCancelar = "Cancelar",
  confirmando,
  perigo,
  aoConfirmar,
  aoCancelar,
}: Props) {
  const tituloId = useId();
  const efeitoId = useId();
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => cancelarRef.current?.focus(), 0);
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoCancelar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus();
    };
  }, [aberto, aoCancelar]);

  if (!aberto) return null;

  return (
    <div className="anim-esmaecer fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--veu)] px-4" onClick={aoCancelar}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={efeitoId}
        className="anim-surgir w-full max-w-md rounded-cartao border border-linha bg-papel-elevado p-6 shadow-flutuante"
        onClick={(evento) => evento.stopPropagation()}
      >
        {perigo && <p className="mb-2 text-rotulo font-medium uppercase text-[color:var(--vermelho)]">Não dá para desfazer</p>}
        <h2 id={tituloId} className="text-titulo font-bold text-tinta">
          {titulo}
        </h2>
        <p id={efeitoId} className="mt-2 text-corpo text-tinta-suave">
          {efeito}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Botao ref={cancelarRef} variante="fantasma" onClick={aoCancelar} disabled={confirmando}>
            {rotuloCancelar}
          </Botao>
          <Botao variante={perigo ? "perigo" : "primario"} onClick={aoConfirmar} carregando={confirmando}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}
