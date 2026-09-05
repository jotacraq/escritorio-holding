"use client";

import { useEffect, useState } from "react";

interface EtapaProgresso {
  rotulo: string;
}

interface ProgressoProps {
  /** 0–100. Omita para modo indeterminado (barra "respirando"). */
  valor?: number;
  /** Etapas nomeadas; `etapaAtual` é o índice (0-based) da que está rodando. */
  etapas?: EtapaProgresso[];
  etapaAtual?: number;
  /** Texto de tempo esperado, honesto: "costuma levar 30 a 60 segundos". */
  tempoEsperado?: string;
  /** Rótulo lido pelo leitor de tela e mostrado acima da barra. */
  rotulo: string;
  /** Mostra o cronômetro desde a montagem — prova viva de que não travou. */
  cronometro?: boolean;
  className?: string;
}

/**
 * Barra + etapas para trabalhos longos (geração de IA, importação). A tela
 * nunca "parece travada": ou a barra anda, ou o cronômetro anda, ou as
 * etapas mudam. Sem dado inventado — o percentual só aparece quando
 * `valor` é passado de verdade.
 */
export function Progresso({ valor, etapas, etapaAtual = 0, tempoEsperado, rotulo, cronometro = false, className = "" }: ProgressoProps) {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    if (!cronometro) return;
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [cronometro]);

  const determinado = typeof valor === "number";
  const largura = determinado ? Math.max(0, Math.min(100, valor)) : undefined;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-bold text-tinta">{rotulo}</p>
        <p className="text-xs text-tinta-suave">
          {determinado && <span className="font-medium text-tinta">{Math.round(largura!)}%</span>}
          {determinado && (tempoEsperado || cronometro) && " · "}
          {tempoEsperado}
          {tempoEsperado && cronometro && " · "}
          {cronometro && <span className="tabular-nums">{formatarSegundos(segundos)}</span>}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinado ? Math.round(largura!) : undefined}
        aria-valuetext={determinado ? undefined : etapas?.[etapaAtual]?.rotulo ?? "Em andamento"}
        className="relative h-2.5 overflow-hidden rounded-full bg-linha"
      >
        {determinado ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--latao-cta)] transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)]"
            style={{ width: `${largura}%` }}
          />
        ) : (
          <span className="absolute inset-y-0 w-1/3 animate-[deslizar-indeterminado_1.4s_ease-in-out_infinite] rounded-full bg-[color:var(--latao-cta)]" />
        )}
      </div>
      {etapas && etapas.length > 0 && (
        <ol className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
          {etapas.map((etapa, i) => {
            const estado = i < etapaAtual ? "feita" : i === etapaAtual ? "atual" : "futura";
            return (
              <li
                key={etapa.rotulo}
                aria-current={estado === "atual" ? "step" : undefined}
                className={`flex items-center gap-2 text-xs ${estado === "atual" ? "font-bold text-tinta" : estado === "feita" ? "text-[color:var(--verde)]" : "text-tinta-fraca"}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-legenda font-bold ${
                    estado === "feita"
                      ? "border-transparent bg-[color:var(--verde)] text-white"
                      : estado === "atual"
                        ? "border-[color:var(--latao-cta)] bg-latao-fraco text-tinta"
                        : "border-linha-forte text-tinta-fraca"
                  }`}
                >
                  {estado === "feita" ? (
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 10.5l3.6 3.5 7.4-8" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                {etapa.rotulo}
                {estado === "atual" && <span className="sr-only"> (em andamento)</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function formatarSegundos(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}min ${String(s).padStart(2, "0")}s` : `${s}s`;
}
