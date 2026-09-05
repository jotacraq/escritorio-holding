import Link from "next/link";
import type { ReactNode } from "react";
import { hrefDoPasso, ROTULO_DONO, ROTULO_URGENCIA, type DonoPasso, type ProximoPasso, type UrgenciaPasso } from "@/lib/pasta/proximo-passo";

/**
 * O chip "próximo passo · de quem" — UM componente para Esteira (cartão do
 * kanban), Painel do Dia (filas), Agenda (linha do agendamento) e Ficha 360
 * (agente H, Onda 2). Sempre alimentado por `derivarProximoPasso()`; nunca
 * monta texto próprio.
 *
 * Leitura de relance para quem tem 60+ anos e não vive de dashboard:
 *  [ícone do dono]  Ligar para o cliente          EQUIPE · HOJE
 * Estado nunca é só cor: dono e urgência vêm em texto; o ícone reforça.
 * `dono='ninguem'` (nada pendente / sem informação) fica neutro, tracejado,
 * e o texto diz exatamente isso — vazio rotulado, não vazio mudo.
 */

const ESTILO_DONO: Record<DonoPasso, { chip: string; icone: string }> = {
  equipe: { chip: "border-transparent bg-latao-fraco text-tinta", icone: "text-[color:var(--latao)]" },
  advogada: { chip: "border-transparent bg-azul-fraco text-tinta", icone: "text-[color:var(--azul)]" },
  cliente: { chip: "border-transparent bg-ambar-fraco text-tinta", icone: "text-[color:var(--ambar)]" },
  sistema: { chip: "border-transparent bg-verde-fraco text-tinta", icone: "text-[color:var(--verde)]" },
  ninguem: { chip: "border-dashed border-linha-forte bg-transparent text-tinta-suave", icone: "text-tinta-fraca" },
};

const ESTILO_URGENCIA: Record<UrgenciaPasso, string> = {
  hoje: "text-[color:var(--vermelho)]",
  esta_semana: "text-[color:var(--ambar)]",
  quando_der: "text-tinta-fraca",
};

/* Ícones 20×20, traço, um por dono — decorativos (`aria-hidden`). */
const ICONE_DONO: Record<DonoPasso, ReactNode> = {
  equipe: <path d="M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5M12 11.5c2.3 0 4 1.8 4 4.5" />,
  advogada: <path d="M10 2.5v15M5 6.5h10M4 6.5l-2.5 5a2.5 2.5 0 0 0 5 0L4 6.5Zm12 0-2.5 5a2.5 2.5 0 0 0 5 0L16 6.5ZM7 17.5h6" />,
  cliente: <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5" />,
  sistema: <path d="M10 6.5V3M10 17v-3.5M13.5 10H17M3 10h3.5M12.5 7.5l2.4-2.4M5.1 14.9l2.4-2.4M12.5 12.5l2.4 2.4M5.1 5.1l2.4 2.4M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  ninguem: <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-3-7h6" />,
};

interface Props {
  proximo: ProximoPasso;
  /** Quando informado, o chip vira link para a aba certa da Ficha 360. */
  jornadaId?: string | null;
  /** `compacto`: uma linha, para cartão do kanban. `normal`: duas linhas, para filas. */
  tamanho?: "compacto" | "normal";
  className?: string;
}

export function ChipProximoPasso({ proximo, jornadaId, tamanho = "normal", className = "" }: Props) {
  const estilo = ESTILO_DONO[proximo.dono];
  const compacto = tamanho === "compacto";
  const conteudo = (
    <>
      <span className="sr-only">Próximo passo: </span>
      <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 ${estilo.icone}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ICONE_DONO[proximo.dono]}
      </svg>
      <span className={`flex min-w-0 flex-1 ${compacto ? "flex-row items-center gap-2" : "flex-col gap-0.5"}`}>
        <span className={`min-w-0 truncate text-sm font-medium leading-tight ${compacto ? "" : "whitespace-normal"}`}>{proximo.passo}</span>
        <span className="shrink-0 text-legenda font-medium uppercase tracking-wide">
          <span className="sr-only">de quem: </span>
          <span className={proximo.dono === "ninguem" ? "text-tinta-fraca" : "text-tinta-suave"}>{ROTULO_DONO[proximo.dono]}</span>
          <span aria-hidden="true" className="mx-1 text-tinta-fraca">
            ·
          </span>
          <span className="sr-only">urgência: </span>
          <span className={ESTILO_URGENCIA[proximo.urgencia]}>{ROTULO_URGENCIA[proximo.urgencia]}</span>
        </span>
      </span>
    </>
  );

  const clicavel = Boolean(jornadaId && proximo.rota);
  // Alvo ≥ 44px sempre que for clicável; o chip só encolhe (36px) quando é texto puro.
  const classes = `inline-flex max-w-full items-center gap-2 rounded-controle border px-2.5 ${compacto && !clicavel ? "min-h-9 py-1" : "min-h-11 py-1.5"} ${estilo.chip} ${className}`;

  if (clicavel && jornadaId) {
    return (
      <Link
        href={hrefDoPasso(jornadaId, proximo)}
        className={`${classes} transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:shadow-cartao`}
      >
        {conteudo}
      </Link>
    );
  }

  return <span className={classes}>{conteudo}</span>;
}
