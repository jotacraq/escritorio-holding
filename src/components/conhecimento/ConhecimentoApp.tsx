"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ErroConhecimento,
  buscarNoConhecimento,
  listarCasos,
  type ListaCasos,
} from "@/components/conhecimento/api";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { nomeDoSlug } from "@/components/conhecimento/rotulo";
import type { DesfechoObservado, ResultadoBusca, TipoTranscricao } from "@/types/conhecimento";

const ROTULO_TIPO: Record<TipoTranscricao, string> = {
  sessao_viabilidade: "Sessão de Viabilidade",
  apresentacao_croqui: "Apresentação de croqui",
};

/**
 * Renderiza o trecho que o Postgres devolveu com `ts_headline`, onde o termo
 * encontrado vem cercado por `**`. Fatiar por marcador é o suficiente aqui e
 * evita injetar HTML de string — o conteúdo é transcrição de cliente.
 */
function Trecho({ texto }: { texto: string }) {
  const partes = texto.split("**");
  return (
    <p className="text-sm leading-relaxed text-tinta-fraca">
      {partes.map((parte, indice) =>
        indice % 2 === 1 ? (
          <mark key={indice} className="rounded bg-latao-fraco px-0.5 text-[color:var(--latao-forte)]">
            {parte}
          </mark>
        ) : (
          <span key={indice}>{parte}</span>
        ),
      )}
    </p>
  );
}

export function ConhecimentoApp() {
  const [lista, setLista] = useState<ListaCasos | null>(null);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroLista, setErroLista] = useState<unknown>(null);

  const [termo, setTermo] = useState("");
  const [tipo, setTipo] = useState<TipoTranscricao | "">("");
  const [desfecho, setDesfecho] = useState<DesfechoObservado | "">("");
  const [resultados, setResultados] = useState<ResultadoBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<unknown>(null);

  const carregarLista = useCallback(async () => {
    setCarregandoLista(true);
    setErroLista(null);
    try {
      setLista(await listarCasos());
    } catch (erro) {
      setErroLista(erro);
    } finally {
      setCarregandoLista(false);
    }
  }, []);

  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  const contagem = useMemo(() => {
    const mapa = new Map<DesfechoObservado, number>();
    for (const linha of lista?.contagem_por_desfecho ?? []) {
      mapa.set(linha.desfecho_observado, linha.total);
    }
    return {
      avancou: mapa.get("avancou_para_croqui") ?? 0,
      indefinido: mapa.get("indefinido") ?? 0,
    };
  }, [lista]);

  async function submeterBusca(evento: React.FormEvent) {
    evento.preventDefault();
    if (!termo.trim()) return;
    setBuscando(true);
    setErroBusca(null);
    try {
      setResultados(
        await buscarNoConhecimento({
          termo: termo.trim(),
          tipo: tipo || undefined,
          desfecho: desfecho || undefined,
        }),
      );
    } catch (erro) {
      setErroBusca(erro);
      setResultados(null);
    } finally {
      setBuscando(false);
    }
  }

  const semAcesso =
    erroLista instanceof ErroConhecimento && (erroLista.status === 401 || erroLista.status === 403);

  if (semAcesso) {
    return (
      <EstadoVazio
        titulo="Área restrita"
        descricao="A base de conhecimento reúne transcrições de reuniões com clientes. Só quem enxerga patrimônio tem acesso."
      />
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-serif">Conhecimento</h1>
        <p className="mt-1 text-sm text-tinta-fraca">
          Módulo 4 do método — as Sessões de Viabilidade e as apresentações de croqui já
          realizadas, consultáveis por texto.
        </p>
      </header>

      <SeloStub texto="Leitura por IA desligada: depende de decisão jurídica sobre tratamento de transcrição de cliente por IA de terceiro. A busca e a leitura abaixo funcionam normalmente — são dados do escritório, no banco do escritório." />

      {/* -------------------------------------------------- contagem por desfecho */}
      <section aria-labelledby="titulo-desfecho" className="space-y-3">
        <h2 id="titulo-desfecho" className="text-sm font-medium uppercase tracking-wide text-tinta-fraca">
          O que se sabe sobre o desfecho
        </h2>
        {carregandoLista ? (
          <EstadoCarregando rotulo="Carregando casos…" />
        ) : erroLista ? (
          <EstadoErro erro={erroLista} tentarNovamente={() => void carregarLista()} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-linha bg-papel p-4">
                <p className="text-3xl font-serif">{contagem.avancou}</p>
                <p className="mt-1 text-sm">avançaram para apresentação de croqui</p>
                <p className="mt-1 text-xs text-tinta-fraca">
                  Há transcrição das duas reuniões, da mesma pessoa.
                </p>
              </div>
              <div className="rounded-lg border border-linha bg-papel p-4">
                <p className="text-3xl font-serif">{contagem.indefinido}</p>
                <p className="mt-1 text-sm">sem desfecho conhecido</p>
                <p className="mt-1 text-xs text-tinta-fraca">
                  Só há a Sessão de Viabilidade gravada.
                </p>
              </div>
            </div>
            <p className="rounded-md border border-linha bg-papel-fundo p-3 text-sm text-tinta-fraca">
              <strong className="text-tinta">Sem desfecho conhecido não é perda.</strong>{" "}
              Parte dessas sessões é recente e pode estar em andamento. Por isso os dois números
              aparecem separados e não viram uma taxa de conversão — o material não prova o
              contrário para elas.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ busca */}
      <section aria-labelledby="titulo-busca" className="space-y-3">
        <h2 id="titulo-busca" className="text-sm font-medium uppercase tracking-wide text-tinta-fraca">
          Buscar no que já foi dito
        </h2>
        <form onSubmit={submeterBusca} className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[16rem] text-sm">
            <span className="mb-1 block text-tinta-fraca">Termo</span>
            <input
              type="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="inventário, ITCMD, brigar, empresa…"
              className="w-full rounded-md border border-linha bg-papel px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-tinta-fraca">Tipo de reunião</span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoTranscricao | "")}
              className="rounded-md border border-linha bg-papel px-3 py-2"
            >
              <option value="">Todas</option>
              <option value="sessao_viabilidade">Sessão de Viabilidade</option>
              <option value="apresentacao_croqui">Apresentação de croqui</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-tinta-fraca">Desfecho</span>
            <select
              value={desfecho}
              onChange={(e) => setDesfecho(e.target.value as DesfechoObservado | "")}
              className="rounded-md border border-linha bg-papel px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="avancou_para_croqui">Avançou para croqui</option>
              <option value="indefinido">Sem desfecho conhecido</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={buscando || !termo.trim()}
            className="rounded-md border border-linha-forte bg-latao-fraco px-4 py-2 text-sm font-medium text-tinta hover:border-latao disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </form>

        {erroBusca ? (
          <EstadoErro erro={erroBusca} titulo="Não deu para buscar" />
        ) : resultados === null ? null : resultados.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma reunião menciona esse termo"
            descricao="Tente outra palavra, ou tire os filtros de tipo e desfecho."
          />
        ) : (
          <ul className="space-y-3">
            <li className="text-xs text-tinta-fraca">
              {resultados.length} reunião(ões) com esse termo
            </li>
            {resultados.map((r) => (
              <li
                key={r.transcricao_id}
                className="rounded-lg border border-linha bg-papel p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/conhecimento/transcricoes/${r.transcricao_id}`}
                    className="font-medium underline decoration-[color:var(--linha-forte)] underline-offset-4"
                  >
                    {r.rotulo}
                  </Link>
                  <Selo tom={r.tipo === "apresentacao_croqui" ? "azul" : "neutro"}>
                    {ROTULO_TIPO[r.tipo]}
                  </Selo>
                  {r.data_reuniao ? (
                    <span className="text-xs text-tinta-fraca">
                      {formatarData(r.data_reuniao)}
                    </span>
                  ) : null}
                </div>
                <Trecho texto={r.trecho} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ casos */}
      <section aria-labelledby="titulo-casos" className="space-y-3">
        <h2 id="titulo-casos" className="text-sm font-medium uppercase tracking-wide text-tinta-fraca">
          Casos
        </h2>
        {carregandoLista ? (
          <EstadoCarregando rotulo="Carregando casos…" />
        ) : !lista || lista.casos.length === 0 ? (
          <EstadoVazio
            titulo="A base ainda não foi carregada"
            descricao="Nenhuma transcrição foi importada para este banco até agora."
          />
        ) : (
          <ul className="divide-y divide-[var(--linha)] rounded-lg border border-linha bg-papel">
            {lista.casos.map((caso) => (
              <li key={caso.caso_id}>
                <Link
                  href={`/conhecimento/casos/${caso.caso_id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-papel-fundo"
                >
                  <span className="font-medium">{nomeDoSlug(caso.rotulo)}</span>
                  <span className="flex items-center gap-3 text-xs text-tinta-fraca">
                    <span>Sessão {formatarData(caso.sv_data_reuniao)}</span>
                    {caso.transcricao_croqui_id ? (
                      <Selo tom="verde">croqui apresentado</Selo>
                    ) : (
                      <Selo tom="neutro">sem desfecho conhecido</Selo>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
