export function AtalhosTeclado() {
  return (
    <details className="nao-imprimir group rounded-sm border border-linha bg-papel-elevado px-3 py-2 text-xs text-tinta-suave">
      <summary className="cursor-pointer list-none font-medium text-tinta marker:content-none">
        Atalhos de teclado
        <span aria-hidden="true" className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
      </summary>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-[11px]">→</kbd>
          <dd>Próxima parte</dd>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-[11px]">←</kbd>
          <dd>Parte anterior</dd>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-[11px]">Home</kbd>
          <dd>Primeira parte (00)</dd>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono text-[11px]">End</kbd>
          <dd>Última parte (12)</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] text-tinta-fraca">Desativados enquanto você digita numa anotação ou num campo da oferta.</p>
    </details>
  );
}
