"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ApiError, listarJornadas, type JornadaKanban } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarCidadeUf } from "@/lib/formatar";

function ListaJornadas({ itens, vazioTitulo, vazioDescricao }: { itens: JornadaKanban[]; vazioTitulo: string; vazioDescricao: string }) {
  if (itens.length === 0) {
    return (
      <div className="px-5 py-5 sm:px-6">
        <EstadoVazio compacto titulo={vazioTitulo} descricao={vazioDescricao} />
      </div>
    );
  }
  return (
    <ul className="divide-y divide-linha">
      {itens.map((j) => (
        <li key={j.id}>
          <Link
            href={`/sessoes/${j.id}/conduzir`}
            className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:px-6"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-tinta">{j.nome}</span>
              <span className="text-xs text-tinta-fraca">{formatarCidadeUf(j.cidade, j.uf)}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-tinta-suave">
              {j.proxima_sessao_em && <span>{formatarDataHora(j.proxima_sessao_em)}</span>}
              {j.origem_dado === "exemplo" && <Selo tom="neutro">exemplo</Selo>}
              <span aria-hidden="true" className="text-tinta-fraca">
                →
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SelecionarSessaoApp() {
  const buscar = useCallback(
    () =>
      Promise.all([listarJornadas({ etapa: "sessao_agendada" }), listarJornadas({ etapa: "sessao_realizada" })]).then(([a, r]) => ({
        agendadas: a.itens,
        realizadas: r.itens,
      })),
    [],
  );
  const { dados, carregando, erro, recarregar: tentarNovamente } = useRecurso(buscar, []);
  const agendadas = dados?.agendadas ?? null;
  const realizadas = dados?.realizadas ?? null;

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo="Conduzir sessão"
        descricao="Escolha a jornada para abrir o roteiro da Sessão de Viabilidade em tela cheia — uma parte por vez, com os 4 SIMs e a oferta."
      />

      {carregando ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <EsqueletoLista linhas={4} />
          <EsqueletoLista linhas={3} />
        </div>
      ) : erro ? (
        <EstadoErro
          erro={erro}
          tentarNovamente={tentarNovamente}
          titulo={erro instanceof ApiError && erro.status === 403 ? "Sem permissão para ver as sessões" : "Não deu para carregar"}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Cartao rotulo="A conduzir" titulo="Sessões agendadas" descricao="Jornadas com sessão marcada e ainda não realizada." preenchimento="sem">
            <ListaJornadas
              itens={agendadas ?? []}
              vazioTitulo="Nenhuma sessão agendada aguardando condução"
              vazioDescricao="Quando um cliente marcar a sessão pelo link ou pela equipe, ela aparece aqui."
            />
          </Cartao>

          <Cartao rotulo="Já realizadas" titulo="Sessões realizadas" descricao="Para reabrir o roteiro, registrar oferta ou rever os SIMs." preenchimento="sem">
            <ListaJornadas itens={realizadas ?? []} vazioTitulo="Nenhuma sessão realizada ainda" vazioDescricao="A primeira sessão conduzida aparece aqui." />
          </Cartao>
        </div>
      )}
    </div>
  );
}
