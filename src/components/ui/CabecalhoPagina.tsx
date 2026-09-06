import type { ReactNode } from "react";

interface CabecalhoPaginaProps {
  /** Rótulo pequeno em caixa alta — a área do sistema ("Dia a dia", "Cliente"). */
  rotulo?: string;
  titulo: ReactNode;
  /**
   * A LINHA DE PROPÓSITO da tela (lei L2 da Fase 6): uma frase curta que diz
   * para que a tela serve, a quem opera e não conhece o sistema. Uma linha ou
   * nenhuma — explicação longa vai no `title` ou numa `Dica`, nunca aqui.
   */
  descricao?: ReactNode;
  /** Botões à direita (o primário por último). */
  acoes?: ReactNode;
  /** Linha de contexto abaixo do título (selos, "atualizado às"). */
  meta?: ReactNode;
  /** Linha de navegação acima do rótulo (ex.: "← Voltar aos clientes"). */
  acima?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho de página: rótulo caixa alta, título, linha de propósito, ações à
 * direita. Único `<h1>` da tela.
 *
 * Fase 6 ("tá tudo muito grande, tenho que escrolar muito"): o hero encolheu.
 * O título é **um só tamanho** (`text-display`, que já caiu de 34 para 24 px)
 * em vez de `text-titulo sm:text-display`, e a linha de propósito desceu de
 * `text-corpo` para `text-sm`. A identidade — rótulo laranja em caixa alta,
 * Neuetra bold, hierarquia — fica; o que saiu foi a escala.
 *
 * A descrição carrega `data-proposito`: é o que o contador de aceite mede
 * para provar que toda tela diz para que serve.
 */
export function CabecalhoPagina({ rotulo, titulo, descricao, acoes, meta, acima, className = "" }: CabecalhoPaginaProps) {
  return (
    <header className={`flex flex-col gap-2 ${className}`}>
      {acima && <div className="text-sm text-tinta-suave">{acima}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-3xl">
          {rotulo && <p className="mb-0.5 text-rotulo font-medium uppercase text-[color:var(--latao)]">{rotulo}</p>}
          <h1 className="text-display font-bold text-tinta">{titulo}</h1>
          {descricao && (
            <p data-proposito className="mt-1 max-w-2xl text-sm text-tinta-suave">
              {descricao}
            </p>
          )}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-2 text-legenda text-tinta-fraca">{meta}</div>}
    </header>
  );
}
