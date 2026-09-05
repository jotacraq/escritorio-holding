import type { ReactNode } from "react";

export interface Passo {
  id: string;
  rotulo: string;
  /** Uma linha: o que acontece neste passo (aparece só no passo atual em telas estreitas). */
  descricao?: string;
  /** Quem faz ("Equipe", "Cliente", "Dra. Elaine"). */
  quem?: string;
}

interface PassosProps {
  passos: Passo[];
  /** `id` do passo atual. Passos antes dele são "feitos"; depois, "futuros". */
  atual: string;
  /** `aria-label` do `<nav>`/`<ol>`. */
  rotulo?: string;
  /** Torna cada passo clicável (ex.: navegar entre etapas de um formulário). */
  aoEscolher?: (id: string) => void;
  className?: string;
}

/**
 * Stepper horizontal: "onde estamos no processo". Estado nunca é só cor:
 * feito = check verde, atual = laranja + negrito + `aria-current="step"`,
 * futuro = contorno. Colapsa para lista vertical no celular.
 */
export function Passos({ passos, atual, rotulo = "Etapas do processo", aoEscolher, className = "" }: PassosProps) {
  const indiceAtual = Math.max(
    0,
    passos.findIndex((p) => p.id === atual),
  );

  return (
    <ol aria-label={rotulo} className={`flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-0 ${className}`}>
      {passos.map((passo, i) => {
        const estado: "feito" | "atual" | "futuro" = i < indiceAtual ? "feito" : i === indiceAtual ? "atual" : "futuro";
        const ultimo = i === passos.length - 1;
        const conteudo = (
          <>
            <span
              aria-hidden="true"
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors duration-[var(--transicao-rapida)] ${
                estado === "feito"
                  ? "border-[color:var(--verde)] bg-[color:var(--verde)] text-white"
                  : estado === "atual"
                    ? "border-[color:var(--latao-cta)] bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]"
                    : "border-linha-forte bg-papel-elevado text-tinta-fraca"
              }`}
            >
              {estado === "feito" ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 10.5l3.6 3.5 7.4-8" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={`text-sm leading-tight ${estado === "atual" ? "font-bold text-tinta" : estado === "feito" ? "font-medium text-tinta-suave" : "font-medium text-tinta-fraca"}`}>
                {passo.rotulo}
                <span className="sr-only">{estado === "feito" ? " (concluído)" : estado === "atual" ? " (etapa atual)" : " (ainda não)"}</span>
              </span>
              {passo.quem && <span className="text-legenda uppercase tracking-wide text-tinta-fraca">{passo.quem}</span>}
              {passo.descricao && estado === "atual" && <span className="mt-0.5 text-xs text-tinta-suave">{passo.descricao}</span>}
            </span>
          </>
        );

        return (
          <li key={passo.id} aria-current={estado === "atual" ? "step" : undefined} className="relative flex flex-1 items-start gap-3 sm:flex-col sm:gap-2">
            {!ultimo && (
              <span
                aria-hidden="true"
                className={`absolute left-[17px] top-9 h-[calc(100%-1.5rem)] w-0.5 sm:left-[calc(2.25rem+0.5rem)] sm:right-2 sm:top-[17px] sm:h-0.5 sm:w-auto ${i < indiceAtual ? "bg-[color:var(--verde)]" : "bg-linha-forte"}`}
              />
            )}
            {aoEscolher ? (
              <button
                type="button"
                onClick={() => aoEscolher(passo.id)}
                className="flex min-h-11 items-start gap-3 rounded-controle pr-3 text-left transition-colors duration-[var(--transicao-rapida)] hover:bg-papel-elevado sm:flex-col sm:gap-2"
              >
                {conteudo}
              </button>
            ) : (
              <Envolto>{conteudo}</Envolto>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Envolto({ children }: { children: ReactNode }) {
  return <span className="flex min-h-11 items-start gap-3 pr-3 sm:flex-col sm:gap-2">{children}</span>;
}
