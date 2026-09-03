import type { Importacao } from "@/types/importacao";

const SEM_DADO = "—";

function Cartao({ rotulo, valor, tom = "neutro" }: { rotulo: string; valor: number; tom?: "verde" | "vermelho" | "azul" | "neutro" }) {
  const tons: Record<typeof tom, string> = {
    verde: "border-verde-fraco bg-verde-fraco text-[color:var(--verde)]",
    vermelho: "border-vermelho-fraco bg-vermelho-fraco text-[color:var(--vermelho)]",
    azul: "border-azul-fraco bg-azul-fraco text-[color:var(--azul)]",
    neutro: "border-linha bg-papel-elevado text-tinta",
  };
  return (
    <div className={`flex flex-col gap-1 rounded-sm border px-3.5 py-3 ${tons[tom]}`}>
      <span className="text-2xl font-semibold tabular-nums">{valor}</span>
      <span className="text-xs font-medium leading-snug text-tinta-suave">{rotulo}</span>
    </div>
  );
}

/**
 * Contadores por categoria — antes de confirmar (prévia) e depois (resultado
 * real). Nunca soma um total "bonito" que a soma das partes já não diz: cada
 * card é a contagem exata que veio do banco, sem arredondar nem inventar.
 */
export function ResumoImportacao({ importacao }: { importacao: Importacao }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <Cartao rotulo="Pessoas novas" valor={importacao.pessoas_novas} tom="verde" />
      <Cartao rotulo="Pessoas já existentes" valor={importacao.pessoas_existentes} />
      <Cartao rotulo="Jornadas novas" valor={importacao.jornadas_novas} tom="azul" />
      <Cartao rotulo="Ignoradas (jornada já aberta)" valor={importacao.ignoradas} />
      <Cartao rotulo="Com erro" valor={importacao.com_erro} tom={importacao.com_erro > 0 ? "vermelho" : "neutro"} />
    </div>
  );
}

export function LinhaTotalLinhas({ total }: { total: number }) {
  return <p className="text-sm text-tinta-suave">Total de linhas lidas do arquivo: {total > 0 ? total : SEM_DADO}</p>;
}
