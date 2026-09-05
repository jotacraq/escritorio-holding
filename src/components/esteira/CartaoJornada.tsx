"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { EtapaOrdem, JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDoKanban } from "@/lib/pasta/sinais";
import { derivarTrilho } from "@/lib/pasta/trilho";
import { Cartao } from "@/components/ui/Cartao";
import { SeloDadoExemplo } from "@/components/ui/Selo";
import { Trilho } from "@/components/ui/Trilho";
import { ChipProximoPasso } from "./ChipProximoPasso";
import { MenuMover } from "./MenuMover";
import { corDaEtapa, etapaPorChave } from "./etapas";

/**
 * Fase 5 — os três chips de preparo (Formulário · Ligação · Briefing) saíram
 * daqui. O `Trilho` compacto já diz onde a família está nos 9 passos, e o
 * `ChipProximoPasso` já diz o que fazer: repetir o preparo em chip era a
 * terceira leitura do mesmo estado dentro de um cartão de 6 linhas. Nada foi
 * perdido — Formulário e Preparo continuam no Painel ("Preparo pendente") e
 * na Pasta do cliente, que são as telas de quem age sobre eles.
 */
/** Número primeiro e nada mais: "na etapa" vive no `title` (ver `TITULO_DIAS`). */
export function rotuloDiasNaEtapa(dias: number): string {
  if (dias <= 0) return "hoje";
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export const TITULO_DIAS = "dias nesta etapa";

/**
 * Cartão da esteira: nome (link para a Ficha), cidade, faixa declarada,
 * marcos do preparo, o chip "próximo passo · de quem" (a mesma derivação do
 * Painel e da Agenda) e o menu "Mover para…". Continua arrastável.
 */
export function CartaoJornada({
  jornada,
  etapas,
  arrastando,
  emMovimento,
  aoIniciarArrasto,
  aoMoverParaEtapa,
}: {
  jornada: JornadaKanban;
  etapas: EtapaOrdem[];
  arrastando: boolean;
  emMovimento: boolean;
  aoIniciarArrasto: (evento: React.DragEvent) => void;
  aoMoverParaEtapa: (etapa: EtapaOrdem["etapa"]) => void;
}) {
  // Uma leitura só do payload: os mesmos `Sinais` alimentam a posição no
  // trilho e o próximo passo. Sem execução (a linha do kanban não a carrega),
  // os três passos finais ficam "sem informação" — nunca zero.
  const sinais = useMemo(() => sinaisDoKanban(jornada), [jornada]);
  const proximo = useMemo(() => derivarProximoPasso(sinais), [sinais]);
  const passos = useMemo(() => derivarTrilho(sinais), [sinais]);
  const cor = corDaEtapa(etapaPorChave(etapas, jornada.etapa)?.cor);

  return (
    <Cartao
      como="article"
      preenchimento="compacto"
      draggable
      onDragStart={aoIniciarArrasto}
      aria-roledescription="cartão da esteira, arrastável"
      aria-busy={emMovimento}
      aria-label={jornada.nome}
      className={`group flex flex-col gap-3 border-l-4 transition-[opacity,box-shadow,transform] duration-[var(--transicao-rapida)] hover:shadow-flutuante ${
        arrastando ? "opacity-40" : ""
      } ${emMovimento ? "opacity-60" : ""}`}
      style={{ borderLeftColor: cor }}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/jornadas/${jornada.id}`}
          className="-my-2.5 min-w-0 py-2.5 text-subtitulo font-bold leading-snug text-tinta transition-colors duration-[var(--transicao-rapida)] hover:text-[color:var(--latao)]"
        >
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

      <Trilho passos={passos} variante="compacto" rotulo={`Trilho de ${jornada.nome}`} />

      <ChipProximoPasso proximo={proximo} jornadaId={jornada.id} tamanho="compacto" />

      <div className="flex items-center justify-between gap-2 border-t border-linha pt-2">
        <span title={TITULO_DIAS} className="text-xs text-tinta-fraca">
          {rotuloDiasNaEtapa(jornada.dias_na_etapa)}
        </span>
        <MenuMover etapaAtual={jornada.etapa} etapas={etapas} ocupado={emMovimento} aoEscolher={aoMoverParaEtapa} rotulo="Mover" />
      </div>
    </Cartao>
  );
}
