import type { ItemPendencia } from "./pendencias";

/**
 * U5 — a tradução, por jornada, do que o painel do dia faz por escritório:
 * o que falta para esta jornada específica andar, cada item levando direto
 * à ação (link em hash, consumido pelo `deepLinkHash` de `Abas`).
 *
 * Vazio aqui é uma vitória, não um estado degradado — jornada sem pendência
 * mostra confirmação, não uma lista fantasma.
 *
 * Recebe `itens` já calculados (`calcularPendencias`, chamado uma vez em
 * `jornadas/[id]/page.tsx`) em vez de recalcular a partir de `Ficha360` —
 * a `FaixaVital` de `CabecalhoFicha` precisa do mesmo resultado para o chip
 * "Próxima ação", então o cálculo é feito uma única vez por render e
 * compartilhado, não duplicado por componente.
 */
export function ChecklistPendencias({ itens }: { itens: ItemPendencia[] }) {
  if (itens.length === 0) {
    return (
      <div
        role="status"
        className="nao-imprimir flex items-center gap-2.5 rounded-sm border border-verde-fraco bg-verde-fraco px-3.5 py-2.5 text-sm text-[color:var(--verde)]"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current">
          <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z" />
        </svg>
        <span className="font-medium">Nada pendente nesta jornada.</span>
      </div>
    );
  }

  return (
    <div className="nao-imprimir rounded-sm border border-linha bg-papel-elevado" aria-labelledby="titulo-pendencias">
      <p id="titulo-pendencias" className="border-b border-linha px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-tinta-fraca">
        Falta para esta jornada andar
        <span className="ml-1.5 rounded-full bg-ambar-fraco px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--ambar)]">{itens.length}</span>
      </p>
      <ul className="flex flex-col divide-y divide-linha">
        {itens.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.abaId}`}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-tinta transition-colors hover:bg-papel-fundo"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ambar)]" />
              <span className="flex-1">{item.rotulo}</span>
              <span aria-hidden="true" className="text-tinta-fraca">
                →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
