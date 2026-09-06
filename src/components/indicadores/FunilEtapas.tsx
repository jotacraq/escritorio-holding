"use client";

import { useId } from "react";
import { PALETA_GRAFICO, type TemaGrafico } from "@/components/graficos/paleta";

export interface EtapaFunil {
  id: string;
  rotulo: string;
  /** `null` = a view não trouxe o dado (vazio é vazio). */
  valor: number | null;
  /** De que etapa este número é subconjunto — para a taxa de passagem. */
  baseDescricao?: string;
}

/**
 * Funil por etapa da coorte — barras horizontais em SVG inline, uma série,
 * um matiz (o latão da marca), no padrão de `components/graficos/paleta.ts`
 * (cor por `tema`, nunca por CSS, para o desenho valer também quando for
 * capturado). Método da skill `dataviz`: forma = magnitude ordenada → barra;
 * marca ≤ 24px, ponta arredondada 4px só do lado do dado, base quadrada;
 * rótulo direto do valor na ponta (cinco barras, todas rotuladas — é o
 * limite em que rotular tudo ainda é leitura, não ruído); texto sempre nos
 * tokens de tinta, nunca na cor da série; trilho recessivo na cor da grade.
 * A tabela logo abaixo, na mesma tela, é a "table view" da regra.
 */
export function FunilEtapas({ etapas, tema, rotulo }: { etapas: EtapaFunil[]; tema: TemaGrafico; rotulo: string }) {
  const paleta = PALETA_GRAFICO[tema];
  const idBase = useId();
  const maximo = Math.max(0, ...etapas.map((e) => e.valor ?? 0));
  const primeira = etapas[0]?.valor ?? null;

  return (
    <figure aria-label={rotulo} className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {etapas.map((etapa, i) => {
          const anterior = i > 0 ? etapas[i - 1].valor : null;
          const vazio = etapa.valor === null || etapa.valor === undefined;
          const largura = !vazio && maximo > 0 ? (etapa.valor! / maximo) * 100 : 0;
          const passagem = !vazio && anterior !== null && anterior !== undefined && anterior > 0 ? (etapa.valor! / anterior) * 100 : null;
          const doTopo = !vazio && i > 0 && primeira !== null && primeira > 0 ? (etapa.valor! / primeira) * 100 : null;
          const idTitulo = `${idBase}-${etapa.id}`;
          return (
            <li key={etapa.id} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[11rem_1fr_auto]">
              <span id={idTitulo} className="text-sm font-medium text-tinta">
                {etapa.rotulo}
              </span>
              <svg
                role="img"
                aria-labelledby={idTitulo}
                aria-describedby={`${idTitulo}-valor`}
                width="100%"
                height="24"
                className="block min-w-0"
                preserveAspectRatio="none"
              >
                <title>{vazio ? `${etapa.rotulo}: sem dado` : `${etapa.rotulo}: ${etapa.valor}`}</title>
                <rect x="0" y="0" width="100%" height="24" rx="4" fill={paleta.grade} opacity={0.45} />
                {largura > 0 && (
                  <>
                    <rect x="0" y="0" width={`${largura}%`} height="24" rx="4" fill={paleta.latao} />
                    <rect x="0" y="0" width="4" height="24" fill={paleta.latao} />
                  </>
                )}
              </svg>
              <span id={`${idTitulo}-valor`} className="flex items-baseline gap-2 text-sm sm:justify-end sm:text-right">
                <span className={`min-w-[2.5ch] font-bold tabular-nums ${vazio ? "text-tinta-fraca" : "text-tinta"}`}>{vazio ? "—" : etapa.valor}</span>
                {vazio ? (
                  <span className="text-xs text-tinta-fraca">sem dado</span>
                ) : passagem !== null ? (
                  <span className="text-xs text-tinta-suave">
                    {Math.round(passagem)}% {etapa.baseDescricao ?? "da etapa anterior"}
                    {doTopo !== null && i > 1 ? ` · ${Math.round(doTopo)}% da coorte` : ""}
                  </span>
                ) : i > 0 ? (
                  <span className="text-xs text-tinta-fraca">sem base para taxa</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/** Barra de proporção 96×40 para o `visual` do `Kpi` — fração medida, sem inventar nada. */
export function ProporcaoMini({ fracao, tema }: { fracao: number; tema: TemaGrafico }) {
  const paleta = PALETA_GRAFICO[tema];
  const largura = Math.max(0, Math.min(1, fracao)) * 96;
  return (
    <svg viewBox="0 0 96 40" width="96" height="40" aria-hidden="true" className="block">
      <rect x="0" y="16" width="96" height="8" rx="4" fill={paleta.grade} opacity={0.6} />
      {largura > 0 && (
        <>
          <rect x="0" y="16" width={largura} height="8" rx="4" fill={paleta.latao} />
          <rect x="0" y="16" width={Math.min(4, largura)} height="8" fill={paleta.latao} />
        </>
      )}
    </svg>
  );
}
