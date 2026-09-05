"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { EtapaJornada, EtapaOrdem, JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDoKanban } from "@/lib/pasta/sinais";
import { Cartao } from "@/components/ui/Cartao";
import { EstadoVazio } from "@/components/ui/Estado";
import { SeloDadoExemplo } from "@/components/ui/Selo";
import { Marcos, rotuloDiasNaEtapa } from "./CartaoJornada";
import { ChipProximoPasso } from "./ChipProximoPasso";
import { MenuMover } from "./MenuMover";
import { corDaEtapa } from "./etapas";

function LinhaJornada({
  jornada,
  etapas,
  emMovimento,
  aoMoverParaEtapa,
}: {
  jornada: JornadaKanban;
  etapas: EtapaOrdem[];
  emMovimento: boolean;
  aoMoverParaEtapa: (etapa: EtapaJornada) => void;
}) {
  const proximo = useMemo(() => derivarProximoPasso(sinaisDoKanban(jornada)), [jornada]);
  return (
    <li
      aria-busy={emMovimento}
      className={`grid min-h-11 grid-cols-1 gap-x-4 gap-y-2 px-5 py-3 transition-[background-color,opacity] duration-[var(--transicao-rapida)] hover:bg-papel sm:px-6 lg:grid-cols-[minmax(180px,1.3fr)_auto_minmax(220px,1.4fr)_auto_auto] lg:items-center ${
        emMovimento ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Link href={`/jornadas/${jornada.id}`} className="-my-3 truncate py-3 text-sm font-bold text-tinta hover:text-[color:var(--latao)]">
            {jornada.nome}
          </Link>
          {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
        </div>
        <p className="text-xs text-tinta-suave">
          {formatarCidadeUf(jornada.cidade, jornada.uf)}
          <span aria-hidden="true" className="mx-1.5 text-tinta-fraca">
            ·
          </span>
          {jornada.faixa_patrimonio_declarada ?? <span className="text-tinta-fraca">faixa não declarada</span>}
        </p>
      </div>
      <Marcos jornada={jornada} />
      <ChipProximoPasso proximo={proximo} jornadaId={jornada.id} tamanho="compacto" />
      <span className="text-xs text-tinta-fraca lg:text-right">{rotuloDiasNaEtapa(jornada.dias_na_etapa)}</span>
      <div className="flex justify-end">
        <MenuMover etapaAtual={jornada.etapa} etapas={etapas} ocupado={emMovimento} aoEscolher={aoMoverParaEtapa} rotulo="Mover" />
      </div>
    </li>
  );
}

/**
 * Visão "lista por etapa" — a alternativa ao quadro de 8 colunas com rolagem
 * horizontal (achado de UX, diário 04/09). Cada etapa é um cartão empilhado
 * na ordem da esteira; nenhuma informação do cartão do kanban se perde (nome,
 * cidade, faixa, marcos, próximo passo, dias, mover). Etapa vazia aparece como
 * uma linha só — presente, sem alarme.
 */
export function ListaPorEtapa({
  etapas,
  itens,
  idEmMovimento,
  aoMover,
}: {
  etapas: EtapaOrdem[];
  itens: JornadaKanban[];
  idEmMovimento: string | null;
  aoMover: (jornada: JornadaKanban, etapa: EtapaJornada) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {etapas.map((etapa) => {
        const cartoes = itens.filter((j) => j.etapa === etapa.etapa);
        return (
          <Cartao
            key={etapa.etapa}
            id={`etapa-${etapa.etapa}`}
            preenchimento="sem"
            rotulo={`Etapa ${etapa.ordem}`}
            titulo={
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: corDaEtapa(etapa.cor) }} />
                {etapa.rotulo}
              </span>
            }
            acao={
              <span className="inline-flex min-h-8 items-center rounded-full bg-papel px-3 text-sm font-bold tabular-nums text-tinta" aria-label={`${cartoes.length} ${cartoes.length === 1 ? "jornada" : "jornadas"}`}>
                {cartoes.length}
              </span>
            }
            className="scroll-mt-24"
          >
            {cartoes.length === 0 ? (
              <div className="px-5 py-4 sm:px-6">
                <EstadoVazio compacto titulo="Nenhuma jornada nesta etapa" />
              </div>
            ) : (
              <ul className="divide-y divide-linha">
                {cartoes.map((jornada) => (
                  <LinhaJornada key={jornada.id} jornada={jornada} etapas={etapas} emMovimento={idEmMovimento === jornada.id} aoMoverParaEtapa={(destino) => aoMover(jornada, destino)} />
                ))}
              </ul>
            )}
          </Cartao>
        );
      })}
    </div>
  );
}
