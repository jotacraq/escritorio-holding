"use client";

import { useState } from "react";
import Link from "next/link";
import { atualizarCroqui, ApiError, type Croqui, type StatusCroqui } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";

const ROTULOS_STATUS: Record<StatusCroqui, { rotulo: string; tom: "verde" | "azul" | "neutro" }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  pronto: { rotulo: "Pronto", tom: "azul" },
  apresentado: { rotulo: "Apresentado", tom: "verde" },
};

export function EditorCroqui({ jornadaId, croqui, aoAtualizar }: { jornadaId: string; croqui: Croqui; aoAtualizar: () => void }) {
  const [slides, setSlides] = useState(croqui.conteudo.slides);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [titulo, setTitulo] = useState(croqui.titulo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const slideAtivo = slides[indiceAtivo];

  function atualizarSlide(campo: "titulo" | "conteudo" | "objetivo" | "pergunta_ao_cliente", valor: string) {
    setSlides((atual) => atual.map((s, i) => (i === indiceAtivo ? { ...s, [campo]: valor } : s)));
    setSalvo(false);
  }

  async function salvar(novoStatus?: StatusCroqui) {
    setSalvando(true);
    setErro(null);
    try {
      await atualizarCroqui(croqui.id, { titulo, conteudo: { slides }, status: novoStatus ?? croqui.status });
      setSalvo(true);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o croqui.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            value={titulo}
            onChange={(e) => { setTitulo(e.target.value); setSalvo(false); }}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-serif text-lg font-semibold"
          />
          <Selo tom={ROTULOS_STATUS[croqui.status].tom}>{ROTULOS_STATUS[croqui.status].rotulo}</Selo>
        </div>
        <div className="flex gap-2">
          <Botao variante="secundario" carregando={salvando} onClick={() => salvar()}>Salvar rascunho</Botao>
          <Botao variante="primario" carregando={salvando} onClick={() => salvar("pronto")}>Marcar como pronto</Botao>
          <Link href={`/jornadas/${jornadaId}/croqui/${croqui.id}/apresentar`}>
            <Botao variante="secundario">Abrir apresentação</Botao>
          </Link>
        </div>
      </div>

      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      {salvo && !erro && <p role="status" className="text-sm text-[color:var(--verde)]">Salvo.</p>}

      <div className="flex gap-4">
        <ol className="flex w-48 shrink-0 flex-col gap-0.5">
          {slides.map((slide, i) => (
            <li key={slide.id}>
              <button
                type="button"
                onClick={() => setIndiceAtivo(i)}
                aria-current={i === indiceAtivo}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${i === indiceAtivo ? "bg-[color:var(--latao-fraco)] font-medium text-tinta" : "text-tinta-suave hover:bg-papel-fundo"}`}
              >
                <span className="font-mono text-xs text-tinta-fraca">{String(i + 1).padStart(2, "0")}</span>
                {slide.titulo}
              </button>
            </li>
          ))}
        </ol>

        {slideAtivo && (
          <div className="flex flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Título do slide
              <input value={slideAtivo.titulo} onChange={(e) => atualizarSlide("titulo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Conteúdo (o que aparece na tela para o cliente)
              <textarea rows={8} value={slideAtivo.conteudo} onChange={(e) => atualizarSlide("conteudo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-sans" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Objetivo (nota do apresentador)
              <input value={slideAtivo.objetivo ?? ""} onChange={(e) => atualizarSlide("objetivo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Pergunta ao cliente (nota do apresentador)
              <input value={slideAtivo.pergunta_ao_cliente ?? ""} onChange={(e) => atualizarSlide("pergunta_ao_cliente", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
