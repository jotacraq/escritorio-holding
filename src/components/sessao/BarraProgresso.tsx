"use client";

import type { RoteiroBloco } from "@/types/roteiro";

/**
 * As partes do roteiro (00…12) como botões de 44px — clicáveis e legíveis
 * por leitor de tela (nome da parte no `sr-only`). Atual = laranja de CTA
 * com texto escuro; concluída = fundo de item ativo; futura = neutra.
 *
 * `compacta` (pedido do Marcio, 14/09 — "faixa fina do roteiro no topo,
 * ~60px de altura, horizontal"): uma única linha — "Parte X de Y — Título"
 * à esquerda, os N botões numéricos à direita, mesmo alvo de 44px de altura
 * (Fase 8 não é negociável), só a largura mínima do botão encolhe
 * (`min-w-9`→36px, cabe 13 botões numa linha sem quebrar a 1280px) e o
 * `title`/`sr-only` de cada um continuam idênticos ao modo grade. A barra de
 * progresso (`role=progressbar`) desce para uma linha de 3px sob os botões,
 * não decorativa — seu valor é o mesmo do modo grade.
 */
export function BarraProgresso({
  blocos,
  indiceAtual,
  aoIrPara,
  compacta = false,
}: {
  blocos: RoteiroBloco[];
  indiceAtual: number;
  aoIrPara: (indice: number) => void;
  compacta?: boolean;
}) {
  const percentual = blocos.length > 1 ? Math.round((indiceAtual / (blocos.length - 1)) * 100) : 0;
  const blocoAtual = blocos[indiceAtual];

  const botoes = (
    <ol className={`flex ${compacta ? "flex-nowrap gap-1 overflow-x-auto" : "flex-wrap gap-1.5"}`}>
      {blocos.map((bloco, indice) => {
        const atual = indice === indiceAtual;
        const concluida = indice < indiceAtual;
        return (
          <li key={bloco.id} className="shrink-0">
            <button
              type="button"
              onClick={() => aoIrPara(indice)}
              aria-current={atual ? "step" : undefined}
              title={bloco.titulo}
              className={`flex h-11 items-center justify-center rounded-controle border font-bold tabular-nums transition-[background-color,border-color,color] duration-[var(--transicao-rapida)] ${
                compacta ? "min-w-9 px-1.5 text-legenda" : "min-w-11 px-2 text-sm"
              } ${
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
  );

  const barra = (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentual}
      aria-label={`Progresso da sessão: parte ${indiceAtual} de ${blocos.length - 1}`}
      className={`w-full overflow-hidden rounded-full bg-linha ${compacta ? "h-[3px]" : "h-1.5"}`}
    >
      <div className="h-full rounded-full bg-[color:var(--latao-cta)] transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)]" style={{ width: `${percentual}%` }} />
    </div>
  );

  if (compacta) {
    return (
      <nav aria-label="Partes da Sessão de Viabilidade" className="nao-imprimir flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <p className="shrink-0 text-sm font-bold tabular-nums text-tinta">
            Parte {String(indiceAtual).padStart(2, "0")} de {String(Math.max(blocos.length - 1, 0)).padStart(2, "0")}
            {blocoAtual && <span className="ml-1.5 font-medium text-tinta-suave">— {blocoAtual.titulo}</span>}
          </p>
          <div className="min-w-0 flex-1">{botoes}</div>
        </div>
        {barra}
      </nav>
    );
  }

  return (
    <nav aria-label="Partes da Sessão de Viabilidade" className="nao-imprimir flex flex-col gap-2">
      {botoes}
      {barra}
    </nav>
  );
}
