/** Progresso visível do formulário — "Passo 2 de 5", nunca só uma barra muda sem legenda (a11y). */
export function BarraProgresso({ atual, total, rotulo }: { atual: number; total: number; rotulo: string }) {
  const percentual = Math.round((atual / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm text-tinta-suave">
        <span className="text-rotulo font-medium uppercase text-tinta-fraca">
          Passo {atual} de {total}
        </span>
        <span className="font-bold text-tinta">{rotulo}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percentual}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progresso do formulário: ${rotulo}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-linha"
      >
        <div
          className="h-full rounded-full bg-[color:var(--latao-cta)] transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)]"
          style={{ width: `${percentual}%` }}
        />
      </div>
    </div>
  );
}
