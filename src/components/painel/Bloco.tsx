import type { ReactNode } from "react";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Dica } from "@/components/ui/Dica";
import type { EstadoBloco } from "@/types/painel-ui";

/**
 * Ícone de "tudo certo" — check dentro de círculo. Usado só quando um bloco
 * validou com array vazio: "nada pendente" é notícia boa, não o mesmo vazio
 * cinza de "nenhum resultado encontrado" do resto do sistema (CLAUDE.md /
 * ARQUITETURA-FASE-2 §8 UX).
 */
function IconeTudoCerto() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current text-[color:var(--verde)]">
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

function IconeInfo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 9v4.2M10 6.6h.01" />
    </svg>
  );
}

/**
 * O ⓘ que carrega a explicação do bloco. A lei de texto da Fase 5 tirou a
 * prosa de dentro do cartão: o que explicava o bloco em duas linhas agora
 * vive aqui, atrás de hover **e** de foco de teclado (`ui/Dica`).
 */
export function BotaoDica({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <Dica texto={texto}>
      <button
        type="button"
        aria-label={`O que é ${rotulo}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-controle text-tinta-fraca transition-colors duration-[var(--transicao-rapida)] hover:bg-papel hover:text-tinta"
      >
        <IconeInfo />
      </button>
    </Dica>
  );
}

interface Props<T> {
  id: string;
  /** Rótulo pequeno em caixa alta acima do título (a "seção"). ≤ 3 palavras. */
  rotulo?: string;
  /** Título do bloco. ≤ 3 palavras — o dado é que fala, não a explicação. */
  titulo: string;
  /** `title` nativo do título: a sigla do método, para quem procura o termo antigo. */
  tituloTitle?: string;
  /** Explicação do bloco. Vai para a `Dica` do ⓘ — NUNCA para dentro do fluxo. */
  dica?: string;
  /** Uma linha quando o array validou vazio — é a boa notícia, não um vazio genérico. */
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
 *
 * Fase 5 — lei de texto: título + estado + uma ação. A `legenda` de prosa
 * saiu; o que ela dizia virou `dica`, atrás do ⓘ.
 */
export function Bloco<T>({ id, rotulo, titulo, tituloTitle, dica, mensagemNadaPendente, estado, urgente, aoTentarDeNovo, children }: Props<T>) {
  const contagem = estado.situacao === "ok" ? estado.itens.length : null;
  const urgenteAtivo = Boolean(urgente && contagem !== null && contagem > 0);

  // Fase 6 — bloco SEM NADA PENDENTE vira UMA LINHA, não um cartão.
  //
  // O João: "tá tudo muito grande, tenho que escrolar muito pra ver todo o
  // conteúdo". Num dia calmo, os quatro blocos do painel estavam todos vazios
  // e cada um ocupava ~150 px (rótulo + título + divisor + uma frase) para
  // dizer "nada aqui". Meia tela para dizer que não há trabalho.
  //
  // A boa notícia continua verde, com check e o mesmo texto — só deixa de
  // ocupar o espaço de um bloco que tem trabalho. Hierarquia visual É a
  // informação: o que exige ação fica maior que o que não exige.
  if (estado.situacao === "ok" && estado.itens.length === 0) {
    return (
      <section id={id} aria-labelledby={`${id}-titulo`} className="flex min-h-11 flex-wrap items-center gap-x-item gap-y-0.5 rounded-cartao border border-linha bg-papel-elevado px-3 py-1.5">
        <IconeTudoCerto />
        <h3 id={`${id}-titulo`} title={tituloTitle} className="text-sm font-bold text-tinta">
          {titulo}
        </h3>
        <p className="text-sm text-[color:var(--verde)]">{mensagemNadaPendente}</p>
        {dica && <span className="ml-auto">{<BotaoDica texto={dica} rotulo={titulo} />}</span>}
      </section>
    );
  }

  return (
    <Cartao
      id={id}
      aria-labelledby={`${id}-titulo`}
      preenchimento="sem"
      realce={urgenteAtivo ? "vermelho" : undefined}
      rotulo={rotulo}
      titulo={
        <span id={`${id}-titulo`} title={tituloTitle}>
          {titulo}
        </span>
      }
      acao={
        <>
          {contagem !== null && contagem > 0 && (
            <span
              aria-label={`${contagem} ${contagem === 1 ? "item" : "itens"}`}
              className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-full px-3 text-sm font-bold tabular-nums ${
                urgenteAtivo ? "bg-vermelho-fraco text-[color:var(--vermelho)]" : "bg-latao-fraco text-tinta"
              }`}
            >
              {contagem}
            </span>
          )}
          {dica && <BotaoDica texto={dica} rotulo={titulo} />}
        </>
      }
    >
      {estado.situacao === "indisponivel" && (
        <div role="alert" className="flex flex-wrap items-center gap-item px-cartao py-item text-sm text-tinta-suave">
          <IconeIndisponivel />
          <span>Não carregou.</span>
          <Botao variante="secundario" tamanho="compacto" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}

      {estado.situacao === "ok" && estado.itens.length > 0 && children(estado.itens)}
    </Cartao>
  );
}

/** Linha padrão de uma fila do painel: ≥ 44px, divisor, hover suave, empilha no celular. */
export function LinhaFila({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <li className={`flex min-h-11 flex-col gap-item px-cartao py-item transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-cartao sm:gap-y-1 ${className}`}>
      {children}
    </li>
  );
}
