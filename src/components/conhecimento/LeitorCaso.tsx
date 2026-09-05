"use client";

import { useCallback } from "react";
import Link from "next/link";
import { lerCaso, lerTranscricao } from "@/components/conhecimento/api";
import { useRecurso } from "@/hooks/useRecurso";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { nomeDoSlug } from "@/components/conhecimento/rotulo";
import type { CasoComTranscricoes, Transcricao } from "@/types/conhecimento";

const ROTULO_TIPO = {
  sessao_viabilidade: "Sessão de Viabilidade",
  apresentacao_croqui: "Apresentação de croqui",
} as const;

function VoltarAoConhecimento() {
  return (
    <Link href="/conhecimento" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
      ← Conhecimento
    </Link>
  );
}

/**
 * Texto de reunião é diálogo longo. Quebrar em parágrafos, limitar a largura
 * da linha (~65 caracteres) e dar entrelinha generosa é o que torna 40 mil
 * caracteres legíveis — a transcrição vem como texto corrido, sem marcação.
 * Quando um parágrafo começa com "Nome:" (padrão de transcrição de
 * reunião), o nome vira rótulo em negrito para a leitura seguir o diálogo.
 */
function CorpoTranscricao({ conteudo }: { conteudo: string }) {
  const paragrafos = conteudo.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className="flex flex-col gap-4">
      {paragrafos.map((paragrafo, indice) => {
        const fala = paragrafo.match(/^([A-Za-zÀ-ÿ][\wÀ-ÿ .'-]{1,40}):\s+([\s\S]+)$/);
        return (
          <p key={indice} className="max-w-[65ch] text-corpo leading-relaxed whitespace-pre-wrap text-tinta">
            {fala ? (
              <>
                <span className="font-bold text-tinta">{fala[1]}:</span> {fala[2]}
              </>
            ) : (
              paragrafo
            )}
          </p>
        );
      })}
    </div>
  );
}

function Coluna({ titulo, transcricao, vazio }: { titulo: string; transcricao: Transcricao | null; vazio: string }) {
  return (
    <Cartao
      como="article"
      preenchimento="sem"
      className="min-w-0 flex-1"
      rotulo={titulo}
      titulo={transcricao ? formatarData(transcricao.data_reuniao) : "—"}
      descricao={
        transcricao
          ? `${transcricao.consultor ? `${transcricao.consultor} · ` : ""}${Math.round(transcricao.tamanho_bytes / 1024)} KB de transcrição`
          : undefined
      }
      acao={
        transcricao ? (
          <Link href={`/conhecimento/transcricoes/${transcricao.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
            Ler inteira
          </Link>
        ) : undefined
      }
    >
      <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6" tabIndex={transcricao ? 0 : undefined} aria-label={transcricao ? `Texto da ${titulo}` : undefined}>
        {transcricao ? <CorpoTranscricao conteudo={transcricao.conteudo} /> : <EstadoVazio compacto titulo={vazio} />}
      </div>
    </Cartao>
  );
}

export function LeitorCaso({ casoId }: { casoId: string }) {
  const buscar = useCallback(() => lerCaso(casoId), [casoId]);
  const { dados, carregando, erro, recarregar } = useRecurso<CasoComTranscricoes>(buscar, [casoId]);

  if (carregando) return <EsqueletoFicha rotulo="Carregando o caso…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} />;
  if (!dados) return <EstadoVazio titulo="Caso não encontrado" acao={<VoltarAoConhecimento />} />;

  const { caso, sessao_viabilidade, apresentacao_croqui } = dados;

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Método · Conhecimento"
        acima={<VoltarAoConhecimento />}
        titulo={nomeDoSlug(caso.rotulo)}
        descricao={
          apresentacao_croqui
            ? "Esta família passou pela Sessão de Viabilidade e recebeu a apresentação do croqui. As duas conversas ficam lado a lado."
            : "Só há a Sessão de Viabilidade gravada. Não há apresentação de croqui na base — isso não quer dizer que a família não avançou."
        }
        meta={
          <>
            {apresentacao_croqui ? <Selo tom="verde">croqui apresentado</Selo> : <Selo tom="neutro">sem desfecho conhecido</Selo>}
            {sessao_viabilidade?.data_reuniao && <span>Sessão em {formatarData(sessao_viabilidade.data_reuniao)}</span>}
            {apresentacao_croqui?.data_reuniao && <span>· Croqui em {formatarData(apresentacao_croqui.data_reuniao)}</span>}
          </>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <Coluna titulo="Sessão de Viabilidade" transcricao={sessao_viabilidade} vazio="Transcrição não disponível." />
        <Coluna titulo="Apresentação do croqui" transcricao={apresentacao_croqui} vazio="Nenhuma apresentação de croqui gravada para esta pessoa." />
      </div>
    </div>
  );
}

export function LeitorTranscricao({ transcricaoId }: { transcricaoId: string }) {
  const buscar = useCallback(() => lerTranscricao(transcricaoId), [transcricaoId]);
  const { dados: transcricao, carregando, erro, recarregar } = useRecurso<Transcricao>(buscar, [transcricaoId]);

  if (carregando) return <EsqueletoFicha rotulo="Carregando a transcrição…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} />;
  if (!transcricao) return <EstadoVazio titulo="Transcrição não encontrada" acao={<VoltarAoConhecimento />} />;

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Método · Conhecimento"
        acima={<VoltarAoConhecimento />}
        titulo={nomeDoSlug(transcricao.rotulo)}
        meta={
          <>
            <Selo tom={transcricao.tipo === "apresentacao_croqui" ? "azul" : "neutro"}>{ROTULO_TIPO[transcricao.tipo]}</Selo>
            <span>{formatarData(transcricao.data_reuniao)}</span>
            {transcricao.consultor ? <span>· {transcricao.consultor}</span> : null}
            <span>· {Math.round(transcricao.tamanho_bytes / 1024)} KB</span>
          </>
        }
      />
      <Cartao como="article">
        <CorpoTranscricao conteudo={transcricao.conteudo} />
      </Cartao>
    </div>
  );
}
