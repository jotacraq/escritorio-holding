import Link from "next/link";
import type { PassoTrilho } from "@/lib/pasta/trilho";

/**
 * O TRILHO na tela — os 9 passos de `derivarTrilho()` (`src/lib/pasta/trilho.ts`,
 * §8.1) desenhados como uma linha só: onde a família está, o que já ficou para
 * trás, o que ainda não aconteceu.
 *
 * Duas variantes, um componente (§1.3):
 * - `completo` — Ficha 360. Os 9 marcadores com rótulo, mais UMA ação: a do
 *   `derivarProximoPasso`, entregue pelo pai em `acao`. O componente NÃO
 *   deriva nada: recebe `passos` prontos e a ação pronta. Uma fonte só.
 * - `compacto` — cartão da Esteira e linha da Agenda. Os 9 pontos em 1 linha
 *   + o rótulo do passo aceso. Sem botão (o cartão já tem o dele).
 *
 * LEI DE TEXTO (§2): número primeiro ("5 de 9 · Sessão"), rótulo ≤ 3 palavras
 * (vem de `ROTULO_TRILHO`, já curto), zero prosa. O `motivo` do passo, quando
 * existe, vai para o `title` do marcador — nunca para um parágrafo.
 *
 * ESTADO NUNCA É SÓ COR: cada estado tem glifo próprio (check · seta cheia ·
 * traço de pulado · círculo vazio) e texto para leitor de tela. Os dois temas
 * saem dos tokens (`--verde`, `--latao-cta`, `--linha-forte`), nunca de hex.
 *
 * A11Y: `<ol>` semântica, `aria-current="step"` no passo aceso, rótulo textual
 * de cada passo em `sr-only` (o rótulo visível some abaixo de `sm` para não
 * cair de 13px — o texto para leitor de tela fica). Alvo de toque ≥ 44px só
 * onde há ação (o botão); marcador é indicador, não controle.
 */

export type VarianteTrilho = "completo" | "compacto";

/** A ação única do passo aceso. `href` OU `onClick` — nunca os dois. */
export interface AcaoTrilho {
  /** Verbo curto ("Ligar para o cliente"). Vem de `derivarProximoPasso().passo`. */
  rotulo: string;
  href?: string;
  onClick?: () => void;
  /** Detalhe/sigla — só no `title`, nunca no fluxo. */
  title?: string;
}

interface Props {
  passos: PassoTrilho[];
  variante?: VarianteTrilho;
  /** Só faz sentido em `completo`; ignorada em `compacto`. */
  acao?: AcaoTrilho | null;
  /**
   * O que está acontecendo quando NÃO há ação clicável ("Aguardando a compra
   * · Cliente"). É informação, não botão: `derivarProximoPasso` devolve
   * `rota: null` justamente quando não há para onde ir, e um botão que não
   * leva a lugar nenhum é pior que texto honesto.
   */
  nota?: string | null;
  /** A frase inteira por trás da `nota` — vai no `title`, nunca no fluxo. */
  notaTitle?: string;
  /** `aria-label` da lista. */
  rotulo?: string;
  className?: string;
}

const TEXTO_ESTADO = {
  feito: "concluído",
  atual: "agora",
  futuro: "ainda não",
  pulado: "pulado",
} as const;

/* Glifos 20×20, um por estado — a forma, não a cor, é o que distingue. */
const GLIFO = {
  feito: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  atual: <path d="M7.5 5.5l5.5 4.5-5.5 4.5" />,
  futuro: <circle cx="10" cy="10" r="3" />,
  pulado: <path d="M5.5 14.5l9-9" />,
} as const;

const ESTILO_MARCADOR = {
  feito: "border-transparent bg-verde-fraco text-[color:var(--verde)]",
  atual: "border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)] shadow-[0_0_0_3px_var(--latao-fraco)]",
  futuro: "border-linha-forte bg-papel-elevado text-tinta-fraca",
  pulado: "border-dashed border-linha-forte bg-transparent text-tinta-fraca",
} as const;

const ESTILO_ROTULO = {
  feito: "text-tinta-suave",
  atual: "font-bold text-tinta",
  futuro: "text-tinta-fraca",
  pulado: "text-tinta-fraca line-through decoration-linha-forte",
} as const;

/** Ponto do modo compacto: 6px de altura, cor + forma (o pulado fica vazado). */
const ESTILO_PONTO = {
  feito: "bg-[color:var(--verde)]",
  atual: "bg-[color:var(--latao-cta)] ring-2 ring-[color:var(--latao-fraco)]",
  futuro: "bg-linha-forte",
  pulado: "border border-dashed border-linha-forte bg-transparent",
} as const;

function Glifo({ estado }: { estado: PassoTrilho["estado"] }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {GLIFO[estado]}
    </svg>
  );
}

/** "5 de 9 · Sessão" — número primeiro, sempre. `null` quando não há passo aceso. */
export function resumoDoTrilho(passos: PassoTrilho[]): string | null {
  const indice = passos.findIndex((p) => p.estado === "atual");
  if (indice === -1) return null;
  const passo = passos[indice];
  const progresso = passo.progresso ? ` · ${passo.progresso.feitos} de ${passo.progresso.total}` : "";
  return `${indice + 1} de ${passos.length} · ${passo.rotulo}${progresso}`;
}

/** Vazio rotulado quando ninguém está aceso: acabou ou nunca começou. */
function resumoSemAtual(passos: PassoTrilho[]): string {
  const feitos = passos.filter((p) => p.estado === "feito").length;
  if (feitos === passos.length) return `${passos.length} de ${passos.length} · Entregue`;
  if (feitos === 0) return "Sem informação";
  return `${feitos} de ${passos.length} · Parado`;
}

export function Trilho({ passos, variante = "completo", acao, nota, notaTitle, rotulo = "Trilho da jornada", className = "" }: Props) {
  if (passos.length === 0) return null;
  const resumo = resumoDoTrilho(passos) ?? resumoSemAtual(passos);

  if (variante === "compacto") {
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
        <ol aria-label={rotulo} className="flex items-center gap-0.5">
          {passos.map((passo, i) => (
            <li
              key={passo.chave}
              aria-current={passo.estado === "atual" ? "step" : undefined}
              title={passo.motivo ? `${passo.rotulo} — ${TEXTO_ESTADO[passo.estado]}: ${passo.motivo}` : `${passo.rotulo} — ${TEXTO_ESTADO[passo.estado]}`}
              className="min-w-0 flex-1"
            >
              <span aria-hidden="true" className={`block h-1.5 w-full rounded-full ${ESTILO_PONTO[passo.estado]}`} />
              <span className="sr-only">{`${i + 1}. ${passo.rotulo}: ${TEXTO_ESTADO[passo.estado]}`}</span>
            </li>
          ))}
        </ol>
        <p className="truncate text-xs font-medium text-tinta-suave">{resumo}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <ol aria-label={rotulo} className="flex items-start">
        {passos.map((passo, i) => {
          const ultimo = i === passos.length - 1;
          const anteriorFechado = passo.estado === "feito" || passo.estado === "pulado";
          return (
            <li
              key={passo.chave}
              aria-current={passo.estado === "atual" ? "step" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              {!ultimo && (
                <span
                  aria-hidden="true"
                  className={`absolute left-1/2 top-[13px] h-0.5 w-full ${anteriorFechado ? "bg-[color:var(--verde)]" : "bg-linha-forte"}`}
                />
              )}
              <span
                aria-hidden="true"
                title={passo.motivo ?? undefined}
                className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border ${ESTILO_MARCADOR[passo.estado]}`}
              >
                <Glifo estado={passo.estado} />
              </span>
              <span className="sr-only">{`${i + 1}. ${passo.rotulo}: ${TEXTO_ESTADO[passo.estado]}${passo.motivo ? ` (${passo.motivo})` : ""}`}</span>
              <span aria-hidden="true" className={`hidden max-w-full truncate px-0.5 text-xs leading-tight sm:block ${ESTILO_ROTULO[passo.estado]}`}>
                {passo.rotulo}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm font-medium text-tinta">
          {resumo}
          {!acao && nota && (
            <span title={notaTitle} className="font-normal text-tinta-suave">
              {" · "}
              {nota}
            </span>
          )}
        </p>
        {acao && <BotaoDoTrilho acao={acao} />}
      </div>
    </div>
  );
}

const CLASSE_ACAO =
  "nao-imprimir inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pilula border border-transparent bg-[color:var(--latao-cta)] px-4 py-2 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] transition-colors duration-[var(--transicao-rapida)] hover:bg-[color:var(--latao-cta-forte)] hover:shadow-none active:translate-y-[1px] active:shadow-none";

function BotaoDoTrilho({ acao }: { acao: AcaoTrilho }) {
  if (acao.href) {
    return (
      <Link href={acao.href} title={acao.title} className={CLASSE_ACAO}>
        {acao.rotulo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={acao.onClick} title={acao.title} className={CLASSE_ACAO}>
      {acao.rotulo}
    </button>
  );
}
