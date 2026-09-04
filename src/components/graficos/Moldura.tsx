import type { ReactNode } from "react";
import { PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

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
      className={`grafico-moldura rounded-sm border p-4 sm:p-5 ${className}`}
      style={{ borderColor: cores.linha, background: cores.superficieElevada }}
    >
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-serif text-base font-bold" style={{ color: cores.tinta }}>
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
