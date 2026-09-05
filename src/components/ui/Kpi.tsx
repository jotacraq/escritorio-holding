import type { ReactNode } from "react";

interface KpiProps {
  /** O nome da medida, humano ("Sessões esta semana"). */
  rotulo: string;
  /** Valor já formatado. `null`/`undefined` mostra "—" e a explicação, nunca zero. */
  valor: string | number | null | undefined;
  /** Unidade ou sufixo curto ao lado do valor ("%", "famílias"). */
  unidade?: string;
  /** Comparação medida: `{ delta: "+3", sentido: "bom", contra: "semana passada" }`. Omita se não foi medida. */
  comparacao?: { delta: string; sentido: "bom" | "ruim" | "neutro"; contra: string };
  /** Auxílio visual (sparkline SVG, barra de proporção) — decorativo. */
  visual?: ReactNode;
  /** Por que está vazio ("ainda sem sessão nesta edição"). */
  motivoVazio?: string;
  /** Link "ver detalhe". */
  acao?: ReactNode;
  className?: string;
}

const COR_SENTIDO = {
  bom: "text-[color:var(--verde)] bg-verde-fraco",
  ruim: "text-[color:var(--vermelho)] bg-vermelho-fraco",
  neutro: "text-tinta-suave bg-papel",
} as const;

/**
 * KPI = valor grande + comparação + auxílio visual (regra da casa). Nada de
 * dado inventado: sem valor mostra travessão e o motivo; sem comparação
 * medida, não mostra comparação.
 */
export function Kpi({ rotulo, valor, unidade, comparacao, visual, motivoVazio, acao, className = "" }: KpiProps) {
  const vazio = valor === null || valor === undefined || valor === "";
  return (
    <div className={`flex flex-col gap-2 rounded-cartao border border-linha bg-papel-elevado p-5 shadow-cartao ${className}`}>
      <p className="text-rotulo font-medium uppercase text-tinta-fraca">{rotulo}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className={`font-bold tabular-nums ${vazio ? "text-titulo text-tinta-fraca" : "text-display text-tinta"}`}>{vazio ? "—" : valor}</span>
          {!vazio && unidade && <span className="text-sm font-medium text-tinta-suave">{unidade}</span>}
        </p>
        {visual && (
          <div aria-hidden="true" className="h-10 w-24 shrink-0 text-[color:var(--latao)]">
            {visual}
          </div>
        )}
      </div>
      {vazio && motivoVazio && <p className="text-xs text-tinta-suave">{motivoVazio}</p>}
      {!vazio && comparacao && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
          <span className={`rounded-full px-2 py-0.5 font-bold ${COR_SENTIDO[comparacao.sentido]}`}>
            {comparacao.sentido === "bom" ? "▲ " : comparacao.sentido === "ruim" ? "▼ " : ""}
            {comparacao.delta}
          </span>
          {comparacao.contra}
        </p>
      )}
      {acao && <div className="mt-auto pt-1 text-sm">{acao}</div>}
    </div>
  );
}
