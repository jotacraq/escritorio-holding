"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import Link from "next/link";
import {
  ErroConhecimento,
  buscarNoConhecimento,
  ehCancelamento,
  listarCasos,
  type ListaCasos,
} from "@/components/conhecimento/api";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { EsqueletoCartao, EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { nomeDoSlug } from "@/components/conhecimento/rotulo";
import type { DesfechoObservado, ResultadoBusca, TipoTranscricao } from "@/types/conhecimento";

export const ROTULO_TIPO: Record<TipoTranscricao, string> = {
  sessao_viabilidade: "Sessão de Viabilidade",
  apresentacao_croqui: "Apresentação de croqui",
};

const TAMANHO_MINIMO_TERMO = 2;
const ATRASO_BUSCA_MS = 350;

/**
 * Renderiza o trecho que o Postgres devolveu com `ts_headline`, onde o termo
 * encontrado vem cercado por `**`. Fatiar por marcador é o suficiente aqui e
 * evita injetar HTML de string — o conteúdo é transcrição de cliente.
 */
function Trecho({ texto }: { texto: string }) {
  const partes = texto.split("**");
  return (
    <p className="text-sm leading-relaxed text-tinta-suave">
      {partes.map((parte, indice) =>
        indice % 2 === 1 ? (
          <mark key={indice} className="rounded-[4px] bg-latao-fraco px-1 font-bold text-tinta">
            {parte}
          </mark>
        ) : (
          <span key={indice}>{parte}</span>
        ),
      )}
    </p>
  );
}

function IconeSeta() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-tinta-fraca" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}

export function ConhecimentoApp() {
  const { dados: lista, carregando: carregandoLista, erro: erroLista, recarregar: carregarLista } = useRecurso<ListaCasos>(listarCasos, []);
  const [filtroCasos, setFiltroCasos] = useState<DesfechoObservado | "">("");

  const [termo, setTermo] = useState("");
  const [tipo, setTipo] = useState<TipoTranscricao | "">("");
  const [desfecho, setDesfecho] = useState<DesfechoObservado | "">("");
  const [termoBuscado, setTermoBuscado] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<unknown>(null);
  const temporizadorRef = useRef<number | undefined>(undefined);
  const controladorRef = useRef<AbortController | null>(null);

  /* Busca instantânea: cada tecla (ou troca de filtro) reagenda a chamada
     para 350 ms depois, cancelando a anterior. Tudo parte do evento —
     nenhum setState síncrono dentro de efeito. */
  const agendarBusca = useCallback((termoBruto: string, tipoAtual: TipoTranscricao | "", desfechoAtual: DesfechoObservado | "") => {
    window.clearTimeout(temporizadorRef.current);
    controladorRef.current?.abort();
    const termoLimpo = termoBruto.trim();
    if (termoLimpo.length < TAMANHO_MINIMO_TERMO) {
      setTermoBuscado("");
      setResultados(null);
      setErroBusca(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    temporizadorRef.current = window.setTimeout(() => {
      const controlador = new AbortController();
      controladorRef.current = controlador;
      setErroBusca(null);
      buscarNoConhecimento({ termo: termoLimpo, tipo: tipoAtual || undefined, desfecho: desfechoAtual || undefined }, controlador.signal)
        .then((encontrados) => {
          if (controlador.signal.aborted) return;
          setTermoBuscado(termoLimpo);
          setResultados(encontrados);
        })
        .catch((erro) => {
          if (ehCancelamento(erro) || controlador.signal.aborted) return;
          setTermoBuscado(termoLimpo);
          setErroBusca(erro);
          setResultados(null);
        })
        .finally(() => {
          if (!controlador.signal.aborted) setBuscando(false);
        });
    }, ATRASO_BUSCA_MS);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(temporizadorRef.current);
      controladorRef.current?.abort();
    },
    [],
  );

  function mudarTermo(valor: string) {
    setTermo(valor);
    agendarBusca(valor, tipo, desfecho);
  }
  function mudarTipo(valor: TipoTranscricao | "") {
    setTipo(valor);
    agendarBusca(termo, valor, desfecho);
  }
  function mudarDesfecho(valor: DesfechoObservado | "") {
    setDesfecho(valor);
    agendarBusca(termo, tipo, valor);
  }

  const contagem = useMemo(() => {
    if (!lista) return null;
    const mapa = new Map<DesfechoObservado, number>();
    for (const linha of lista.contagem_por_desfecho) mapa.set(linha.desfecho_observado, linha.total);
    return {
      avancou: mapa.get("avancou_para_croqui") ?? 0,
      indefinido: mapa.get("indefinido") ?? 0,
    };
  }, [lista]);

  const casosFiltrados = useMemo(() => {
    const casos = lista?.casos ?? [];
    if (!filtroCasos) return casos;
    return casos.filter((c) => c.desfecho_observado === filtroCasos);
  }, [lista, filtroCasos]);

  const semAcesso = erroLista instanceof ErroConhecimento && (erroLista.status === 401 || erroLista.status === 403);
  const baseVazia = !carregandoLista && !erroLista && (lista?.casos.length ?? 0) === 0;

  if (semAcesso) {
    return (
      <div className="flex flex-col gap-8">
        <CabecalhoPagina rotulo="Método" titulo="Conhecimento" />
        <EstadoVazio
          ilustracao="pasta"
          titulo="Área restrita"
          descricao="A base de conhecimento reúne transcrições de reuniões com clientes — patrimônio, família, decisões. Só quem enxerga patrimônio no sistema (advogada e administração) tem acesso."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <CabecalhoPagina
        rotulo="Método"
        titulo="Conhecimento"
        descricao="As Sessões de Viabilidade e apresentações de croqui já realizadas, transcritas e consultáveis por texto. Leia antes de uma sessão para lembrar como famílias parecidas falaram, decidiram e travaram."
        meta={
          lista && lista.casos.length > 0 ? (
            <span>
              {lista.casos.length} caso{lista.casos.length === 1 ? "" : "s"} com transcrição
            </span>
          ) : undefined
        }
      />

      {/* ------------------------------------------------ trava de IA (LGPD) */}
      <Cartao realce="ambar" rotulo="Leitura por IA" titulo="A IA ainda não lê estas conversas" como="section">
        <div className="flex flex-col gap-3 text-sm text-tinta-suave">
          <p>
            Estas transcrições são conversas de clientes com a Dra. Elaine: patrimônio, família, conflitos. Mandar isso para um serviço de IA fora do escritório é tratamento de dado pessoal sensível — precisa de uma decisão jurídica registrada antes (LGPD), não de um botão.
          </p>
          <p>
            <strong className="font-bold text-tinta">O que fazer:</strong> a Dra. Elaine decide se e como as transcrições podem ser lidas por IA, e a decisão fica registrada em{" "}
            <Link href="/admin#pendencias" className="-my-3 inline-block py-3 font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
              Admin → Pendências
            </Link>
            . Até lá, a busca e a leitura abaixo funcionam normalmente — o texto fica no banco do escritório e não sai daqui.
          </p>
          <SeloStub texto="Análise por IA das transcrições: bloqueada até a decisão jurídica." className="self-start" />
        </div>
      </Cartao>

      {/* -------------------------------------------------- contagem por desfecho */}
      <section aria-labelledby="titulo-desfecho" className="flex flex-col gap-4">
        <div>
          <h2 id="titulo-desfecho" className="text-subtitulo font-bold text-tinta">
            O que se sabe sobre o desfecho
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-tinta-suave">
            Dois números separados, de propósito: “sem desfecho conhecido” não é perda — parte dessas sessões é recente ou o croqui não foi gravado. Por isso não viram taxa.
          </p>
        </div>
        {carregandoLista ? (
          <EsqueletoCartao quantidade={2} rotulo="Carregando os casos…" />
        ) : erroLista ? (
          <EstadoErro erro={erroLista} tentarNovamente={carregarLista} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Kpi
              rotulo="Avançaram para o croqui"
              valor={baseVazia ? null : contagem?.avancou}
              unidade={contagem?.avancou === 1 ? "caso" : "casos"}
              motivoVazio="nenhuma transcrição na base ainda"
              acao={
                contagem && contagem.avancou > 0 ? (
                  <button type="button" onClick={() => setFiltroCasos("avancou_para_croqui")} className="inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
                    Ver esses casos
                  </button>
                ) : undefined
              }
            />
            <Kpi
              rotulo="Sem desfecho conhecido"
              valor={baseVazia ? null : contagem?.indefinido}
              unidade={contagem?.indefinido === 1 ? "caso" : "casos"}
              motivoVazio="nenhuma transcrição na base ainda"
              acao={
                contagem && contagem.indefinido > 0 ? (
                  <button type="button" onClick={() => setFiltroCasos("indefinido")} className="inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
                    Ver esses casos
                  </button>
                ) : undefined
              }
            />
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ busca */}
      <Cartao
        rotulo="Buscar no que já foi dito"
        titulo="Que palavra a família usou?"
        descricao="Digite e os trechos aparecem sozinhos — “inventário”, “ITCMD”, “brigar”, “empresa”. Bom para lembrar como uma objeção surgiu na boca do cliente."
        como="section"
      >
        <form role="search" onSubmit={(e) => e.preventDefault()} className="grid gap-4 sm:grid-cols-[1fr_auto_auto]" noValidate>
          <Campo rotulo="Termo" ajuda={termo.trim().length > 0 && termo.trim().length < TAMANHO_MINIMO_TERMO ? "Digite ao menos duas letras." : undefined}>
            <Entrada
              type="search"
              value={termo}
              onChange={(e) => mudarTermo(e.target.value)}
              placeholder="inventário, ITCMD, brigar, empresa…"
              autoComplete="off"
              enterKeyHint="search"
            />
          </Campo>
          <Campo rotulo="Tipo de reunião" className="sm:min-w-[13rem]">
            <Selecao value={tipo} onChange={(e) => mudarTipo(e.target.value as TipoTranscricao | "")}>
              <option value="">Todas</option>
              <option value="sessao_viabilidade">Sessão de Viabilidade</option>
              <option value="apresentacao_croqui">Apresentação de croqui</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Desfecho" className="sm:min-w-[13rem]">
            <Selecao value={desfecho} onChange={(e) => mudarDesfecho(e.target.value as DesfechoObservado | "")}>
              <option value="">Todos</option>
              <option value="avancou_para_croqui">Avançou para croqui</option>
              <option value="indefinido">Sem desfecho conhecido</option>
            </Selecao>
          </Campo>
        </form>

        {/*
         * `aria-live="polite"`: quem usa leitor de tela digita e o foco continua
         * no campo — sem isto, o resultado (vazio, erro ou N reuniões
         * encontradas) nunca é anunciado.
         */}
        <div aria-live="polite" aria-atomic="true" aria-busy={buscando || undefined} className="mt-5">
          {buscando && resultados === null ? (
            <EsqueletoLista linhas={3} rotulo="Buscando…" />
          ) : erroBusca ? (
            <EstadoErro erro={erroBusca} titulo="Não deu para buscar" />
          ) : resultados === null ? null : resultados.length === 0 ? (
            <EstadoVazio
              compacto
              titulo={`Nenhuma reunião menciona “${termoBuscado}”`}
              descricao="Tente outra palavra — o jeito que o cliente fala costuma ser mais simples que o termo técnico — ou tire os filtros de tipo e desfecho."
            />
          ) : (
            <div className={`flex flex-col gap-3 transition-opacity duration-[var(--transicao-rapida)] ${buscando ? "opacity-70" : ""}`}>
              <p className="text-xs text-tinta-suave">
                {resultados.length} reuni{resultados.length === 1 ? "ão menciona" : "ões mencionam"} “{termoBuscado}”
                {resultados.length >= 40 ? " — mostrando as 40 mais relevantes" : ""}
              </p>
              <ul className="flex flex-col gap-3">
                {resultados.map((r) => (
                  <li key={r.transcricao_id}>
                    <Link
                      href={`/conhecimento/transcricoes/${r.transcricao_id}`}
                      className="flex min-h-11 flex-col gap-2 rounded-controle border border-linha bg-papel-elevado p-4 transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:shadow-cartao focus-visible:border-[color:var(--latao)]"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-tinta">{nomeDoSlug(r.rotulo)}</span>
                        <Selo tom={r.tipo === "apresentacao_croqui" ? "azul" : "neutro"}>{ROTULO_TIPO[r.tipo]}</Selo>
                        {r.data_reuniao ? <span className="text-xs text-tinta-fraca">{formatarData(r.data_reuniao)}</span> : null}
                      </span>
                      <Trecho texto={r.trecho} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Cartao>

      {/* ------------------------------------------------------------------ casos */}
      <Cartao
        preenchimento="sem"
        rotulo="Casos"
        titulo="Uma família por linha"
        descricao="Cada caso junta a Sessão de Viabilidade e, quando houve, a apresentação do croqui da mesma pessoa — lado a lado."
        como="section"
      >
        {lista && lista.casos.length > 0 && (
          <div role="group" aria-label="Filtrar casos por desfecho" className="flex flex-wrap gap-2 border-b border-linha px-5 py-4 sm:px-6">
            {(
              [
                { id: "", rotulo: "Todos" },
                { id: "avancou_para_croqui", rotulo: "Com croqui apresentado" },
                { id: "indefinido", rotulo: "Sem desfecho conhecido" },
              ] as { id: DesfechoObservado | ""; rotulo: string }[]
            ).map((f) => {
              const ativo = filtroCasos === f.id;
              return (
                <button
                  key={f.id || "todos"}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setFiltroCasos(f.id)}
                  className={`inline-flex min-h-11 items-center rounded-pilula border px-4 text-sm font-medium transition-colors duration-[var(--transicao-rapida)] ${
                    ativo ? "border-[color:var(--latao)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel-elevado text-tinta-suave hover:border-[color:var(--latao)] hover:text-tinta"
                  }`}
                >
                  {f.rotulo}
                </button>
              );
            })}
          </div>
        )}
        {carregandoLista ? (
          <div className="p-5 sm:p-6">
            <EsqueletoLista linhas={6} rotulo="Carregando os casos…" />
          </div>
        ) : erroLista ? (
          <div className="p-5 sm:p-6">
            <EstadoErro erro={erroLista} tentarNovamente={carregarLista} />
          </div>
        ) : baseVazia ? (
          <div className="p-5 sm:p-6">
            <EstadoVazio
              ilustracao="pasta"
              titulo="A base ainda não foi carregada"
              descricao="Nenhuma transcrição foi importada para este banco. As transcrições entram pelo roteiro de ingestão do time de tecnologia (scripts/importar-transcricoes.ts) — as 70 conversas ficam só no banco, nunca no repositório."
              acao={
                <Link href="/admin#pendencias" className="inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
                  Registrar a pendência em Admin
                </Link>
              }
            />
          </div>
        ) : casosFiltrados.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EstadoVazio compacto titulo="Nenhum caso neste filtro" descricao="Troque o filtro para ver as demais famílias." />
          </div>
        ) : (
          <ul className="divide-y divide-linha" aria-live="polite">
            {casosFiltrados.map((caso) => (
              <li key={caso.caso_id}>
                <Link
                  href={`/conhecimento/casos/${caso.caso_id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel focus-visible:bg-papel sm:px-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium text-tinta">{nomeDoSlug(caso.rotulo)}</span>
                    <span className="text-xs text-tinta-suave">
                      Sessão em {formatarData(caso.sv_data_reuniao)}
                      {caso.sv_consultor ? ` · ${caso.sv_consultor}` : ""}
                      {caso.croqui_data_reuniao ? ` · croqui em ${formatarData(caso.croqui_data_reuniao)}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {caso.transcricao_croqui_id ? <Selo tom="verde">croqui apresentado</Selo> : <Selo tom="neutro">sem desfecho conhecido</Selo>}
                    <IconeSeta />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
