"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import type { ResultadoLinhaImportacao } from "@/types/importacao";
import { listarLinhasImportacao } from "./api";
import { ROTULO_RESULTADO, TOM_RESULTADO, formatarMotivo } from "./campos";

const TAMANHO_PAGINA = 200;

const FILTROS: { id: ResultadoLinhaImportacao | "todas"; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "pessoa_nova", rotulo: "Pessoa nova" },
  { id: "jornada_nova", rotulo: "Jornada nova" },
  { id: "pessoa_existente", rotulo: "Já existente" },
  { id: "ignorada_jornada_aberta", rotulo: "Ignoradas" },
  { id: "erro", rotulo: "Com erro" },
];

const CELULA_MOVEL = "block py-0.5 sm:table-cell sm:px-5 sm:py-3 before:mr-1 before:text-legenda before:uppercase before:tracking-wide before:text-tinta-fraca before:content-[attr(data-rotulo)] sm:before:hidden";

/**
 * Tabela linha a linha da prévia (ou do resultado confirmado) — é isto que
 * deixa o operador VER o estrago antes de causá-lo: quantas, quais, por qual
 * motivo. Filtros são botões reais (Tab/Enter, `aria-pressed`); a tabela usa
 * semântica nativa e, em tela estreita, cada linha empilha as células com o
 * rótulo do cabeçalho na frente (`data-rotulo`) — sem scroll lateral.
 */
export function TabelaLinhasImportacao({ importacaoId }: { importacaoId: string }) {
  const [filtro, setFiltro] = useState<ResultadoLinhaImportacao | "todas">("todas");
  const [pagina, setPagina] = useState(1);

  const buscar = useCallback(
    () =>
      listarLinhasImportacao(importacaoId, {
        resultado: filtro === "todas" ? undefined : filtro,
        pagina,
      }),
    [importacaoId, filtro, pagina],
  );
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [importacaoId, filtro, pagina]);

  const totalPaginas = useMemo(() => (dados ? Math.max(1, Math.ceil(dados.total / TAMANHO_PAGINA)) : 1), [dados]);

  function mudarFiltro(novo: ResultadoLinhaImportacao | "todas") {
    setFiltro(novo);
    setPagina(1);
  }

  return (
    <Cartao
      preenchimento="sem"
      rotulo="Linha a linha"
      titulo="O que acontece com cada pessoa"
      descricao="Uma linha por pessoa do arquivo, com o resultado e o motivo. Filtre para achar rápido quem ficou de fora."
    >
      <div className="flex flex-col gap-4 px-5 py-4 sm:px-6">
        <div role="group" aria-label="Filtrar linhas por resultado" className="flex flex-wrap gap-2">
          {FILTROS.map((item) => {
            const ativo = filtro === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => mudarFiltro(item.id)}
                aria-pressed={ativo}
                className={`inline-flex min-h-11 items-center rounded-pilula border px-4 text-sm font-medium transition-colors duration-[var(--transicao-rapida)] ${
                  ativo ? "border-[color:var(--latao)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel-elevado text-tinta-suave hover:border-[color:var(--latao)] hover:text-tinta"
                }`}
              >
                {item.rotulo}
              </button>
            );
          })}
        </div>

        <div aria-live="polite" aria-busy={carregando || undefined}>
          {carregando && <EsqueletoLista linhas={5} rotulo="Carregando as linhas…" />}
          {!carregando && Boolean(erro) && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar as linhas" />}

          {!carregando && !erro && dados && dados.itens.length === 0 && (
            <EstadoVazio compacto titulo="Nenhuma linha neste filtro" descricao={filtro === "todas" ? "O arquivo não gerou nenhuma linha." : "Troque o filtro para ver as demais linhas."} />
          )}

          {!carregando && !erro && dados && dados.itens.length > 0 && (
            <div className="overflow-hidden rounded-controle border border-linha">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Linhas da importação, uma por pessoa do arquivo</caption>
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-linha bg-papel text-left">
                    {["#", "Nome", "Resultado", "Motivo", "Avisos"].map((coluna) => (
                      <th key={coluna} scope="col" className="px-5 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {dados.itens.map((linha) => (
                    <tr key={linha.id} className="block px-4 py-3 align-top sm:table-row sm:p-0 hover:bg-papel">
                      <td className="block text-legenda tabular-nums text-tinta-fraca sm:table-cell sm:px-5 sm:py-3 sm:text-xs">
                        <span className="sm:hidden">linha </span>
                        {linha.numero}
                      </td>
                      <td className="block font-medium text-tinta sm:table-cell sm:px-5 sm:py-3">
                        {linha.dados.normalizado.nome || <span className="font-normal text-tinta-fraca">(sem nome)</span>}
                      </td>
                      <td className="block pt-1 sm:table-cell sm:px-5 sm:py-3">
                        <Selo tom={TOM_RESULTADO[linha.resultado]}>{ROTULO_RESULTADO[linha.resultado]}</Selo>
                      </td>
                      <td data-rotulo="Motivo:" className={`${CELULA_MOVEL} text-tinta-suave`}>
                        {formatarMotivo(linha.motivo)}
                      </td>
                      <td data-rotulo="Avisos:" className={`${CELULA_MOVEL} text-xs ${linha.dados.avisos && linha.dados.avisos.length > 0 ? "text-[color:var(--ambar)]" : "text-tinta-fraca"}`}>
                        {linha.dados.avisos && linha.dados.avisos.length > 0 ? linha.dados.avisos.join(" ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!carregando && dados && totalPaginas > 1 && (
          <nav aria-label="Páginas de linhas" className="flex flex-wrap items-center justify-between gap-3 text-sm text-tinta-suave">
            <span>
              Página {pagina} de {totalPaginas} · {dados.total} linha{dados.total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <Botao variante="secundario" tamanho="compacto" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                Anterior
              </Botao>
              <Botao variante="secundario" tamanho="compacto" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                Próxima
              </Botao>
            </div>
          </nav>
        )}
      </div>
    </Cartao>
  );
}
