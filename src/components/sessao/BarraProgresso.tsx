"use client";

import type { RoteiroBloco } from "@/types/roteiro";

export function BarraProgresso({
  blocos,
  indiceAtual,
  aoIrPara,
}: {
  blocos: RoteiroBloco[];
  indiceAtual: number;
  aoIrPara: (indice: number) => void;
}) {
  return (
    <nav aria-label="Partes da Sessão de Viabilidade" className="nao-imprimir">
      <ol className="flex flex-wrap gap-1">
        {blocos.map((bloco, indice) => {
          const atual = indice === indiceAtual;
          const concluida = indice < indiceAtual;
          return (
            <li key={bloco.id}>
              <button
                type="button"
                onClick={() => aoIrPara(indice)}
                aria-current={atual ? "step" : undefined}
                title={bloco.titulo}
                className={`flex h-7 w-7 items-center justify-center rounded-sm border text-[11px] font-bold transition-colors ${
                  atual
                    ? "border-[color:var(--latao-cta)] bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]"
                    : concluida
                      ? "border-linha-forte bg-latao-fraco text-tinta-suave"
                      : "border-linha-forte bg-papel-elevado text-tinta-fraca hover:border-tinta-fraca"
                }`}
              >
                {indice}
                <span className="sr-only"> — {bloco.titulo}{atual ? " (parte atual)" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
