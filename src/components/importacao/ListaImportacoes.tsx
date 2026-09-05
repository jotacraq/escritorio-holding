"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import type { Importacao } from "@/types/importacao";
import { listarImportacoes } from "./api";
import { frasePlural } from "./campos";

export const ROTULO_STATUS: Record<Importacao["status"], { rotulo: string; tom: TomSelo }> = {
  previa: { rotulo: "Prévia — aguardando confirmação", tom: "ambar" },
  confirmada: { rotulo: "Confirmada", tom: "verde" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

function resumoDe(importacao: Importacao): string {
  const partes = [formatarDataHora(importacao.criado_em), frasePlural(importacao.total_linhas, "linha", "linhas")];
  if (importacao.status === "previa") partes.push(`${importacao.pessoas_novas + importacao.jornadas_novas} a gravar se confirmar`);
  if (importacao.status === "confirmada")
    partes.push(`${frasePlural(importacao.pessoas_novas, "pessoa nova", "pessoas novas")}, ${frasePlural(importacao.jornadas_novas, "jornada nova", "jornadas novas")}`);
  return partes.join(" · ");
}

/** Histórico de importações — mais recente primeiro, cada linha leva ao
 * detalhe (prévia pendente ou resultado já confirmado). */
export function ListaImportacoes() {
  const router = useRouter();
  const buscar = useCallback(() => listarImportacoes({ pagina: 1 }), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (carregando) return <EsqueletoLista linhas={4} rotulo="Carregando as importações…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar o histórico" />;
  if (!dados || dados.itens.length === 0) {
    return (
      <EstadoVazio
        ilustracao="lista"
        titulo="Nenhuma importação ainda"
        descricao="Suba o CSV de leads de uma edição do seminário. Nada é gravado antes de você conferir a prévia e confirmar."
        acao={
          <Botao variante="secundario" onClick={() => router.push("/importacoes/nova")}>
            Começar a primeira importação
          </Botao>
        }
      />
    );
  }

  const pendentes = dados.itens.filter((i) => i.status === "previa").length;

  return (
    <Cartao
      preenchimento="sem"
      rotulo="Histórico"
      titulo={`${dados.total} importa${dados.total === 1 ? "ção" : "ções"}`}
      descricao={pendentes > 0 ? `${frasePlural(pendentes, "prévia aguarda", "prévias aguardam")} sua confirmação.` : "Todas as importações já foram confirmadas ou canceladas."}
    >
      <ul className="divide-y divide-linha">
        {dados.itens.map((importacao) => {
          const status = ROTULO_STATUS[importacao.status];
          return (
            <li key={importacao.id}>
              <Link
                href={`/importacoes/${importacao.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel focus-visible:bg-papel sm:px-6"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium text-tinta">{importacao.arquivo_nome}</span>
                  <span className="text-xs text-tinta-suave">{resumoDe(importacao)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Selo tom={status.tom}>{status.rotulo}</Selo>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-tinta-fraca" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 5l5 5-5 5" />
                  </svg>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}
