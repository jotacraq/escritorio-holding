import type { ReactNode } from "react";

interface CabecalhoPaginaProps {
  /** Rótulo pequeno em caixa alta — a área do sistema ("Dia a dia", "Cliente"). */
  rotulo?: string;
  titulo: ReactNode;
  /** Uma ou duas frases: o que esta tela faz por quem a usa. */
  descricao?: ReactNode;
  /** Botões à direita (o primário por último). */
  acoes?: ReactNode;
  /** Linha de contexto abaixo do título (selos, "atualizado às"). */
  meta?: ReactNode;
  /** Linha de navegação acima do rótulo (ex.: "← Voltar à esteira"). */
  acima?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho de página no padrão do seminário: rótulo caixa alta, título
 * grande e bold, descrição com respiro, ações à direita. Único `<h1>` da
 * tela.
 */
export function CabecalhoPagina({ rotulo, titulo, descricao, acoes, meta, acima, className = "" }: CabecalhoPaginaProps) {
  return (
    <header className={`flex flex-col gap-4 ${className}`}>
      {acima && <div className="text-sm text-tinta-suave">{acima}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          {rotulo && <p className="mb-1.5 text-rotulo font-medium uppercase text-[color:var(--latao)]">{rotulo}</p>}
          <h1 className="text-titulo font-bold text-tinta sm:text-display">{titulo}</h1>
          {descricao && <p className="mt-2 max-w-2xl text-corpo text-tinta-suave">{descricao}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-fraca">{meta}</div>}
    </header>
  );
}
