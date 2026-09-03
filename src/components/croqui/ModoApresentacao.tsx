"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { registrarApresentacaoCroqui } from "@/lib/api";
import type { Croqui } from "@/lib/api";

export function ModoApresentacao({ croqui }: { croqui: Croqui }) {
  const router = useRouter();
  const [indice, setIndice] = useState(0);
  const [mostrarNota, setMostrarNota] = useState(false);
  const slides = croqui.conteudo.slides;
  const slide = slides[indice];

  const encerrar = useCallback(() => {
    registrarApresentacaoCroqui(croqui.id, { acao: "encerrar", slides_vistos: indice + 1 }).catch(() => {
      /* encerramento é best-effort — não trava a navegação de volta */
    });
    router.back();
  }, [croqui.id, indice, router]);

  useEffect(() => {
    registrarApresentacaoCroqui(croqui.id, { acao: "iniciar" }).catch(() => {});
  }, [croqui.id]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndice((i) => Math.min(i + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIndice((i) => Math.max(i - 1, 0));
      } else if (e.key === "Escape") {
        encerrar();
      } else if (e.key.toLowerCase() === "n") {
        setMostrarNota((v) => !v);
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [slides.length, encerrar]);

  if (!slide) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] text-[#ece9df]">
        <p>Este croqui não tem slides.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1012] text-[#ece9df]" role="dialog" aria-label={`Apresentação — ${slide.titulo}`}>
      <div className="nao-imprimir flex items-center justify-between px-8 py-4 text-xs uppercase tracking-widest text-[#7a7a72]">
        <span>{croqui.titulo}</span>
        <button type="button" onClick={encerrar} className="rounded-sm border border-[#3c3e44] px-2.5 py-1 hover:border-[#7a7a72] hover:text-[#ece9df]">
          Encerrar (Esc)
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-10 text-center">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-[#d3ac4c]">{String(indice + 1).padStart(2, "0")} · {slide.titulo}</p>
        <h1 className="max-w-4xl font-serif text-4xl font-semibold leading-tight sm:text-6xl">{slide.titulo}</h1>
        <p className="max-w-3xl whitespace-pre-wrap text-xl leading-relaxed text-[#c9c6bc] sm:text-2xl">{slide.conteudo || "Sem conteúdo definido para este slide."}</p>
      </div>

      {mostrarNota && (slide.objetivo || slide.pergunta_ao_cliente) && (
        <div className="nao-imprimir mx-auto mb-4 w-full max-w-2xl rounded-sm border border-[#3c3e44] bg-[#16171a] p-4 text-sm text-[#c9c6bc]">
          {slide.objetivo && <p><strong className="text-[#ece9df]">Objetivo:</strong> {slide.objetivo}</p>}
          {slide.pergunta_ao_cliente && <p className="mt-1"><strong className="text-[#ece9df]">Pergunta ao cliente:</strong> {slide.pergunta_ao_cliente}</p>}
        </div>
      )}

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
          <button type="button" onClick={() => setMostrarNota((v) => !v)} className="rounded-sm border border-[#3c3e44] px-2 py-1 text-xs">
            Nota do apresentador (N)
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
    </div>
  );
}
