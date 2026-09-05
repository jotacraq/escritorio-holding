/**
 * Esqueletos de carregamento — a forma do que vem, em vez de um giro no
 * vazio. Use `EsqueletoLista` para listas/tabelas, `EsqueletoCartao` para
 * uma grade de cartões e `EsqueletoFicha` para cabeçalho + blocos.
 * Todos anunciam "Carregando" uma única vez (`role="status"`), com o
 * desenho escondido do leitor de tela.
 */
function Bloco({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`esqueleto block ${className}`} />;
}

export function EsqueletoLinha({ largura = "w-full", altura = "h-4", className = "" }: { largura?: string; altura?: string; className?: string }) {
  return <Bloco className={`${altura} ${largura} ${className}`} />;
}

export function EsqueletoLista({ linhas = 5, rotulo = "Carregando a lista…" }: { linhas?: number; rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col divide-y divide-linha rounded-cartao border border-linha bg-papel-elevado">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Bloco className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Bloco className={`h-4 ${i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-3/5" : "w-1/2"}`} />
            <Bloco className="h-3 w-1/3" />
          </div>
          <Bloco className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoCartao({ quantidade = 3, rotulo = "Carregando…" }: { quantidade?: number; rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: quantidade }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-cartao border border-linha bg-papel-elevado p-5">
          <Bloco className="h-3 w-1/3" />
          <Bloco className="h-6 w-3/4" />
          <Bloco className="h-4 w-full" />
          <Bloco className="h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoFicha({ rotulo = "Carregando a ficha…" }: { rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{rotulo}</span>
      <div className="flex flex-col gap-3">
        <Bloco className="h-3 w-24" />
        <Bloco className="h-9 w-2/3 max-w-md" />
        <Bloco className="h-4 w-1/2 max-w-sm" />
      </div>
      <EsqueletoCartao quantidade={3} rotulo="" />
      <EsqueletoLista linhas={3} rotulo="" />
    </div>
  );
}
