const ATALHOS: Array<{ tecla: string; acao: string }> = [
  { tecla: "→", acao: "Próxima parte" },
  { tecla: "←", acao: "Parte anterior" },
  { tecla: "Home", acao: "Primeira parte (00)" },
  { tecla: "End", acao: "Última parte" },
];

/** Lista de atalhos — `details` nativo (Enter/Espaço abre, acessível), alvo de 44px no `summary`. */
export function AtalhosTeclado() {
  return (
    <details className="nao-imprimir group rounded-cartao border border-linha bg-papel-elevado px-5 text-sm text-tinta-suave shadow-cartao">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium text-tinta marker:content-none [&::-webkit-details-marker]:hidden">
        Atalhos de teclado
        <span aria-hidden="true" className="inline-block transition-transform duration-[var(--transicao-rapida)] group-open:rotate-180">
          ▾
        </span>
      </summary>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 pb-4 sm:grid-cols-2">
        {ATALHOS.map((a) => (
          <div key={a.tecla} className="flex items-center gap-3">
            <dt>
              <kbd className="inline-flex min-w-9 items-center justify-center rounded-controle border border-linha-forte bg-papel px-2 py-1 text-legenda font-bold text-tinta">{a.tecla}</kbd>
            </dt>
            <dd>{a.acao}</dd>
          </div>
        ))}
      </dl>
      <p className="pb-4 text-xs text-tinta-fraca">Desativados enquanto você digita numa anotação ou num campo da oferta.</p>
    </details>
  );
}
