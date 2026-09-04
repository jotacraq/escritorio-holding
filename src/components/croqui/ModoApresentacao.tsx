"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registrarApresentacaoCroqui } from "@/lib/api";
import type { Croqui, CroquiSlide } from "@/lib/api";
import { GraficoDoSlide, slideTemGrafico, type DadosGraficosCroqui } from "./GraficoDoSlide";

/**
 * U6 (ARQUITETURA-FASE-3.md §3/§5.3) — a tela que a família vê no momento
 * da decisão. Regras que não se negociam aqui (CLAUDE.md + §3.6/C19):
 * nenhum custo, grau de confiança, hipótese da IA, ou dado de outro cliente
 * pode vazar; nenhum gráfico sem dado aparece (nem o estado explicativo —
 * `GraficoIndisponivel` já retorna `null` com `modoApresentacao`); e um
 * croqui em rascunho com slide não revisado NÃO abre aqui — é a advogada
 * quem assina, não a IA.
 */
export function ModoApresentacao({
  croqui,
  jornadaId,
  dadosGraficos,
}: {
  croqui: Croqui;
  jornadaId: string;
  dadosGraficos: DadosGraficosCroqui;
}) {
  const router = useRouter();
  const [indice, setIndice] = useState(0);
  const [mostrarNota, setMostrarNota] = useState(false);
  const slides = croqui.conteudo.slides;
  const slide = slides[indice];

  const naoRevisados = slides.filter((s) => !s.revisado).length;
  // C19: croqui `pronto`/`apresentado` já garante os 13 revisados (trigger
  // 0043) — só um `rascunho` pode ter slide não revisado, e é exatamente
  // esse o caso que não pode ir para a frente do cliente.
  const bloqueadoPorRevisao = croqui.status === "rascunho" && naoRevisados > 0;

  const encerrar = useCallback(() => {
    if (!bloqueadoPorRevisao) {
      registrarApresentacaoCroqui(croqui.id, { acao: "encerrar", slides_vistos: indice + 1 }).catch(() => {
        /* encerramento é best-effort — não trava a navegação de volta */
      });
    }
    router.back();
  }, [croqui.id, indice, router, bloqueadoPorRevisao]);

  useEffect(() => {
    if (bloqueadoPorRevisao) return;
    registrarApresentacaoCroqui(croqui.id, { acao: "iniciar" }).catch(() => {});
  }, [croqui.id, bloqueadoPorRevisao]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        encerrar();
        return;
      }
      if (bloqueadoPorRevisao) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndice((i) => Math.min(i + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIndice((i) => Math.max(i - 1, 0));
      } else if (e.key.toLowerCase() === "n") {
        setMostrarNota((v) => !v);
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [slides.length, encerrar, bloqueadoPorRevisao]);

  if (bloqueadoPorRevisao) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] p-8 text-[#ece9df]">
        <div className="flex max-w-lg flex-col items-start gap-3 rounded-sm border border-[#3c3e44] bg-[#16171a] p-6">
          <p className="font-serif text-xl font-semibold">Este croqui ainda não pode ser apresentado</p>
          <p className="text-sm text-[#c9c6bc]">
            {naoRevisados} de 13 slides ainda não foram revisados pela advogada. A apresentação ao cliente exige que todos os 13
            estejam marcados como revisados — é a advogada quem assina a prescrição técnica, não a IA.
          </p>
          <div className="mt-1 flex gap-2">
            <Link href={`/jornadas/${jornadaId}#croqui`}>
              <span className="rounded-sm border border-[#3c3e44] px-3 py-1.5 text-sm hover:border-[#7a7a72]">Revisar no editor</span>
            </Link>
            <button type="button" onClick={() => router.back()} className="rounded-sm border border-[#3c3e44] px-3 py-1.5 text-sm hover:border-[#7a7a72]">
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!slide) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] text-[#ece9df]">
        <p>Este croqui não tem slides.</p>
      </div>
    );
  }

  const temGrafico = slideTemGrafico(slide.tipo);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1012] text-[#ece9df] print:static print:h-auto print:bg-white print:text-black" role="dialog" aria-label={`Apresentação — ${slide.titulo}`}>
      <div className="nao-imprimir flex items-center justify-between px-8 py-4 text-xs uppercase tracking-widest text-[#7a7a72]">
        <span>{croqui.titulo}</span>
        <div className="flex items-center gap-3">
          <BarraProgresso total={slides.length} atual={indice} />
          <button type="button" onClick={encerrar} className="rounded-sm border border-[#3c3e44] px-2.5 py-1 hover:border-[#7a7a72] hover:text-[#ece9df]">
            Encerrar (Esc)
          </button>
        </div>
      </div>

      {/* Área do cliente + trilho de notas (Keynote presenter view, §5.2) —
          notas ficam atrás da tecla N de propósito: esta é uma tela ÚNICA,
          tipicamente espelhada num projetor. Um painel sempre visível ao
          lado vazaria nota interna (objetivo, como_apresentar) direto para
          quem está do outro lado da mesa — o que a arquitetura proíbe em
          outro trecho do mesmo parágrafo ("sem nada de interno vazando").
          Compromisso: acesso fácil (tecla única, indicada na barra) em vez
          de escondido sem pista nenhuma. */}
      <div className="nao-imprimir flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-10 py-6 text-center">
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-[#d3ac4c]">{String(indice + 1).padStart(2, "0")} · {slide.titulo}</p>
          <h1 className="max-w-4xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">{slide.titulo}</h1>
          <p className="max-w-3xl whitespace-pre-wrap text-xl leading-relaxed text-[#c9c6bc] sm:text-2xl">{slide.conteudo || "Sem conteúdo definido para este slide."}</p>
          {slide.pontos && slide.pontos.length > 0 && (
            <ul className="flex max-w-2xl flex-col gap-1.5 text-left text-lg text-[#c9c6bc]">
              {slide.pontos.slice(0, 4).map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-[#d3ac4c]">·</span>
                  {p}
                </li>
              ))}
            </ul>
          )}
          {temGrafico && (
            <div className="w-full max-w-3xl">
              <GraficoDoSlide tipo={slide.tipo} dados={dadosGraficos} tema="escuro" modoApresentacao />
            </div>
          )}
        </div>

        {mostrarNota && (
          <aside aria-label="Notas do apresentador" className="w-80 shrink-0 overflow-y-auto border-l border-[#3c3e44] bg-[#16171a] p-4 text-sm text-[#c9c6bc]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#7a7a72]">Notas do apresentador</p>
            {slide.objetivo && <p className="mb-2"><strong className="text-[#ece9df]">Objetivo:</strong> {slide.objetivo}</p>}
            {slide.pergunta_ao_cliente && <p className="mb-2"><strong className="text-[#ece9df]">Pergunta ao cliente:</strong> {slide.pergunta_ao_cliente}</p>}
            {slide.como_apresentar && <p><strong className="text-[#ece9df]">Como apresentar:</strong> {slide.como_apresentar}</p>}
            {!slide.objetivo && !slide.pergunta_ao_cliente && !slide.como_apresentar && <p className="text-[#7a7a72]">Nenhuma nota para este slide.</p>}
          </aside>
        )}
      </div>

      <div className="nao-imprimir flex items-center justify-between px-8 py-5">
        <button
          type="button"
          onClick={() => setIndice((i) => Math.max(i - 1, 0))}
          disabled={indice === 0}
          className="rounded-sm border border-[#3c3e44] px-3 py-1.5 text-sm disabled:opacity-30"
        >
          ← Anterior
        </button>
        <div className="flex items-center gap-3 font-mono text-sm text-[#7a7a72]">
          <span>{indice + 1} / {slides.length}</span>
          <button
            type="button"
            onClick={() => setMostrarNota((v) => !v)}
            aria-pressed={mostrarNota}
            className={`rounded-sm border px-2 py-1 text-xs ${mostrarNota ? "border-[#d3ac4c] text-[#d3ac4c]" : "border-[#3c3e44]"}`}
          >
            Notas do apresentador (N)
          </button>
        </div>
        <button
          type="button"
          onClick={() => setIndice((i) => Math.min(i + 1, slides.length - 1))}
          disabled={indice === slides.length - 1}
          className="rounded-sm border border-[#3c3e44] px-3 py-1.5 text-sm disabled:opacity-30"
        >
          Próximo →
        </button>
      </div>

      <DeckImpressao slides={slides} dadosGraficos={dadosGraficos} />
    </div>
  );
}

function BarraProgresso({ total, atual }: { total: number; atual: number }) {
  return (
    <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={atual + 1} aria-label="Progresso da apresentação" className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-1 w-4 rounded-full ${i <= atual ? "bg-[#d3ac4c]" : "bg-[#3c3e44]"}`}
        />
      ))}
    </div>
  );
}

/**
 * Impressão: um slide por página (§5.3, U6), sempre em papel/tinta claro —
 * cor hexadecimal explícita, nunca `var(--tinta)`: se a advogada estiver com
 * o tema escuro ligado no navegador ao imprimir, `.dark` continua presente
 * no `<html>` durante o preview de impressão do Chromium, e uma variável CSS
 * resolveria escuro sobre escuro. Mesma razão de `src/components/graficos/
 * paleta.ts` não usar variável.
 */
function DeckImpressao({ slides, dadosGraficos }: { slides: CroquiSlide[]; dadosGraficos: DadosGraficosCroqui }) {
  return (
    <div className="hidden print:block" style={{ background: "#fffdf8", color: "#1b1c1f" }}>
      {slides.map((slide, i) => (
        <section key={slide.id} className="imprimir-quebra flex min-h-[90vh] flex-col gap-4 px-10 py-10">
          <p className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: "#7c5e26" }}>
            {String(i + 1).padStart(2, "0")} · Croqui Estrutural
          </p>
          <h1 className="font-serif text-3xl font-semibold">{slide.titulo}</h1>
          <p className="max-w-2xl whitespace-pre-wrap text-base leading-relaxed" style={{ color: "#52514c" }}>
            {slide.conteudo || "Sem conteúdo definido para este slide."}
          </p>
          {slide.pontos && slide.pontos.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm" style={{ color: "#52514c" }}>
              {slide.pontos.map((p, j) => <li key={j}>· {p}</li>)}
            </ul>
          )}
          {slideTemGrafico(slide.tipo) && (
            <div className="max-w-2xl">
              <GraficoDoSlide tipo={slide.tipo} dados={dadosGraficos} tema="claro" />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
