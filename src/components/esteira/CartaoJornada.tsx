"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { EtapaOrdem, JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDoKanban } from "@/lib/pasta/sinais";
import { Cartao } from "@/components/ui/Cartao";
import { SeloDadoExemplo } from "@/components/ui/Selo";
import { ChipProximoPasso } from "./ChipProximoPasso";
import { MenuMover } from "./MenuMover";
import { corDaEtapa, etapaPorChave } from "./etapas";

/**
 * Marco do preparo (Formulário · Ligação · Briefing) — 12px mínimo, glifo +
 * texto (nunca só cor). `title` complementa; o texto já diz o estado.
 */
export function Marco({ ativo, rotulo }: { ativo: boolean; rotulo: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-legenda font-medium leading-tight ${
        ativo ? "border-transparent bg-verde-fraco text-[color:var(--verde)]" : "border-linha bg-papel text-tinta-fraca"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current">
        {ativo ? <path d="M4.7 8.4 2 5.7l1-1 1.7 1.7L9 2.1l1 1z" /> : <circle cx="6" cy="6" r="2" />}
      </svg>
      {rotulo}
      <span className="sr-only">{ativo ? " registrado" : " pendente"}</span>
    </span>
  );
}

export function Marcos({ jornada }: { jornada: JornadaKanban }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Preparo">
      <Marco ativo={jornada.tem_formulario} rotulo="Formulário" />
      <Marco ativo={jornada.tem_ligacao} rotulo="Ligação" />
      <Marco ativo={jornada.tem_briefing} rotulo="Briefing" />
    </div>
  );
}

export function rotuloDiasNaEtapa(dias: number): string {
  if (dias <= 0) return "entrou hoje";
  return `${dias} ${dias === 1 ? "dia" : "dias"} na etapa`;
}

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
  const proximo = useMemo(() => derivarProximoPasso(sinaisDoKanban(jornada)), [jornada]);
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

      <Marcos jornada={jornada} />

      <ChipProximoPasso proximo={proximo} jornadaId={jornada.id} tamanho="compacto" />

      <div className="flex items-center justify-between gap-2 border-t border-linha pt-2">
        <span className="text-xs text-tinta-fraca">{rotuloDiasNaEtapa(jornada.dias_na_etapa)}</span>
        <MenuMover etapaAtual={jornada.etapa} etapas={etapas} ocupado={emMovimento} aoEscolher={aoMoverParaEtapa} rotulo="Mover" />
      </div>
    </Cartao>
  );
}
