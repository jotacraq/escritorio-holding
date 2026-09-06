import Link from "next/link";
import { TITULO_TRILHO, type BlocoSessao, type PassoTrilho } from "@/lib/pasta/trilho";

/**
 * O TRILHO na tela — os 9 passos de `derivarTrilho()` (`src/lib/pasta/trilho.ts`,
 * §8.1) desenhados como uma linha só: onde a família está, o que já ficou para
 * trás, o que ainda não aconteceu.
 *
 * Três variantes, um componente:
 * - `completo` — Ficha 360. Os 9 marcadores com rótulo, mais UMA ação: a do
 *   `derivarProximoPasso`, entregue pelo pai em `acao`. O componente NÃO
 *   deriva nada: recebe `passos` prontos e a ação pronta. Uma fonte só.
 * - `compacto` — cartão de Clientes e linha da Agenda. Os 9 pontos em 1 linha
 *   + o rótulo do passo aceso. Sem botão (o cartão já tem o dele).
 * - `sessoes` (Fase 6) — a Ficha. Os mesmos 9 passos AGRUPADOS nas três
 *   sessões que são a espinha do produto (Viabilidade · Croqui estrutural ·
 *   Entrega da holding), via `agruparPorSessao`. As três aparecem sempre; a
 *   ATUAL abre e mostra os micro-passos dela. Nove marcadores lado a lado
 *   diziam "onde estou" a quem já conhece o método; três dizem a quem não
 *   conhece. Nada é derivado aqui: os blocos chegam prontos em `sessoes`.
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

export type VarianteTrilho = "completo" | "compacto" | "sessoes";

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
  /** Obrigatório em `variante="sessoes"` — vem de `agruparPorSessao(passos)`. */
  sessoes?: BlocoSessao[];
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
  /**
   * O desfecho da jornada, quando ela NÃO está aberta ("Ganha", "Perdida",
   * "Congelada"...). Sem passo aceso, o resumo dizia "Parado" — e "parado" é
   * mentira numa jornada que fechou: ela não parou, ela terminou. Com o
   * desfecho na mão, o resumo diz o que de fato aconteceu.
   */
  desfecho?: string | null;
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

/**
 * Vazio rotulado quando ninguém está aceso: acabou, fechou, ou nunca começou.
 *
 * `desfecho` vem da jornada e tem precedência sobre "Parado": uma jornada
 * GANHA no meio do trilho não está parada — ela fechou, e o trilho tem de
 * dizer isso. Sem desfecho (jornada aberta e sem passo aceso), continua
 * "Parado", que aí é a verdade.
 */
function resumoSemAtual(passos: PassoTrilho[], desfecho?: string | null): string {
  const feitos = passos.filter((p) => p.estado === "feito").length;
  if (feitos === passos.length) return `${passos.length} de ${passos.length} · Entregue`;
  if (desfecho) return `${feitos} de ${passos.length} · ${desfecho}`;
  if (feitos === 0) return "Sem informação";
  return `${feitos} de ${passos.length} · Parado`;
}

/**
 * O `title` de um marcador: o nome inteiro do passo (o rótulo do trilho é ≤ 1
 * palavra por desenho — "Contato" é "Contato da equipe") mais o motivo, quando
 * existe. Detalhe fora do fluxo, na lei de texto (DS §3.1).
 */
function tituloDoPasso(passo: PassoTrilho): string {
  const nome = TITULO_TRILHO[passo.chave] ?? passo.rotulo;
  return passo.motivo ? `${nome} — ${passo.motivo}` : nome;
}

/**
 * O que o leitor de tela ouve em cada marcador — a ÚNICA leitura possível dele
 * (o glifo é `aria-hidden`, o rótulo visível também, e ele some abaixo de
 * `sm`). Fase 7: era `"3. Sessão: agora"`, que não diz de quantos passos é a
 * jornada nem usa o nome inteiro. Passa a ser **"passo 3 de 9: Sessão de
 * Viabilidade — agora"**: posição, tamanho do todo, nome de negócio e estado,
 * na ordem em que a pergunta se faz.
 */
function leituraDoPasso(passo: PassoTrilho, indice: number, total: number): string {
  const nome = TITULO_TRILHO[passo.chave] ?? passo.rotulo;
  const motivo = passo.motivo ? ` (${passo.motivo})` : "";
  return `passo ${indice + 1} de ${total}: ${nome} — ${TEXTO_ESTADO[passo.estado]}${motivo}`;
}

/** Um marcador de passo — extraído para `completo` e `sessoes` desenharem o MESMO passo. */
function MarcadorPasso({ passo, indice, total, ultimo }: { passo: PassoTrilho; indice: number; total: number; ultimo: boolean }) {
  const fechado = passo.estado === "feito" || passo.estado === "pulado";
  return (
    <li aria-current={passo.estado === "atual" ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center gap-1">
      {!ultimo && <span aria-hidden="true" className={`absolute left-1/2 top-[13px] h-0.5 w-full ${fechado ? "bg-[color:var(--verde)]" : "bg-linha-forte"}`} />}
      <span
        aria-hidden="true"
        title={tituloDoPasso(passo)}
        className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border ${ESTILO_MARCADOR[passo.estado]}`}
      >
        <Glifo estado={passo.estado} />
      </span>
      <span className="sr-only">{leituraDoPasso(passo, indice, total)}</span>
      <span aria-hidden="true" className={`hidden max-w-full truncate px-0.5 text-legenda leading-tight sm:block ${ESTILO_ROTULO[passo.estado]}`}>
        {passo.rotulo}
      </span>
    </li>
  );
}

const TEXTO_ESTADO_SESSAO = { feito: "concluída", atual: "em andamento", futuro: "ainda não começou" } as const;

const ESTILO_BLOCO = {
  feito: "border-linha bg-papel-fundo",
  atual: "border-[color:var(--latao)] bg-latao-fraco",
  futuro: "border-dashed border-linha bg-transparent",
} as const;

const ESTILO_NO_SESSAO = {
  feito: "border-transparent bg-verde-fraco text-[color:var(--verde)]",
  atual: "border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]",
  futuro: "border-linha-forte bg-papel-elevado text-tinta-fraca",
} as const;

export function Trilho({ passos, variante = "completo", sessoes, acao, nota, notaTitle, desfecho, rotulo = "Trilho da jornada", className = "" }: Props) {
  if (passos.length === 0) return null;
  const resumo = resumoDoTrilho(passos) ?? resumoSemAtual(passos, desfecho);

  if (variante === "sessoes" && sessoes) {
    return (
      <div className={`flex flex-col gap-item ${className}`}>
        <ol aria-label={rotulo} className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {sessoes.map((bloco, i) => (
            <li
              key={bloco.chave}
              aria-current={bloco.estado === "atual" ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-controle border px-2.5 py-1.5 ${ESTILO_BLOCO[bloco.estado]}`}
            >
              <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${ESTILO_NO_SESSAO[bloco.estado]}`}>
                {bloco.estado === "feito" ? <Glifo estado="feito" /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className={`truncate text-sm ${bloco.estado === "atual" ? "font-bold text-tinta" : "font-medium text-tinta-suave"}`}>{bloco.rotulo}</span>
                <span className="text-legenda text-tinta-fraca">
                  {bloco.resumo}
                  <span className="sr-only">{` — ${TEXTO_ESTADO_SESSAO[bloco.estado]}`}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* Os micro-passos SÓ da sessão acesa. Sem sessão acesa (jornada só
            com `null`), nenhuma abre — o trilho não inventa posição. */}
        {sessoes
          .filter((b) => b.estado === "atual")
          .map((bloco) => (
            <ol key={bloco.chave} aria-label={`Passos de ${bloco.rotulo}`} className="flex items-start">
              {bloco.passos.map((passo, i) => (
                <MarcadorPasso
                  key={passo.chave}
                  passo={passo}
                  indice={passos.findIndex((p) => p.chave === passo.chave)}
                  total={passos.length}
                  ultimo={i === bloco.passos.length - 1}
                />
              ))}
            </ol>
          ))}

        <div className="flex flex-wrap items-center justify-between gap-x-cartao gap-y-1">
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

  if (variante === "compacto") {
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
        <ol aria-label={rotulo} className="flex items-center gap-0.5">
          {passos.map((passo, i) => (
            <li
              key={passo.chave}
              aria-current={passo.estado === "atual" ? "step" : undefined}
              title={`${tituloDoPasso(passo)} — ${TEXTO_ESTADO[passo.estado]}`}
              className="min-w-0 flex-1"
            >
              <span aria-hidden="true" className={`block h-1.5 w-full rounded-full ${ESTILO_PONTO[passo.estado]}`} />
              <span className="sr-only">{leituraDoPasso(passo, i, passos.length)}</span>
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
                title={tituloDoPasso(passo)}
                className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border ${ESTILO_MARCADOR[passo.estado]}`}
              >
                <Glifo estado={passo.estado} />
              </span>
              <span className="sr-only">{leituraDoPasso(passo, i, passos.length)}</span>
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
      <Link href={acao.href} title={acao.title} data-acao-agora className={CLASSE_ACAO}>
        {acao.rotulo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={acao.onClick} title={acao.title} data-acao-agora className={CLASSE_ACAO}>
      {acao.rotulo}
    </button>
  );
}
