"use client";

import { useState } from "react";
import Link from "next/link";
import { atualizarCroqui, ApiError, type Croqui, type StatusCroqui } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { Chip, type TomChip } from "@/components/briefing/atomos";
import { ROTULO_CATEGORIA_AFIRMACAO, type TemaGrafico } from "@/components/graficos";
import { rotularOrigemSlide } from "./rotulos";
import { GraficoDoSlide, slideTemGrafico, type DadosGraficosCroqui } from "./GraficoDoSlide";

const ROTULOS_STATUS: Record<StatusCroqui, { rotulo: string; tom: "verde" | "azul" | "neutro" }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  pronto: { rotulo: "Pronto", tom: "azul" },
  apresentado: { rotulo: "Apresentado", tom: "verde" },
};

const TOM_ORIGEM: Record<string, TomChip> = { metodo: "neutro", ia: "ambar", humano: "azul" };
const TOM_CATEGORIA: Record<string, TomChip> = {
  fato_declarado: "neutro",
  dado_documental: "azul",
  inferencia: "ambar",
  ponto_a_validar: "vermelho",
};

/**
 * Editor dos 13 slides (ARQUITETURA-FASE-3.md §3.6, C19). Todo slide de
 * origem `ia` nasce `revisado: false` — a advogada lê, corrige se quiser e
 * assina marcando "revisado". A trava DURA de "pronto só com os 13
 * revisados" é o trigger no banco (0043); esta tela só explica e desabilita
 * o botão para não deixar a advogada descobrir a trava só pelo erro 23514.
 */
export function EditorCroqui({
  jornadaId,
  croqui,
  dadosGraficos,
  tema,
  aoAtualizar,
}: {
  jornadaId: string;
  croqui: Croqui;
  dadosGraficos: DadosGraficosCroqui;
  tema: TemaGrafico;
  aoAtualizar: () => void;
}) {
  const [slides, setSlides] = useState(croqui.conteudo.slides);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [titulo, setTitulo] = useState(croqui.titulo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const slideAtivo = slides[indiceAtivo];
  const naoRevisados = slides.filter((s) => !s.revisado).length;
  const podeFicarPronto = naoRevisados === 0;

  function atualizarSlide(campo: "titulo" | "conteudo" | "objetivo" | "pergunta_ao_cliente", valor: string) {
    setSlides((atual) =>
      atual.map((s, i) => {
        if (i !== indiceAtivo) return s;
        // Editar o texto que vai para o cliente exige revisão de novo — uma
        // aprovação antiga não cobre um texto que já mudou (C19: a advogada
        // assina o que está publicado, não o que existia antes da edição).
        const exigeNovaRevisao = campo === "conteudo" && s.revisado;
        return { ...s, [campo]: valor, ...(exigeNovaRevisao ? { revisado: false } : {}) };
      }),
    );
    setSalvo(false);
  }

  function alternarRevisado() {
    setSlides((atual) => atual.map((s, i) => (i === indiceAtivo ? { ...s, revisado: !s.revisado } : s)));
    setSalvo(false);
  }

  function marcarComoHumano() {
    setSlides((atual) => atual.map((s, i) => (i === indiceAtivo ? { ...s, origem: "humano" } : s)));
    setSalvo(false);
  }

  async function salvar(novoStatus?: StatusCroqui) {
    if ((novoStatus === "pronto" || novoStatus === "apresentado") && !podeFicarPronto) return;
    setSalvando(true);
    setErro(null);
    try {
      await atualizarCroqui(croqui.id, { titulo, conteudo: { slides }, status: novoStatus ?? croqui.status });
      setSalvo(true);
      aoAtualizar();
    } catch (e) {
      // A trava dura é o trigger do banco (0043) — a rota hoje devolve um
      // 500 genérico para essa violação (não traduz o código 23514 em erro
      // de negócio), então esta tela não finge saber a causa exata: mostra
      // a mensagem do servidor e lembra da regra mais provável.
      const base = e instanceof ApiError ? e.message : "Não foi possível salvar o croqui.";
      setErro(
        (novoStatus === "pronto" || novoStatus === "apresentado")
          ? `${base} Se o erro persistir: confira se os 13 slides estão marcados "Revisado" — o banco recusa "pronto" sem isso.`
          : base,
      );
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
            aria-label="Título do croqui"
          />
          <Selo tom={ROTULOS_STATUS[croqui.status].tom}>{ROTULOS_STATUS[croqui.status].rotulo}</Selo>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-tinta-fraca">{13 - naoRevisados} de 13 slides revisados</span>
          <Botao variante="secundario" carregando={salvando} onClick={() => salvar()}>Salvar rascunho</Botao>
          <Botao
            variante="primario"
            carregando={salvando}
            disabled={!podeFicarPronto}
            onClick={() => salvar("pronto")}
            title={!podeFicarPronto ? `Faltam ${naoRevisados} slide(s) revisar antes de marcar como pronto.` : undefined}
          >
            Marcar como pronto
          </Botao>
          <Link href={`/jornadas/${jornadaId}/croqui/${croqui.id}/apresentar`}>
            <Botao variante="secundario">Abrir apresentação</Botao>
          </Link>
        </div>
      </div>

      {!podeFicarPronto && (
        <p className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3 py-2 text-xs text-[color:var(--ambar)]">
          Faltam {naoRevisados} de 13 slides revisar. O croqui só pode virar &ldquo;pronto&rdquo; (e ser apresentado ao cliente) com todos
          revisados — trava do banco, não desta tela.
        </p>
      )}

      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      {salvo && !erro && <p role="status" className="text-sm text-[color:var(--verde)]">Salvo.</p>}

      <div className="flex gap-4">
        <ol className="flex w-52 shrink-0 flex-col gap-0.5">
          {slides.map((slide, i) => (
            <li key={slide.id}>
              <button
                type="button"
                onClick={() => setIndiceAtivo(i)}
                aria-current={i === indiceAtivo}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${i === indiceAtivo ? "bg-[color:var(--latao-fraco)] font-medium text-tinta" : "text-tinta-suave hover:bg-papel-fundo"}`}
              >
                <span className="font-mono text-xs text-tinta-fraca">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1">{slide.titulo}</span>
                <span
                  aria-hidden="true"
                  title={slide.revisado ? "Revisado" : "Não revisado"}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${slide.revisado ? "bg-[color:var(--verde)]" : "bg-[color:var(--ambar)]"}`}
                />
              </button>
            </li>
          ))}
        </ol>

        {slideAtivo && (
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tom={TOM_ORIGEM[slideAtivo.origem ?? "metodo"]}>{rotularOrigemSlide(slideAtivo.origem)}</Chip>
              {slideAtivo.categoria && (
                <Chip tom={TOM_CATEGORIA[slideAtivo.categoria]}>{ROTULO_CATEGORIA_AFIRMACAO[slideAtivo.categoria]}</Chip>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-tinta">
                <input type="checkbox" checked={slideAtivo.revisado ?? false} onChange={alternarRevisado} />
                Revisado pela advogada
              </label>
            </div>

            {slideAtivo.origem === "ia" && (
              <button type="button" onClick={marcarComoHumano} className="self-start text-xs text-tinta-fraca underline decoration-linha-forte hover:text-tinta">
                Esta versão é da advogada, não da IA — marcar como reescrita
              </button>
            )}

            <label className="flex flex-col gap-1 text-sm">
              Título do slide
              <input value={slideAtivo.titulo} onChange={(e) => atualizarSlide("titulo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Conteúdo (o que aparece na tela para o cliente)
              <textarea rows={6} value={slideAtivo.conteudo} onChange={(e) => atualizarSlide("conteudo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-sans" />
            </label>

            {slideAtivo.pontos && slideAtivo.pontos.length > 0 && (
              <div className="text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-tinta-fraca">Pontos (proposta da IA)</p>
                <ul className="list-disc pl-4 text-tinta-suave">
                  {slideAtivo.pontos.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {slideAtivo.fontes && slideAtivo.fontes.length > 0 && (
              <p className="text-xs text-tinta-fraca">Fontes: {slideAtivo.fontes.join(" · ")}</p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              Objetivo (nota do apresentador)
              <input value={slideAtivo.objetivo ?? ""} onChange={(e) => atualizarSlide("objetivo", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Pergunta ao cliente (nota do apresentador)
              <input value={slideAtivo.pergunta_ao_cliente ?? ""} onChange={(e) => atualizarSlide("pergunta_ao_cliente", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
            </label>

            {slideAtivo.como_apresentar && (
              <p className="rounded-sm border border-linha bg-papel-fundo px-2.5 py-2 text-xs text-tinta-suave">
                <strong className="text-tinta">Como apresentar (nota da IA):</strong> {slideAtivo.como_apresentar}
              </p>
            )}

            {slideTemGrafico(slideAtivo.tipo) && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-tinta-fraca">Prévia do gráfico deste slide</p>
                <GraficoDoSlide tipo={slideAtivo.tipo} dados={dadosGraficos} tema={tema} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
