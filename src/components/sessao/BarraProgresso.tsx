"use client";

import type { RoteiroBloco } from "@/types/roteiro";

/**
 * As partes do roteiro (00…12) como botões de 44px — clicáveis e legíveis
 * por leitor de tela (nome da parte no `sr-only`). Atual = laranja de CTA
 * com texto escuro; concluída = fundo de item ativo; futura = neutra.
 */
export function BarraProgresso({
  blocos,
  indiceAtual,
  aoIrPara,
}: {
  blocos: RoteiroBloco[];
  indiceAtual: number;
  aoIrPara: (indice: number) => void;
}) {
  const percentual = blocos.length > 1 ? Math.round((indiceAtual / (blocos.length - 1)) * 100) : 0;
  return (
    <nav aria-label="Partes da Sessão de Viabilidade" className="nao-imprimir flex flex-col gap-2">
      <ol className="flex flex-wrap gap-1.5">
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
                className={`flex h-11 min-w-11 items-center justify-center rounded-controle border px-2 text-sm font-bold tabular-nums transition-[background-color,border-color,color] duration-[var(--transicao-rapida)] ${
                  atual
                    ? "border-[color:var(--latao-cta)] bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]"
                    : concluida
                      ? "border-transparent bg-latao-fraco text-tinta"
                      : "border-linha-forte bg-papel-elevado text-tinta-suave hover:border-[color:var(--latao)] hover:text-tinta"
                }`}
              >
                {String(indice).padStart(2, "0")}
                <span className="sr-only">
                  {" "}
                  — {bloco.titulo}
                  {atual ? " (parte atual)" : concluida ? " (já vista)" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentual}
        aria-label={`Progresso da sessão: parte ${indiceAtual} de ${blocos.length - 1}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-linha"
      >
        <div className="h-full rounded-full bg-[color:var(--latao-cta)] transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)]" style={{ width: `${percentual}%` }} />
      </div>
    </nav>
  );
}
