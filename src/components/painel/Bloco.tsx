import type { ReactNode } from "react";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import type { EstadoBloco } from "@/types/painel-ui";

/**
 * Ícone de "tudo certo" — check dentro de círculo. Usado só quando um bloco
 * validou com array vazio: "nada pendente" é notícia boa, não o mesmo vazio
 * cinza de "nenhum resultado encontrado" do resto do sistema (CLAUDE.md /
 * ARQUITETURA-FASE-2 §8 UX).
 */
function IconeTudoCerto() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current">
      <path d="M10 1.5A8.5 8.5 0 1 0 18.5 10 8.51 8.51 0 0 0 10 1.5Zm4.28 6.2-4.9 5.6a1 1 0 0 1-1.43.07l-2.6-2.4a1 1 0 1 1 1.36-1.47l1.85 1.71 4.2-4.8a1 1 0 0 1 1.52 1.3Z" />
    </svg>
  );
}

function IconeIndisponivel() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current">
      <path d="M10 1.5A8.5 8.5 0 1 0 18.5 10 8.51 8.51 0 0 0 10 1.5Zm.75 12.75h-1.5v-1.5h1.5Zm0-3h-1.5v-5h1.5Z" />
    </svg>
  );
}

interface Props<T> {
  id: string;
  /** Rótulo pequeno em caixa alta acima do título (a "seção"). */
  rotulo?: string;
  titulo: string;
  legenda: string;
  /** Mostrado dentro do bloco quando o array validou vazio — é a boa notícia, não um vazio genérico. */
  mensagemNadaPendente: string;
  estado: EstadoBloco<T>;
  /** Realce visual para o bloco mais urgente da tela (bloco 3 — dinheiro pago sem contato). */
  urgente?: boolean;
  aoTentarDeNovo: () => void;
  children: (itens: T[]) => ReactNode;
}

/**
 * Um bloco do Painel do Dia: `Cartao` com contagem no cabeçalho, três
 * estados isolados (indisponível · nada pendente · lista) e a lista SEM
 * padding (as linhas têm o seu, com divisor). Vazio validado é verde;
 * indisponível é alerta com "tentar de novo" — nunca a mesma coisa.
 */
export function Bloco<T>({ id, rotulo, titulo, legenda, mensagemNadaPendente, estado, urgente, aoTentarDeNovo, children }: Props<T>) {
  const contagem = estado.situacao === "ok" ? estado.itens.length : null;
  const urgenteAtivo = Boolean(urgente && contagem !== null && contagem > 0);

  return (
    <Cartao
      id={id}
      aria-labelledby={`${id}-titulo`}
      preenchimento="sem"
      realce={urgenteAtivo ? "vermelho" : undefined}
      rotulo={rotulo}
      titulo={<span id={`${id}-titulo`}>{titulo}</span>}
      descricao={legenda}
      acao={
        contagem !== null && contagem > 0 ? (
          <span
            aria-label={`${contagem} ${contagem === 1 ? "item" : "itens"}`}
            className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-full px-3 text-sm font-bold tabular-nums ${
              urgenteAtivo ? "bg-vermelho-fraco text-[color:var(--vermelho)]" : "bg-latao-fraco text-tinta"
            }`}
          >
            {contagem}
          </span>
        ) : undefined
      }
    >
      {estado.situacao === "indisponivel" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-tinta-suave sm:px-6">
          <IconeIndisponivel />
          <span>Não conseguiu carregar este bloco agora.</span>
          <Botao variante="secundario" tamanho="compacto" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}

      {estado.situacao === "ok" && estado.itens.length === 0 && (
        <p className="flex items-center gap-2.5 px-5 py-4 text-sm font-medium text-[color:var(--verde)] sm:px-6">
          <IconeTudoCerto />
          {mensagemNadaPendente}
        </p>
      )}

      {estado.situacao === "ok" && estado.itens.length > 0 && children(estado.itens)}
    </Cartao>
  );
}

/** Linha padrão de uma fila do painel: ≥ 44px, divisor, hover suave, empilha no celular. */
export function LinhaFila({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <li className={`flex min-h-11 flex-col gap-2 px-5 py-3 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:px-6 ${className}`}>
      {children}
    </li>
  );
}
