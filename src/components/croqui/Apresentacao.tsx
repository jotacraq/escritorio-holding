"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type TouchEvent } from "react";
import type { SlideApresentacao } from "@/types/publico-ui";

export type { SlideApresentacao };

/**
 * Modo apresentação GENÉRICO — a tela escura projetada para a família, usada
 * pelo Croqui (13 slides, adaptador em `ModoApresentacao.tsx`) e pelo
 * Diagnóstico da SV (agente H, `jornadas/[id]/diagnostico/**`). Recebe
 * `slides` já montados: quem monta decide o que a família vê no `corpo` e o
 * que fica só para o apresentador em `notas`.
 *
 * Cores FIXAS em hexadecimal, de propósito (mesma regra de
 * `src/components/graficos/paleta.ts`): esta tela é sempre escura, espelhada
 * num projetor ou numa chamada de vídeo, independente do tema do navegador —
 * `.dark` no `<html>` não pode decidir nada aqui. `#16171a` é o
 * `--papel-elevado` do tema escuro; `#ff7400` é o laranja de marca
 * (6,62:1 sobre o fundo); `#9a9588` é a `--tinta-fraca` escura (5,5:1).
 *
 * Teclado: ← → Espaço PageUp/PageDown Home End · N notas · F tela cheia ·
 * Esc encerra (em tela cheia, o Esc do navegador sai da tela cheia primeiro —
 * o segundo Esc encerra). Toque: deslizar para os lados troca de slide.
 */
export const CORES_APRESENTACAO = {
  fundo: "#16171a",
  painel: "#1d1f23",
  tinta: "#ece9df",
  tintaSuave: "#c9c6bc",
  tintaFraca: "#9a9588",
  linha: "#3c3e44",
  marca: "#ff7400",
} as const;

export interface ApresentacaoProps {
  /** Nome da peça, na barra superior (ex.: "Croqui Estrutural · Família Silva"). */
  titulo: string;
  slides: SlideApresentacao[];
  /** Encerrar (botão e Esc). Quem chama decide para onde voltar. */
  aoSair: () => void;
  /** Disparado a cada troca de slide — para registrar "slides vistos". */
  aoMudarSlide?: (indice: number) => void;
  indiceInicial?: number;
  /** Aviso discreto só para quem opera (ex.: "2 slides sem revisão"). Nunca impresso. */
  aviso?: ReactNode;
  /** Marcação só de impressão (ex.: `DeckImpressao`) — fica escondida na tela. */
  impressao?: ReactNode;
  rotuloSair?: string;
}

const CLASSE_BOTAO_BARRA =
  "inline-flex min-h-11 items-center gap-1.5 rounded-controle border px-3 text-sm font-medium transition-[border-color,color,background-color] duration-[var(--transicao-rapida)] disabled:cursor-not-allowed disabled:opacity-40";

function BotaoBarra({ ativo, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { ativo?: boolean }) {
  return (
    <button
      type="button"
      className={CLASSE_BOTAO_BARRA}
      style={{
        borderColor: ativo ? CORES_APRESENTACAO.marca : CORES_APRESENTACAO.linha,
        color: ativo ? CORES_APRESENTACAO.marca : CORES_APRESENTACAO.tintaSuave,
        background: ativo ? "rgba(255,116,0,0.08)" : "transparent",
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function Apresentacao({ titulo, slides, aoSair, aoMudarSlide, indiceInicial = 0, aviso, impressao, rotuloSair = "Encerrar" }: ApresentacaoProps) {
  const total = slides.length;
  const [indice, setIndice] = useState(() => Math.max(0, Math.min(indiceInicial, Math.max(0, total - 1))));
  const [mostrarNotas, setMostrarNotas] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const [suportaTelaCheia, setSuportaTelaCheia] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const toqueInicial = useRef<number | null>(null);

  const slide = slides[indice];

  const irPara = useCallback(
    (novo: number) => {
      setIndice((atual) => {
        const proximo = Math.max(0, Math.min(total - 1, novo));
        return proximo === atual ? atual : proximo;
      });
    },
    [total],
  );
  const proximo = useCallback(() => irPara(indice + 1), [irPara, indice]);
  const anterior = useCallback(() => irPara(indice - 1), [irPara, indice]);

  useEffect(() => {
    aoMudarSlide?.(indice);
  }, [indice, aoMudarSlide]);

  // Foco na raiz ao abrir: teclado funciona na hora e o leitor de tela anuncia o diálogo.
  useEffect(() => {
    raiz.current?.focus();
    // Leitura de capacidade do navegador (Fullscreen API) — não é dado de servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuportaTelaCheia(typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function");
    function aoMudarTelaCheia() {
      setTelaCheia(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", aoMudarTelaCheia);
    return () => document.removeEventListener("fullscreenchange", aoMudarTelaCheia);
  }, []);

  const alternarTelaCheia = useCallback(() => {
    if (!raiz.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void raiz.current.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
      switch (e.key) {
        case "Escape":
          // Em tela cheia o navegador já consome o Esc para sair dela; encerrar
          // junto derrubaria a apresentação por um toque só.
          if (document.fullscreenElement) return;
          e.preventDefault();
          aoSair();
          return;
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          proximo();
          return;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          anterior();
          return;
        case "Home":
          e.preventDefault();
          irPara(0);
          return;
        case "End":
          e.preventDefault();
          irPara(total - 1);
          return;
      }
      const tecla = e.key.toLowerCase();
      if (tecla === "n") {
        e.preventDefault();
        setMostrarNotas((v) => !v);
      } else if (tecla === "f") {
        e.preventDefault();
        alternarTelaCheia();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoSair, proximo, anterior, irPara, total, alternarTelaCheia]);

  const aoToqueInicio = (e: TouchEvent) => {
    toqueInicial.current = e.touches[0]?.clientX ?? null;
  };
  const aoToqueFim = (e: TouchEvent) => {
    const inicio = toqueInicial.current;
    toqueInicial.current = null;
    if (inicio == null) return;
    const delta = (e.changedTouches[0]?.clientX ?? inicio) - inicio;
    if (Math.abs(delta) < 56) return;
    if (delta < 0) proximo();
    else anterior();
  };

  const estiloRaiz = { background: CORES_APRESENTACAO.fundo, color: CORES_APRESENTACAO.tinta };

  if (!slide) {
    return (
      <div ref={raiz} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-8 text-center outline-none" style={estiloRaiz}>
        <p className="text-subtitulo">Nada para apresentar ainda.</p>
        <BotaoBarra onClick={aoSair}>{rotuloSair} (Esc)</BotaoBarra>
      </div>
    );
  }

  const progresso = ((indice + 1) / total) * 100;
  const rotuloSlide = slide.rotulo ?? `${String(indice + 1).padStart(2, "0")} de ${String(total).padStart(2, "0")}`;

  return (
    <div
      ref={raiz}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`${titulo} — apresentação`}
      className="fixed inset-0 z-50 flex flex-col outline-none print:static print:h-auto print:bg-white print:text-black"
      style={estiloRaiz}
    >
      {/* Barra superior — só operador. */}
      <header className="nao-imprimir flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6" style={{ borderBottom: `1px solid ${CORES_APRESENTACAO.linha}` }}>
        <div className="flex min-w-0 items-center gap-3">
          <p className="truncate text-rotulo font-medium uppercase" style={{ color: CORES_APRESENTACAO.tintaFraca }}>
            {titulo}
          </p>
          {aviso}
        </div>

        <div className="flex items-center gap-2">
          <p aria-live="polite" className="text-sm tabular-nums" style={{ color: CORES_APRESENTACAO.tintaSuave }}>
            <span className="sr-only">Slide </span>
            {indice + 1} de {total}
          </p>
          <BotaoBarra onClick={() => setMostrarNotas((v) => !v)} aria-pressed={mostrarNotas} ativo={mostrarNotas} aria-controls="notas-apresentador">
            <span aria-hidden="true">✎</span> Notas <kbd className="text-legenda">N</kbd>
          </BotaoBarra>
          {suportaTelaCheia && (
            <BotaoBarra onClick={alternarTelaCheia} aria-pressed={telaCheia} ativo={telaCheia}>
              <span aria-hidden="true">{telaCheia ? "⤡" : "⤢"}</span> Tela cheia <kbd className="text-legenda">F</kbd>
            </BotaoBarra>
          )}
          <BotaoBarra onClick={aoSair}>
            {rotuloSair} <kbd className="text-legenda">Esc</kbd>
          </BotaoBarra>
        </div>
      </header>

      {/* Barra de progresso — fina, laranja, com semântica. */}
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={indice + 1}
        aria-label={`Progresso da apresentação: slide ${indice + 1} de ${total}`}
        className="nao-imprimir h-1 w-full"
        style={{ background: CORES_APRESENTACAO.linha }}
      >
        <div
          className="h-full transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)]"
          style={{ width: `${progresso}%`, background: CORES_APRESENTACAO.marca }}
        />
      </div>

      <div className="nao-imprimir relative flex min-h-0 flex-1">
        <section
          key={slide.id}
          aria-label={`Slide ${indice + 1}: ${slide.titulo}`}
          className="anim-surgir flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 sm:px-10 lg:px-16"
          onTouchStart={aoToqueInicio}
          onTouchEnd={aoToqueFim}
        >
          <div className="my-auto flex w-full max-w-6xl flex-col items-center gap-5 text-center">
            <p className="text-rotulo font-medium uppercase tracking-[0.2em]" style={{ color: CORES_APRESENTACAO.marca }}>
              {rotuloSlide}
            </p>
            <h1 className="max-w-4xl text-[clamp(1.75rem,4.2vw,3.5rem)] font-bold leading-[1.1] tracking-[-0.02em]" style={{ color: CORES_APRESENTACAO.tinta }}>
              {slide.titulo}
            </h1>
            <div className="w-full" style={{ color: CORES_APRESENTACAO.tintaSuave }}>
              {slide.corpo}
            </div>
          </div>
        </section>

        {mostrarNotas && (
          <aside
            id="notas-apresentador"
            aria-label="Notas do apresentador"
            className="anim-deslizar-direita absolute inset-x-0 bottom-0 z-10 flex max-h-[45vh] flex-col gap-3 overflow-y-auto p-4 lg:static lg:max-h-none lg:w-96 lg:shrink-0 lg:border-l"
            style={{ background: CORES_APRESENTACAO.painel, borderColor: CORES_APRESENTACAO.linha, color: CORES_APRESENTACAO.tintaSuave, borderTop: `1px solid ${CORES_APRESENTACAO.linha}` }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-rotulo font-medium uppercase" style={{ color: CORES_APRESENTACAO.tintaFraca }}>
                Notas do apresentador
              </p>
              <BotaoBarra onClick={() => setMostrarNotas(false)} aria-label="Fechar notas">
                Fechar
              </BotaoBarra>
            </div>
            {slide.notas ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed sm:text-corpo">{slide.notas}</p>
            ) : (
              <p className="text-sm" style={{ color: CORES_APRESENTACAO.tintaFraca }}>
                Nenhuma nota para este slide.
              </p>
            )}
          </aside>
        )}
      </div>

      {/* Barra inferior — navegação tocável. */}
      <footer className="nao-imprimir flex items-center justify-between gap-3 px-4 py-3 sm:px-6" style={{ borderTop: `1px solid ${CORES_APRESENTACAO.linha}` }}>
        <BotaoBarra onClick={anterior} disabled={indice === 0} aria-label="Slide anterior">
          <span aria-hidden="true">←</span> Anterior
        </BotaoBarra>
        <p className="hidden text-legenda sm:block" style={{ color: CORES_APRESENTACAO.tintaFraca }}>
          ← → ou Espaço para navegar · N notas · F tela cheia · Esc encerra
        </p>
        <BotaoBarra onClick={proximo} disabled={indice === total - 1} aria-label="Próximo slide">
          Próximo <span aria-hidden="true">→</span>
        </BotaoBarra>
      </footer>

      {impressao}
    </div>
  );
}
