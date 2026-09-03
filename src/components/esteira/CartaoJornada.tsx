"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { EtapaOrdem, JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { SeloDadoExemplo } from "@/components/ui/Selo";

const CORES_ETAPA: Record<string, string> = {
  slate: "#85837a",
  amber: "#92620a",
  blue: "#395a80",
  green: "#2f6b4f",
  violet: "#6b5b95",
  rose: "#9c3b2e",
};

function corDaEtapa(cor: string): string {
  return CORES_ETAPA[cor] ?? CORES_ETAPA.slate;
}

function Marco({ ativo, rotulo }: { ativo: boolean; rotulo: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium leading-none ${
        ativo ? "bg-verde-fraco text-[color:var(--verde)]" : "bg-papel-fundo text-tinta-fraca"
      }`}
      title={`${rotulo}: ${ativo ? "registrado" : "pendente"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-current">
        {ativo ? <path d="M4.7 8.4 2 5.7l1-1 1.7 1.7L9 2.1l1 1z" /> : <circle cx="6" cy="6" r="2" />}
      </svg>
      {rotulo}
    </span>
  );
}

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
  const [menuAberto, setMenuAberto] = useState(false);
  const idMenu = useId();
  const destinos = etapas.filter((e) => e.etapa !== jornada.etapa);

  return (
    <div
      draggable
      onDragStart={aoIniciarArrasto}
      aria-roledescription="cartão da esteira, arrastável"
      aria-busy={emMovimento}
      className={`group relative flex flex-col gap-2 rounded-sm border border-linha bg-papel-elevado p-3 shadow-[var(--sombra-cartao)] transition-opacity ${
        arrastando ? "opacity-40" : ""
      } ${emMovimento ? "opacity-60" : ""}`}
      style={{ borderLeftWidth: 3, borderLeftColor: corDaEtapa(etapas.find((e) => e.etapa === jornada.etapa)?.cor ?? "slate") }}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/jornadas/${jornada.id}`} className="min-w-0 font-serif text-[15px] font-medium leading-snug text-tinta hover:text-[color:var(--latao)]">
          {jornada.nome}
        </Link>
        {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
      </div>

      <p className="font-mono text-[11px] uppercase tracking-wide text-tinta-fraca">{formatarCidadeUf(jornada.cidade, jornada.uf)}</p>

      <p className="text-xs text-tinta-suave">
        {jornada.faixa_patrimonio_declarada ?? <span className="italic text-tinta-fraca">faixa não declarada</span>}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Marco ativo={jornada.tem_formulario} rotulo="Formulário" />
        <Marco ativo={jornada.tem_ligacao} rotulo="Ligação" />
        <Marco ativo={jornada.tem_briefing} rotulo="Briefing" />
      </div>

      <div className="flex items-center justify-between border-t border-linha pt-2 text-[11px] text-tinta-fraca">
        <span>
          {jornada.dias_na_etapa} {jornada.dias_na_etapa === 1 ? "dia" : "dias"} na etapa
        </span>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            aria-controls={idMenu}
            onClick={() => setMenuAberto((v) => !v)}
            className="rounded-sm border border-transparent px-1.5 py-0.5 font-sans text-[11px] font-medium text-tinta-suave opacity-0 hover:border-linha-forte hover:text-tinta focus-visible:opacity-100 group-hover:opacity-100"
          >
            Mover para…
          </button>
          {menuAberto && (
            <ul id={idMenu} role="menu" className="absolute right-0 z-10 mt-1 w-48 rounded-sm border border-linha bg-papel-elevado py-1 shadow-lg">
              {destinos.map((destino) => (
                <li key={destino.etapa} role="none">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuAberto(false);
                      aoMoverParaEtapa(destino.etapa);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-tinta hover:bg-papel-fundo"
                  >
                    {destino.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
