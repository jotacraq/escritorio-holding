"use client";

import type { CampoImportavel, MapaColunas } from "@/types/importacao";
import { CAMPOS_ORDENADOS, ROTULO_CAMPO } from "./campos";

const NAO_IMPORTAR = "";

/**
 * Casamento coluna do CSV -> campo do domínio. Não existe layout fixo
 * (BLOQUEIO B18): cada cabeçalho vira uma linha com um `<select>`; o mapa
 * final é só `{ cabeçalho: campo }` para as colunas que o operador de fato
 * escolheu mapear (as demais somem do `MapaColunas`, mas continuam no
 * `dados.bruto` da linha — o rastro fica gravado mesmo sem uso).
 */
export function MapeamentoColunas({
  cabecalho,
  linhasAmostra,
  mapa,
  aoMudarMapa,
}: {
  cabecalho: string[];
  linhasAmostra: string[][];
  mapa: MapaColunas;
  aoMudarMapa: (mapa: MapaColunas) => void;
}) {
  const indicePorColuna = new Map(cabecalho.map((coluna, indice) => [coluna, indice]));
  const camposJaUsados = new Map<CampoImportavel, string>();
  for (const [coluna, campo] of Object.entries(mapa)) camposJaUsados.set(campo, coluna);

  function mudarCampo(coluna: string, campoNovo: string) {
    const proximo = { ...mapa };
    delete proximo[coluna];
    if (campoNovo) proximo[coluna] = campoNovo as CampoImportavel;
    aoMudarMapa(proximo);
  }

  const nomeMapeado = Object.values(mapa).includes("nome");

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-sm border border-linha">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">Casamento entre coluna do arquivo e campo do sistema</caption>
          <thead>
            <tr className="border-b border-linha bg-papel-fundo text-left text-xs uppercase tracking-wide text-tinta-fraca">
              <th scope="col" className="px-3 py-2 font-medium">
                Coluna do arquivo
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Amostra
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Campo do sistema
              </th>
            </tr>
          </thead>
          <tbody>
            {cabecalho.map((coluna) => {
              const indice = indicePorColuna.get(coluna) ?? -1;
              const amostra = linhasAmostra.map((linha) => linha[indice]).filter((v) => v?.trim());
              const campoAtual = mapa[coluna] ?? NAO_IMPORTAR;
              const idSelect = `campo-${coluna}`;
              return (
                <tr key={coluna} className="border-b border-linha last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-tinta">
                    <label htmlFor={idSelect}>{coluna || "(sem nome)"}</label>
                  </th>
                  <td className="px-3 py-2 text-xs text-tinta-suave">
                    {amostra.length > 0 ? amostra.slice(0, 2).join(" · ") : <span className="text-tinta-fraca">vazio na amostra</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      id={idSelect}
                      value={campoAtual}
                      onChange={(e) => mudarCampo(coluna, e.target.value)}
                      className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5"
                    >
                      <option value={NAO_IMPORTAR}>Não importar</option>
                      {CAMPOS_ORDENADOS.map((campo) => {
                        const usadoPorOutra = camposJaUsados.get(campo);
                        const desabilitado = usadoPorOutra !== undefined && usadoPorOutra !== coluna;
                        return (
                          <option key={campo} value={campo} disabled={desabilitado}>
                            {ROTULO_CAMPO[campo]}
                            {desabilitado ? ` (já usado em "${usadoPorOutra}")` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!nomeMapeado && (
        <p role="alert" className="text-sm text-[color:var(--vermelho)]">
          Mapeie ao menos uma coluna para &quot;Nome&quot; — é o único campo obrigatório. Sem nome, a linha vira erro na prévia.
        </p>
      )}
    </div>
  );
}
