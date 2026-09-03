"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import type { ResultadoLinhaImportacao } from "@/types/importacao";
import { listarLinhasImportacao } from "./api";
import { ROTULO_RESULTADO, TOM_RESULTADO, formatarMotivo } from "./campos";

const TAMANHO_PAGINA = 200;

const FILTROS: { id: ResultadoLinhaImportacao | "todas"; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "pessoa_nova", rotulo: "Pessoa nova" },
  { id: "pessoa_existente", rotulo: "Pessoa já existente" },
  { id: "jornada_nova", rotulo: "Jornada nova" },
  { id: "ignorada_jornada_aberta", rotulo: "Ignoradas" },
  { id: "erro", rotulo: "Com erro" },
];

/**
 * Tabela linha a linha da prévia (ou do resultado confirmado) — é isto que
 * deixa o operador VER o estrago antes de causá-lo: quantas, quais, por qual
 * motivo. Navegável por teclado: filtros são botões reais (Tab/Enter), a
 * tabela usa semântica nativa (nenhum grid customizado com roving tabindex
 * — desnecessário para uma tabela de leitura, e navegação nativa do
 * navegador já funciona com Tab/setas de leitura de tela).
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
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Filtrar linhas por resultado" className="flex flex-wrap gap-1.5">
        {FILTROS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => mudarFiltro(item.id)}
            aria-pressed={filtro === item.id}
            className={`rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors ${
              filtro === item.id
                ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)] text-tinta"
                : "border-linha-forte text-tinta-suave hover:text-tinta"
            }`}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      {carregando && <EstadoCarregando rotulo="Carregando linhas…" />}
      {!carregando && Boolean(erro) && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar as linhas" />}

      {!carregando && !erro && dados && dados.itens.length === 0 && (
        <EstadoVazio titulo="Nenhuma linha neste filtro" />
      )}

      {!carregando && !erro && dados && dados.itens.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-sm border border-linha">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">Linhas da importação, uma por pessoa do arquivo</caption>
              <thead>
                <tr className="border-b border-linha bg-papel-fundo text-left text-xs uppercase tracking-wide text-tinta-fraca">
                  <th scope="col" className="px-3 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Nome
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Resultado
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Motivo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Avisos
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((linha) => (
                  <tr key={linha.id} className="border-b border-linha last:border-0 align-top">
                    <td className="px-3 py-2 font-mono text-xs text-tinta-fraca">{linha.numero}</td>
                    <td className="px-3 py-2 text-tinta">{linha.dados.normalizado.nome || <span className="text-tinta-fraca">(sem nome)</span>}</td>
                    <td className="px-3 py-2">
                      <Selo tom={TOM_RESULTADO[linha.resultado]}>{ROTULO_RESULTADO[linha.resultado]}</Selo>
                    </td>
                    <td className="px-3 py-2 text-tinta-suave">{formatarMotivo(linha.motivo)}</td>
                    <td className="px-3 py-2 text-xs text-[color:var(--ambar)]">
                      {linha.dados.avisos && linha.dados.avisos.length > 0 ? linha.dados.avisos.join(" ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm text-tinta-suave">
              <span>
                Página {pagina} de {totalPaginas} · {dados.total} linha{dados.total === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <Botao variante="fantasma" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Botao>
                <Botao variante="fantasma" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                  Próxima
                </Botao>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
