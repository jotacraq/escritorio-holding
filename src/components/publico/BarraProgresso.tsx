/** Progresso visível do formulário — "Passo 2 de 5", nunca só uma barra muda sem legenda (a11y). */
export function BarraProgresso({ atual, total, rotulo }: { atual: number; total: number; rotulo: string }) {
  const percentual = Math.round((atual / total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm text-tinta-suave">
        <span>
          Passo {atual} de {total}
        </span>
        <span className="font-medium text-tinta">{rotulo}</span>
      </div>
      <div role="progressbar" aria-valuenow={percentual} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-linha">
        <div className="h-full rounded-full bg-[color:var(--latao)] transition-[width]" style={{ width: `${percentual}%` }} />
      </div>
    </div>
  );
}
