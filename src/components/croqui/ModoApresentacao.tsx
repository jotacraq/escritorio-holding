"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { registrarApresentacaoCroqui } from "@/lib/api";
import type { Croqui, CroquiSlide } from "@/lib/api";
import { contarRevisaoSlides } from "@/lib/croqui";
import type { SlideApresentacao } from "@/types/publico-ui";
import { Apresentacao, CORES_APRESENTACAO } from "./Apresentacao";
import { GraficoDoSlide, slideTemGrafico, type DadosGraficosCroqui } from "./GraficoDoSlide";
import { DeckImpressao } from "./DeckImpressao";

/**
 * U6 (ARQUITETURA-FASE-3.md §3/§5.3) — ADAPTADOR do Croqui para o modo
 * apresentação genérico (`Apresentacao.tsx`): monta os 13 slides do método
 * (`SlideApresentacao[]`) e delega teclado, progresso, notas, tela cheia e
 * impressão. Regras que não se negociam (CLAUDE.md + §3.6/C19): nenhum
 * custo, grau de confiança, hipótese da IA ou dado de outro cliente vaza;
 * gráfico sem dado não aparece (`GraficoIndisponivel` devolve `null` em
 * `modoApresentacao`); notas (objetivo, pergunta ao cliente, como
 * apresentar) ficam atrás da tecla N.
 *
 * A revisão dos 13 slides não bloqueia: quando há pendência, um aviso
 * discreto na barra (só operador) diz quantos faltam.
 */
export function ModoApresentacao({
  croqui,
  dadosGraficos,
}: {
  croqui: Croqui;
  dadosGraficos: DadosGraficosCroqui;
}) {
  const router = useRouter();
  const slides = croqui.conteudo.slides;
  const { pendentes } = contarRevisaoSlides(slides);
  const maiorVisto = useRef(0);

  // Cenário (grade do agente D) e alocação v2 (células) chegam prontos em
  // `dadosGraficos` — `GET /api/croquis/[id]` já devolve os dois (Onda 3, K)
  // e a página os repassa; `undefined` vira `null` aqui, sem fetch extra.
  const dados = useMemo<DadosGraficosCroqui>(
    () => ({ ...dadosGraficos, cenario: dadosGraficos.cenario ?? null, alocacao: dadosGraficos.alocacao ?? null }),
    [dadosGraficos],
  );

  useEffect(() => {
    registrarApresentacaoCroqui(croqui.id, { acao: "iniciar" }).catch(() => {});
  }, [croqui.id]);

  const encerrar = useCallback(() => {
    registrarApresentacaoCroqui(croqui.id, { acao: "encerrar", slides_vistos: maiorVisto.current + 1 }).catch(() => {
      /* encerramento é best-effort — não trava a navegação de volta */
    });
    router.back();
  }, [croqui.id, router]);

  const aoMudarSlide = useCallback((indice: number) => {
    maiorVisto.current = Math.max(maiorVisto.current, indice);
  }, []);

  const slidesApresentacao = useMemo<SlideApresentacao[]>(
    () =>
      slides.map((slide, i) => ({
        id: slide.id,
        titulo: slide.titulo,
        rotulo: `${String(i + 1).padStart(2, "0")} · Croqui Estrutural`,
        corpo: <CorpoSlideCroqui slide={slide} dados={dados} />,
        notas: montarNotas(slide),
      })),
    [slides, dados],
  );

  return (
    <Apresentacao
      titulo={croqui.titulo}
      slides={slidesApresentacao}
      aoSair={encerrar}
      aoMudarSlide={aoMudarSlide}
      aviso={
        pendentes > 0 ? (
          <span className="rounded-controle border px-2 py-0.5 text-legenda font-medium" style={{ borderColor: "#e4b23c", color: "#e4b23c" }}>
            {pendentes} slide{pendentes > 1 ? "s" : ""} sem revisão
          </span>
        ) : undefined
      }
      impressao={<DeckImpressao slides={slides} dadosGraficos={dados} />}
    />
  );
}

/** Texto + pontos à esquerda e gráfico à direita em telas largas — cabe em 1280×720 sem rolagem. */
function CorpoSlideCroqui({ slide, dados }: { slide: CroquiSlide; dados: DadosGraficosCroqui }) {
  const temGrafico = slideTemGrafico(slide.tipo);
  const pontos = (slide.pontos ?? []).slice(0, 4);
  const texto = (
    <div className="flex flex-col items-center gap-5 lg:items-start lg:text-left">
      <p className="max-w-3xl whitespace-pre-wrap text-[clamp(1.125rem,1.9vw,1.625rem)] leading-relaxed">{slide.conteudo || "Sem conteúdo definido para este slide."}</p>
      {pontos.length > 0 && (
        <ul className="flex max-w-2xl flex-col gap-2 text-left text-[clamp(1rem,1.5vw,1.25rem)]">
          {pontos.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden="true" className="mt-[0.6em] h-2 w-2 shrink-0 rounded-full" style={{ background: CORES_APRESENTACAO.marca }} />
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  if (!temGrafico) return texto;
  return (
    <div className="grid w-full grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
      {texto}
      <div className="mx-auto w-full max-w-2xl lg:max-w-none">
        <GraficoDoSlide tipo={slide.tipo} dados={dados} tema="escuro" modoApresentacao />
      </div>
    </div>
  );
}

function montarNotas(slide: CroquiSlide): string | undefined {
  const partes: string[] = [];
  if (slide.objetivo) partes.push(`Objetivo: ${slide.objetivo}`);
  if (slide.pergunta_ao_cliente) partes.push(`Pergunta ao cliente: ${slide.pergunta_ao_cliente}`);
  if (slide.como_apresentar) partes.push(`Como apresentar: ${slide.como_apresentar}`);
  return partes.length > 0 ? partes.join("\n\n") : undefined;
}
