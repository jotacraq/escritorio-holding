import type { ReactNode } from "react";
import type { EstadoBloco } from "@/types/painel-ui";

/**
 * Ícone de "tudo certo" — check dentro de círculo. Usado só quando um bloco
 * validou com array vazio: "nada pendente" é notícia boa, não o mesmo vazio
 * cinza de "nenhum resultado encontrado" do resto do sistema (CLAUDE.md /
 * ARQUITETURA-FASE-2 §8 UX).
 */
function IconeTudoCerto() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current">
      <path d="M10 1.5A8.5 8.5 0 1 0 18.5 10 8.51 8.51 0 0 0 10 1.5Zm4.28 6.2-4.9 5.6a1 1 0 0 1-1.43.07l-2.6-2.4a1 1 0 1 1 1.36-1.47l1.85 1.71 4.2-4.8a1 1 0 0 1 1.52 1.3Z" />
    </svg>
  );
}

function IconeIndisponivel() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current">
      <path d="M10 1.5A8.5 8.5 0 1 0 18.5 10 8.51 8.51 0 0 0 10 1.5Zm.75 12.75h-1.5v-1.5h1.5Zm0-3h-1.5v-5h1.5Z" />
    </svg>
  );
}

interface Props<T> {
  id: string;
  titulo: string;
  legenda: string;
  /** Mostrado dentro do bloco quando o array validou vazio — é a boa notícia, não um vazio genérico. */
  mensagemNadaPendente: string;
  estado: EstadoBloco<T>;
  /** Realce visual para o bloco mais urgente da tela (bloco 3 — dinheiro pago sem contato). */
  urgente?: boolean;
  aoTentarDeNovo: () => void;
  filhos: (itens: T[]) => ReactNode;
}

export function Bloco<T>({ id, titulo, legenda, mensagemNadaPendente, estado, urgente, aoTentarDeNovo, filhos }: Props<T>) {
  const contagem = estado.situacao === "ok" ? estado.itens.length : null;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={`rounded-sm border bg-papel-elevado ${
        urgente && estado.situacao === "ok" && estado.itens.length > 0
          ? "border-[color:var(--vermelho)]"
          : "border-linha"
      }`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-linha px-4 py-3 sm:px-5">
        <div>
          <h2 id={`${id}-titulo`} className="font-serif text-lg font-semibold text-tinta">
            {titulo}
          </h2>
          <p className="text-xs text-tinta-suave">{legenda}</p>
        </div>
        {contagem !== null && contagem > 0 && (
          <span
            className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
              urgente ? "bg-vermelho-fraco text-[color:var(--vermelho)]" : "bg-latao-fraco text-[color:var(--latao-forte)]"
            }`}
          >
            {contagem}
          </span>
        )}
      </header>

      <div className="px-4 py-3 sm:px-5">
        {estado.situacao === "indisponivel" && (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 py-2 text-sm text-tinta-suave">
            <IconeIndisponivel />
            <span>Não conseguiu carregar este bloco agora.</span>
            <button
              type="button"
              onClick={aoTentarDeNovo}
              className="rounded-sm border border-linha-forte px-2 py-1 text-xs font-medium text-tinta hover:bg-papel"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {estado.situacao === "ok" && estado.itens.length === 0 && (
          <p className="flex items-center gap-2 py-2 text-sm font-medium text-[color:var(--verde)]">
            <IconeTudoCerto />
            {mensagemNadaPendente}
          </p>
        )}

        {estado.situacao === "ok" && estado.itens.length > 0 && filhos(estado.itens)}
      </div>
    </section>
  );
}
