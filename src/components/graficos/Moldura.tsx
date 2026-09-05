import type { ReactNode } from "react";
import { PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps, ProcedenciaGrafico, ResumoProcedencia } from "./tipos";

interface MolduraProps extends Required<Pick<GraficoBaseProps, "tema">> {
  titulo: string;
  /** "Fonte: ..." — proveniência do dado, padrão Stripe Dashboard (§5.2). */
  fonte?: string;
  legenda?: ReactNode;
  /** A tabela `sr-only` com os mesmos números — accessibility real, não decorativa. */
  tabela: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Moldura visual comum aos 7 gráficos com dado. Cor explícita por `tema`
 * (mesmo raciocínio do SVG interno, §3.5 da arquitetura): este cartão pode
 * aparecer dentro do Modo Apresentação, com fundo fixo `#0f1012`, fora do
 * alcance do toggle `.dark` do resto do sistema. Os valores hexadecimais são
 * os MESMOS de `globals.css` (ver `paleta.ts`) — não é uma paleta nova.
 */
export function Moldura({ titulo, fonte, legenda, tabela, tema, children, className = "" }: MolduraProps) {
  const cores = PALETA_GRAFICO[tema];
  return (
    <figure
      className={`grafico-moldura rounded-controle border p-4 sm:p-5 ${className}`}
      style={{ borderColor: cores.linha, background: cores.superficieElevada }}
    >
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-bold" style={{ color: cores.tinta }}>
          {titulo}
        </h3>
        {fonte && (
          <span className="text-xs" style={{ color: cores.tintaFraca }}>
            {fonte}
          </span>
        )}
      </figcaption>

      <div className="w-full">{children}</div>

      {legenda && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: cores.tintaSuave }}>
          {legenda}
        </div>
      )}

      {tabela}
    </figure>
  );
}

const ROTULO_PROCEDENCIA: Record<ProcedenciaGrafico, { uma: string; varias: string }> = {
  digitado: { uma: "rubrica digitada pela advogada", varias: "rubricas digitadas pela advogada" },
  calculado: { uma: "rubrica calculada (base × alíquota do parâmetro)", varias: "rubricas calculadas (base × alíquota do parâmetro)" },
  ausente: { uma: "rubrica ausente", varias: "rubricas ausentes" },
};

/**
 * Glifo de procedência — FORMA diferente por origem, não só cor: cheio =
 * digitado; contorno com traço diagonal = calculado; tracejado vazio =
 * ausente. Funciona em preto e branco e para daltonismo.
 */
export function GlifoProcedencia({ procedencia, tema }: { procedencia: ProcedenciaGrafico; tema: "claro" | "escuro" }) {
  const cores = PALETA_GRAFICO[tema];
  const cor = procedencia === "ausente" ? cores.tintaFraca : cores.tintaSuave;
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="inline-block h-3 w-3 shrink-0">
      {procedencia === "digitado" && <rect x="1" y="1" width="10" height="10" rx="2" fill={cor} />}
      {procedencia === "calculado" && (
        <>
          <rect x="1" y="1" width="10" height="10" rx="2" fill="none" stroke={cor} strokeWidth="1.5" />
          <path d="M3 9 9 3" stroke={cor} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {procedencia === "ausente" && <rect x="1" y="1" width="10" height="10" rx="2" fill="none" stroke={cor} strokeWidth="1.5" strokeDasharray="2 2" />}
    </svg>
  );
}

/** Legenda "de onde veio cada número" — só as procedências presentes, com contagem. */
export function LegendaProcedencia({ resumo, tema }: { resumo: ResumoProcedencia; tema: "claro" | "escuro" }) {
  const cores = PALETA_GRAFICO[tema];
  const itens = (["digitado", "calculado", "ausente"] as const).filter((p) => resumo[p] > 0);
  if (itens.length === 0) return null;
  return (
    <>
      {itens.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <GlifoProcedencia procedencia={p} tema={tema} />
          <span style={{ color: cores.tintaSuave }}>
            {resumo[p]} {resumo[p] === 1 ? ROTULO_PROCEDENCIA[p].uma : ROTULO_PROCEDENCIA[p].varias}
          </span>
        </span>
      ))}
    </>
  );
}

/** Item de legenda — quadradinho de cor + rótulo em texto (identidade nunca só por cor). */
export function ItemLegenda({ cor, rotulo, tema }: { cor: string; rotulo: string; tema: "claro" | "escuro" }) {
  const cores = PALETA_GRAFICO[tema];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: cor }} />
      <span style={{ color: cores.tintaSuave }}>{rotulo}</span>
    </span>
  );
}
