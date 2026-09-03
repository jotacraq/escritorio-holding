"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { lerCaso, lerTranscricao } from "@/components/conhecimento/api";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { nomeDoSlug } from "@/components/conhecimento/rotulo";
import type { CasoComTranscricoes, Transcricao } from "@/types/conhecimento";

/**
 * Texto de reunião é diálogo longo. Quebrar em parágrafos e limitar a largura da
 * linha é o que torna 40 mil caracteres legíveis — a transcrição vem como texto
 * corrido, sem marcação.
 */
function CorpoTranscricao({ conteudo }: { conteudo: string }) {
  const paragrafos = conteudo.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className="space-y-3">
      {paragrafos.map((paragrafo, indice) => (
        <p key={indice} className="max-w-[62ch] text-sm leading-relaxed whitespace-pre-wrap">
          {paragrafo}
        </p>
      ))}
    </div>
  );
}

function Coluna({
  titulo,
  transcricao,
  vazio,
}: {
  titulo: string;
  transcricao: Transcricao | null;
  vazio: string;
}) {
  return (
    <section className="min-w-0 flex-1 rounded-lg border border-linha bg-papel">
      <header className="border-b border-linha px-4 py-3">
        <h2 className="font-medium">{titulo}</h2>
        {transcricao ? (
          <p className="mt-0.5 text-xs text-tinta-fraca">
            {formatarData(transcricao.data_reuniao)}
            {transcricao.consultor ? ` · ${transcricao.consultor}` : ""} ·{" "}
            {Math.round(transcricao.tamanho_bytes / 1024)} KB
          </p>
        ) : null}
      </header>
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
        {transcricao ? (
          <CorpoTranscricao conteudo={transcricao.conteudo} />
        ) : (
          <p className="text-sm text-tinta-fraca">{vazio}</p>
        )}
      </div>
    </section>
  );
}

export function LeitorCaso({ casoId }: { casoId: string }) {
  const [dados, setDados] = useState<CasoComTranscricoes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await lerCaso(casoId));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [casoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <EstadoCarregando rotulo="Carregando o caso…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={() => void carregar()} />;
  if (!dados) return <EstadoVazio titulo="Caso não encontrado" />;

  const { caso, sessao_viabilidade, apresentacao_croqui } = dados;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/conhecimento" className="text-sm text-tinta-fraca hover:text-tinta">
          ← Conhecimento
        </Link>
        <h1 className="mt-2 text-2xl font-serif">{nomeDoSlug(caso.rotulo)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-tinta-fraca">
          {apresentacao_croqui ? (
            <Selo tom="verde">croqui apresentado</Selo>
          ) : (
            <Selo tom="neutro">sem desfecho conhecido</Selo>
          )}
          {!apresentacao_croqui ? (
            <span>
              Não há apresentação de croqui gravada — isso não significa que o cliente não
              avançou.
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <Coluna
          titulo="Sessão de Viabilidade"
          transcricao={sessao_viabilidade}
          vazio="Transcrição não disponível."
        />
        <Coluna
          titulo="Apresentação do croqui"
          transcricao={apresentacao_croqui}
          vazio="Nenhuma apresentação de croqui gravada para esta pessoa."
        />
      </div>
    </div>
  );
}

export function LeitorTranscricao({ transcricaoId }: { transcricaoId: string }) {
  const [transcricao, setTranscricao] = useState<Transcricao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setTranscricao(await lerTranscricao(transcricaoId));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [transcricaoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <EstadoCarregando rotulo="Carregando a transcrição…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={() => void carregar()} />;
  if (!transcricao) return <EstadoVazio titulo="Transcrição não encontrada" />;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/conhecimento" className="text-sm text-tinta-fraca hover:text-tinta">
          ← Conhecimento
        </Link>
        <h1 className="mt-2 text-2xl font-serif">{transcricao.rotulo}</h1>
        <p className="mt-1 text-xs text-tinta-fraca">
          {transcricao.tipo === "apresentacao_croqui"
            ? "Apresentação de croqui"
            : "Sessão de Viabilidade"}{" "}
          · {formatarData(transcricao.data_reuniao)}
          {transcricao.consultor ? ` · ${transcricao.consultor}` : ""}
        </p>
      </header>
      <article className="rounded-lg border border-linha bg-papel px-5 py-5">
        <CorpoTranscricao conteudo={transcricao.conteudo} />
      </article>
    </div>
  );
}
