import type { Importacao, ResultadoLinhaImportacao } from "@/types/importacao";
import { Cartao } from "@/components/ui/Cartao";
import { EXPLICACAO_RESULTADO, ROTULO_RESULTADO } from "./campos";

const SEM_DADO = "—";

/**
 * Cada categoria = um resultado real de linha (`ResultadoLinhaImportacao`),
 * com a cor de ESTADO da casa (verde entra · azul entra · neutro não muda ·
 * âmbar pulou · vermelho erro) e sempre com texto ao lado — cor nunca é o
 * único sinal. Ordem fixa: o que entra primeiro, o que fica de fora depois.
 */
const CATEGORIAS: { id: ResultadoLinhaImportacao; chave: keyof Importacao; cor: string; entra: boolean }[] = [
  { id: "pessoa_nova", chave: "pessoas_novas", cor: "var(--verde)", entra: true },
  { id: "jornada_nova", chave: "jornadas_novas", cor: "var(--azul)", entra: true },
  { id: "pessoa_existente", chave: "pessoas_existentes", cor: "var(--tinta-fraca)", entra: false },
  { id: "ignorada_jornada_aberta", chave: "ignoradas", cor: "var(--ambar-borda)", entra: false },
  { id: "erro", chave: "com_erro", cor: "var(--vermelho)", entra: false },
];

/**
 * Contadores por categoria — antes de confirmar (prévia) e depois (resultado
 * real). Nunca soma um total "bonito" que a soma das partes já não diz: cada
 * número é a contagem exata que veio do banco. A barra de composição em cima
 * é o auxílio visual: mostra de relance quanto do arquivo entra e quanto
 * fica de fora — com 2px de respiro entre segmentos (nunca borda).
 */
export function ResumoImportacao({ importacao }: { importacao: Importacao }) {
  const total = importacao.total_linhas;
  const valores = CATEGORIAS.map((c) => ({ ...c, valor: Number(importacao[c.chave] ?? 0) }));
  const entram = valores.filter((v) => v.entra).reduce((s, v) => s + v.valor, 0);
  const ficamFora = valores.filter((v) => !v.entra).reduce((s, v) => s + v.valor, 0);
  const somaConhecida = entram + ficamFora;

  return (
    <Cartao rotulo="Resultado linha a linha" titulo={total > 0 ? `${total} linha${total === 1 ? "" : "s"} lida${total === 1 ? "" : "s"} do arquivo` : "Nenhuma linha lida"} preenchimento="sem">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {somaConhecida > 0 && (
          <figure className="flex flex-col gap-2">
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${entram} de ${somaConhecida} linhas entram; ${ficamFora} ficam de fora`}>
              {valores
                .filter((v) => v.valor > 0)
                .map((v) => (
                  <span key={v.id} className="block h-full rounded-[2px]" style={{ width: `${(v.valor / somaConhecida) * 100}%`, background: v.cor }} />
                ))}
            </div>
            <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
              <span>
                <strong className="font-bold text-tinta">{entram}</strong> {entram === 1 ? "entra" : "entram"}
              </span>
              <span>
                <strong className="font-bold text-tinta">{ficamFora}</strong> {ficamFora === 1 ? "fica" : "ficam"} de fora
              </span>
            </figcaption>
          </figure>
        )}

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {valores.map((v) => (
            <div key={v.id} className={`flex flex-col gap-1 rounded-controle border px-4 py-3 ${v.valor > 0 ? "border-linha bg-papel-elevado" : "border-dashed border-linha bg-transparent"}`}>
              <dt className="flex items-center gap-2 text-rotulo font-medium uppercase text-tinta-fraca">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: v.cor }} />
                {ROTULO_RESULTADO[v.id]}
              </dt>
              <dd className={`text-titulo font-bold tabular-nums ${v.valor > 0 ? "text-tinta" : "text-tinta-fraca"}`}>{v.valor}</dd>
              <dd className="text-xs leading-snug text-tinta-suave">{EXPLICACAO_RESULTADO[v.id]}</dd>
            </div>
          ))}
        </dl>

        {typeof importacao.respostas_seminario === "number" && (
          <p className="text-sm text-tinta-suave">
            <strong className="font-bold text-tinta">{importacao.respostas_seminario}</strong> resposta{importacao.respostas_seminario === 1 ? "" : "s"} do seminário gravada{importacao.respostas_seminario === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </Cartao>
  );
}

export function LinhaTotalLinhas({ total }: { total: number }) {
  return <p className="text-sm text-tinta-suave">Total de linhas lidas do arquivo: {total > 0 ? total : SEM_DADO}</p>;
}
