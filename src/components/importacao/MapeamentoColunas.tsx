"use client";

import { useId } from "react";
import type { CampoImportavel, MapaColunas } from "@/types/importacao";
import { Selo } from "@/components/ui/Selo";
import { CAMPOS_ORDENADOS, DESTINO_PERGUNTA, ROTULO_CAMPO, rotuloPergunta } from "./campos";

const NAO_IMPORTAR = "";

/**
 * Casamento coluna do CSV -> destino no sistema. Não existe layout fixo
 * (BLOQUEIO B18): cada cabeçalho vira uma linha com um `<select>`; o mapa
 * final é só `{ cabeçalho: campo }` para as colunas que o operador de fato
 * escolheu mapear (as demais somem do `MapaColunas`, mas continuam no
 * `dados.bruto` da linha — o rastro fica gravado mesmo sem uso).
 *
 * Fase 4 §5.2: além dos campos cadastrais, qualquer coluna pode virar
 * "Pergunta do seminário: <cabeçalho>" — a resposta da pessoa àquela
 * pergunta. Vive em `perguntas` (lista de cabeçalhos), fora do `MapaColunas`.
 *
 * Em tela estreita a tabela vira lista de cartões (cada `<tr>` empilha as
 * células com o rótulo do cabeçalho) — nada de scroll lateral para um
 * formulário que a pessoa precisa preencher inteiro.
 */
export function MapeamentoColunas({
  cabecalho,
  linhasAmostra,
  mapa,
  perguntas,
  aoMudarMapa,
  aoMudarPerguntas,
}: {
  cabecalho: string[];
  linhasAmostra: string[][];
  mapa: MapaColunas;
  perguntas: string[];
  aoMudarMapa: (mapa: MapaColunas) => void;
  aoMudarPerguntas: (perguntas: string[]) => void;
}) {
  const prefixoId = useId();
  const indicePorColuna = new Map(cabecalho.map((coluna, indice) => [coluna, indice]));
  const camposJaUsados = new Map<CampoImportavel, string>();
  for (const [coluna, campo] of Object.entries(mapa)) camposJaUsados.set(campo, coluna);

  function mudarDestino(coluna: string, destino: string) {
    const proximoMapa = { ...mapa };
    delete proximoMapa[coluna];
    const proximasPerguntas = perguntas.filter((p) => p !== coluna);
    if (destino === DESTINO_PERGUNTA) proximasPerguntas.push(coluna);
    else if (destino) proximoMapa[coluna] = destino as CampoImportavel;
    aoMudarMapa(proximoMapa);
    aoMudarPerguntas(proximasPerguntas);
  }

  const nomeMapeado = Object.values(mapa).includes("nome");
  const mapeadas = Object.keys(mapa).length + perguntas.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-tinta-suave" aria-live="polite">
        {mapeadas === 0
          ? `${cabecalho.length} colunas no arquivo. Nenhuma mapeada ainda — comece pelo nome.`
          : `${mapeadas} de ${cabecalho.length} colunas mapeadas. O que ficar em “Não importar” continua guardado no rastro da linha, sem virar cadastro.`}
      </p>

      <div className="overflow-hidden rounded-controle border border-linha">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Casamento entre coluna do arquivo e destino no sistema</caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-linha bg-papel text-left">
              <th scope="col" className="px-4 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
                Coluna do arquivo
              </th>
              <th scope="col" className="px-4 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
                Amostra
              </th>
              <th scope="col" className="w-[40%] px-4 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
                Vira no sistema
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {cabecalho.map((coluna, posicao) => {
              const indice = indicePorColuna.get(coluna) ?? -1;
              const amostra = linhasAmostra.map((linha) => linha[indice]).filter((v) => v?.trim());
              const ehPergunta = perguntas.includes(coluna);
              const destinoAtual: string = ehPergunta ? DESTINO_PERGUNTA : (mapa[coluna] ?? NAO_IMPORTAR);
              const idSelect = `${prefixoId}-${posicao}`;
              const marcada = destinoAtual !== NAO_IMPORTAR;
              return (
                <tr key={`${coluna}-${posicao}`} className={`block p-4 align-top transition-colors duration-[var(--transicao-rapida)] sm:table-row sm:p-0 ${marcada ? "bg-papel-elevado" : "bg-papel-elevado sm:bg-papel/40"}`}>
                  <th scope="row" className="block text-left font-medium text-tinta sm:table-cell sm:px-4 sm:py-3">
                    <label htmlFor={idSelect} className="flex items-center gap-2">
                      <span>{coluna || "(sem nome)"}</span>
                      {ehPergunta && <Selo tom="latao">pergunta</Selo>}
                    </label>
                  </th>
                  <td className="block pt-1 text-xs text-tinta-suave sm:table-cell sm:px-4 sm:py-3 sm:pt-3">
                    <span className="text-legenda uppercase tracking-wide text-tinta-fraca sm:hidden">Amostra: </span>
                    {amostra.length > 0 ? (
                      <span className="line-clamp-2">{amostra.slice(0, 2).join(" · ")}</span>
                    ) : (
                      <span className="text-tinta-fraca">vazio na amostra</span>
                    )}
                  </td>
                  <td className="block pt-3 sm:table-cell sm:px-4 sm:py-2 sm:pt-2">
                    <div className="relative">
                      <select
                        id={idSelect}
                        value={destinoAtual}
                        onChange={(e) => mudarDestino(coluna, e.target.value)}
                        className={`min-h-11 w-full appearance-none rounded-controle border bg-papel-elevado py-2 pl-3.5 pr-10 text-sm text-tinta transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] focus:border-[color:var(--latao)] focus:outline-none focus:shadow-foco ${marcada ? "border-[color:var(--latao)]" : "border-linha-controle"}`}
                      >
                        <option value={NAO_IMPORTAR}>Não importar</option>
                        <optgroup label="Campo do cadastro">
                          {CAMPOS_ORDENADOS.map((campo) => {
                            const usadoPorOutra = camposJaUsados.get(campo);
                            const desabilitado = usadoPorOutra !== undefined && usadoPorOutra !== coluna;
                            return (
                              <option key={campo} value={campo} disabled={desabilitado}>
                                {ROTULO_CAMPO[campo]}
                                {desabilitado ? ` (já usado em “${usadoPorOutra}”)` : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                        <optgroup label="Resposta do seminário">
                          <option value={DESTINO_PERGUNTA}>{rotuloPergunta(coluna)}</option>
                        </optgroup>
                      </select>
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-suave" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 8l5 5 5-5" />
                      </svg>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!nomeMapeado && (
        <p role="alert" className="flex items-start gap-2 rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
            <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
          </svg>
          <span>
            Falta dizer qual coluna é o <strong>Nome</strong> — é o único campo obrigatório. Sem ele, toda linha vira erro na prévia.
          </span>
        </p>
      )}

      {perguntas.length > 0 && (
        <p className="text-xs text-tinta-suave">
          {perguntas.length === 1 ? "1 coluna vira resposta do seminário" : `${perguntas.length} colunas viram respostas do seminário`}, ligadas à pessoa e a esta edição — é o que o Briefing usa para saber o que ela respondeu.
        </p>
      )}
    </div>
  );
}
