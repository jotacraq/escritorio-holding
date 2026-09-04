"use client";

import { useState } from "react";
import Link from "next/link";
import { atualizarCroqui, ApiError, type Croqui, type StatusCroqui } from "@/lib/api";
import { contarRevisaoSlides } from "@/lib/croqui";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { ConfirmarAcao } from "@/components/admin/ConfirmarAcao";
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
 * assina marcando "revisado". A revisão dos 13 slides NÃO é mais trava
 * obrigatória para marcar como "pronto": é sinal de atenção. A advogada pode
 * assinar mesmo com pendências — quando há pendência, esta tela pede
 * confirmação explícita antes de salvar (`ConfirmarAcao`), mas não bloqueia.
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
  const [confirmandoPronto, setConfirmandoPronto] = useState(false);

  const slideAtivo = slides[indiceAtivo];
  const { pendentes } = contarRevisaoSlides(slides);

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
    setSalvando(true);
    setErro(null);
    try {
      await atualizarCroqui(croqui.id, { titulo, conteudo: { slides }, status: novoStatus ?? croqui.status });
      setSalvo(true);
      aoAtualizar();
    } catch (e) {
      // A trava por slides não revisados nasce DESLIGADA (migration 0049) —
      // se ela for religada manualmente no banco, a rota devolve 409 com este
      // código específico. Tratamento dedicado em vez de mensagem genérica,
      // porque sem isso a advogada veria um erro sem explicação nenhuma.
      if (e instanceof ApiError && e.codigo === "croqui_pronto_exige_13_slides_revisados") {
        setErro('O banco recusou marcar como "pronto": a trava de revisão dos 13 slides foi religada manualmente. Revise os slides pendentes ou peça para desligar a trava.');
      } else {
        setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o croqui.");
      }
    } finally {
      setSalvando(false);
    }
  }

  function aoClicarMarcarComoPronto() {
    if (pendentes > 0) {
      setConfirmandoPronto(true);
      return;
    }
    salvar("pronto");
  }

  function confirmarMarcarComoPronto() {
    setConfirmandoPronto(false);
    salvar("pronto");
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
          <span aria-live="polite" className="text-xs text-tinta-fraca">
            {slides.length - pendentes} de {slides.length} slides revisados
          </span>
          <Botao variante="secundario" carregando={salvando} onClick={() => salvar()}>Salvar rascunho</Botao>
          <Botao variante="primario" carregando={salvando} onClick={aoClicarMarcarComoPronto}>
            Marcar como pronto
          </Botao>
          <Link href={`/jornadas/${jornadaId}/croqui/${croqui.id}/apresentar`}>
            <Botao variante="secundario">Abrir apresentação</Botao>
          </Link>
        </div>
      </div>

      {pendentes > 0 && (
        <p className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3 py-2 text-xs text-[color:var(--ambar)]">
          {pendentes} de {slides.length} slides ainda sem revisão da advogada. O croqui pode ser marcado como pronto assim mesmo — a
          assinatura é sua.
        </p>
      )}

      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      {salvo && !erro && <p role="status" className="text-sm text-[color:var(--verde)]">Salvo.</p>}

      <ConfirmarAcao
        aberto={confirmandoPronto}
        titulo="Marcar como pronto com slides sem revisão?"
        efeito={`${pendentes} de ${slides.length} slides ainda não foram revisados. Marcar como "pronto" mesmo assim assina o croqui como está — a responsabilidade pelo conteúdo não revisado passa a ser sua. Continuar?`}
        rotuloConfirmar="Marcar como pronto mesmo assim"
        confirmando={salvando}
        aoConfirmar={confirmarMarcarComoPronto}
        aoCancelar={() => setConfirmandoPronto(false)}
      />

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
