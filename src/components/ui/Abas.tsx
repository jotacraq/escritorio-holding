"use client";

import { useRef, useState, type ReactNode } from "react";

export interface DefinicaoAba {
  id: string;
  rotulo: string;
  conteudo: ReactNode;
}

/**
 * Navegação por abas em estilo "guia de pasta" — o dossiê físico do escritório
 * virou o modelo da navegação da Ficha 360. role=tablist com setas do teclado.
 */
export function Abas({ abas, abaInicial }: { abas: DefinicaoAba[]; abaInicial?: string }) {
  const [ativa, setAtiva] = useState(abaInicial ?? abas[0]?.id);
  const referencias = useRef<Record<string, HTMLButtonElement | null>>({});

  function aoTeclar(evento: React.KeyboardEvent, indice: number) {
    if (evento.key !== "ArrowRight" && evento.key !== "ArrowLeft") return;
    evento.preventDefault();
    const proximo = evento.key === "ArrowRight" ? (indice + 1) % abas.length : (indice - 1 + abas.length) % abas.length;
    const id = abas[proximo].id;
    setAtiva(id);
    referencias.current[id]?.focus();
  }

  const abaAtual = abas.find((a) => a.id === ativa) ?? abas[0];

  return (
    <div>
      <div role="tablist" aria-label="Seções da ficha" className="nao-imprimir flex flex-wrap gap-0.5 border-b border-linha">
        {abas.map((aba, indice) => {
          const selecionada = aba.id === ativa;
          return (
            <button
              key={aba.id}
              ref={(el) => {
                referencias.current[aba.id] = el;
              }}
              role="tab"
              id={`aba-${aba.id}`}
              aria-selected={selecionada}
              aria-controls={`painel-${aba.id}`}
              tabIndex={selecionada ? 0 : -1}
              onKeyDown={(e) => aoTeclar(e, indice)}
              onClick={() => setAtiva(aba.id)}
              style={{ clipPath: "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)" }}
              className={`-mb-px px-4 py-2 text-sm font-medium transition-colors ${
                selecionada
                  ? "border border-b-0 border-linha bg-papel-elevado text-tinta"
                  : "text-tinta-suave hover:text-tinta"
              }`}
            >
              {aba.rotulo}
            </button>
          );
        })}
      </div>
      {abas.map((aba) => (
        <div key={aba.id} role="tabpanel" id={`painel-${aba.id}`} aria-labelledby={`aba-${aba.id}`} hidden={aba.id !== abaAtual.id} className="border border-t-0 border-linha bg-papel-elevado p-4 sm:p-6">
          {aba.id === abaAtual.id ? aba.conteudo : null}
        </div>
      ))}
    </div>
  );
}
