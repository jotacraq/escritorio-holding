"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Selo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import type { Importacao } from "@/types/importacao";
import { listarImportacoes } from "./api";

const ROTULO_STATUS: Record<Importacao["status"], { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  previa: { rotulo: "Prévia", tom: "azul" },
  confirmada: { rotulo: "Confirmada", tom: "verde" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

/** Histórico de importações — mais recente primeiro, cada linha leva ao
 * detalhe (prévia pendente ou resultado já confirmado). */
export function ListaImportacoes() {
  const buscar = useCallback(() => listarImportacoes({ pagina: 1 }), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (carregando) return <EstadoCarregando rotulo="Carregando importações…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar o histórico" />;
  if (!dados || dados.itens.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma importação ainda"
        descricao="Suba o primeiro CSV de leads do seminário em “Nova importação”."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {dados.itens.map((importacao) => {
        const status = ROTULO_STATUS[importacao.status];
        return (
          <li key={importacao.id}>
            <Link
              href={`/importacoes/${importacao.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-elevado p-3 transition-colors hover:border-linha-forte"
            >
              <div>
                <p className="font-medium text-tinta">{importacao.arquivo_nome}</p>
                <p className="text-xs text-tinta-suave">
                  {formatarDataHora(importacao.criado_em)} · {importacao.total_linhas} linha
                  {importacao.total_linhas === 1 ? "" : "s"}
                  {importacao.status === "previa" &&
                    ` · ${importacao.pessoas_novas + importacao.jornadas_novas} a gravar se confirmar`}
                  {importacao.status === "confirmada" &&
                    ` · ${importacao.pessoas_novas} pessoa(s) nova(s), ${importacao.jornadas_novas} jornada(s) nova(s)`}
                </p>
              </div>
              <Selo tom={status.tom}>{status.rotulo}</Selo>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
