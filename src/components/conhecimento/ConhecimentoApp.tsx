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
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { nomeDoSlug } from "@/components/conhecimento/rotulo";
import type { DesfechoObservado, ResultadoBusca, TipoTranscricao } from "@/types/conhecimento";

export const ROTULO_TIPO: Record<TipoTranscricao, string> = {
  sessao_viabilidade: "Sessão de Viabilidade",
  apresentacao_croqui: "Apresentação de croqui",
};

/**
 * Quantos casos cabem numa página. Fase 7: a lista deixou de ser "8 + botão
 * que despeja os 52" e virou paginação — despejar os 52 fazia a aba medir
 * 4.900 px, e o botão "Ver os 52 casos" era um convite a isso. Com página o
 * teto de altura é constante, não depende do tamanho da base.
 */
const CASOS_POR_PAGINA = 10;

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
  /** Filtro por texto sobre o NOME da família — não confundir com a busca
      dentro das conversas, acima: aqui só se procura de quem é o caso. */
  const [filtroNome, setFiltroNome] = useState("");
  const [pagina, setPagina] = useState(1);

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
    const nome = filtroNome.trim().toLowerCase();
    return casos.filter(
      (c) => (!filtroCasos || c.desfecho_observado === filtroCasos) && (!nome || nomeDoSlug(c.rotulo).toLowerCase().includes(nome)),
    );
  }, [lista, filtroCasos, filtroNome]);

  const totalPaginas = Math.max(1, Math.ceil(casosFiltrados.length / CASOS_POR_PAGINA));
  /* Trocar de filtro com a página 7 aberta mostrava uma lista vazia sobre uma
     base cheia. A página é derivada, não guardada: se saiu do intervalo, é a
     última que existe. Sem efeito, sem setState em render. */
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * CASOS_POR_PAGINA;
  const casosDaPagina = casosFiltrados.slice(inicio, inicio + CASOS_POR_PAGINA);

  const semAcesso = erroLista instanceof ErroConhecimento && (erroLista.status === 401 || erroLista.status === 403);
  const baseVazia = !carregandoLista && !erroLista && (lista?.casos.length ?? 0) === 0;

  if (semAcesso) {
    return (
      <EstadoVazio
        ilustracao="pasta"
        titulo="Área restrita"
        descricao="O repertório reúne transcrições de reuniões com clientes — patrimônio, família, decisões. Só quem enxerga patrimônio no sistema (advogada e administração) tem acesso."
      />
    );
  }

  return (
    <div className="flex flex-col gap-bloco">
      {/* Fase 6: "Conhecimento" virou a aba "Repertório da IA" do Admin. O
          `h1` é o da página (Admin) e a frase que explica o que isto é vive
          na `descricao` da aba — o João pediu que ficasse REGISTRADO na tela
          que este é o repertório da IA. Aqui sobra só o estado. */}
      {/* ------------------------------------------------ trava de IA (LGPD) */}
      {/* Era um cartão de 5 linhas em toda visita. O fato é um só e cabe numa
          linha; o porquê (dado pessoal sensível, decisão jurídica) vive no
          `title` e na página de Pendências, que é onde a decisão mora. */}
      <div className="flex min-h-11 flex-wrap items-center gap-item rounded-controle border border-ambar-borda bg-ambar-fraco px-3 py-1 text-sm text-tinta">
        <SeloStub texto="A IA ainda não lê estas conversas" />
        <span
          className="text-tinta-suave"
          title="São conversas de clientes com a Dra. Elaine — patrimônio, família, conflitos. Mandar isso a um serviço de IA fora do escritório é tratamento de dado pessoal sensível: precisa de decisão jurídica registrada (LGPD), não de um botão."
        >
          A busca e a leitura abaixo funcionam. O texto não sai do banco do escritório.
        </span>
        <Link href="/admin#pendencias" className="-my-3 inline-flex min-h-11 items-center py-3 font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
          Onde a decisão fica registrada
        </Link>
      </div>

      {/* ------------------------------------------------------------------ busca */}
      {/* A busca dentro das conversas é seção de CONSULTA: quem abre a aba
          quer, na maioria das vezes, a lista de casos. Fica um `<details>`
          nativo (DS §3.1) — Tab, Enter e Ctrl+F de graça —, fechado por
          padrão e aberto sozinho quando já há termo digitado. Eram 215 px
          de formulário parado em toda visita. */}
      <details open={termo.trim().length > 0} className="group rounded-cartao border border-linha bg-papel-elevado px-5 shadow-cartao sm:px-6">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-item gap-y-0.5 py-2 marker:content-none">
          <h2 className="text-subtitulo font-bold text-tinta">Buscar no que já foi dito</h2>
          <span className="flex items-center gap-item text-legenda font-medium text-tinta-fraca">
            <span title="Digite e os trechos aparecem sozinhos — “inventário”, “ITCMD”, “brigar”, “empresa”. Bom para lembrar como uma objeção surgiu na boca do cliente.">
              que palavra a família usou
            </span>
            <span aria-hidden="true" className="group-open:hidden">ver</span>
            <span aria-hidden="true" className="hidden group-open:inline">esconder</span>
          </span>
        </summary>
        <div className="pb-cartao">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="grid gap-cartao sm:grid-cols-[1fr_auto_auto]" noValidate>
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
              <p className="text-legenda text-tinta-suave">
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
                        {r.data_reuniao ? <span className="text-legenda text-tinta-fraca">{formatarData(r.data_reuniao)}</span> : null}
                      </span>
                      <Trecho texto={r.trecho} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        </div>
      </details>

      {/* ------------------------------------------------------------------ casos */}
      {/* O rótulo "CASOS" e a frase que explicava o agrupamento saíram do
          fluxo: o título já diz o que é a lista, a contagem está nos chips e
          a explicação vive no `title` do título (lei de texto, DS §2.2). */}
      <Cartao preenchimento="sem" como="section" aria-label="Casos com transcrição">
        {lista && lista.casos.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-cartao gap-y-item border-b border-linha px-5 py-2 sm:px-6">
            {/* Título, contagem e filtros na MESMA barra. Em duas faixas
                (cabeçalho do cartão + barra de filtros) custavam 134 px para
                dizer o que cabe em 76. */}
            <h2
              title="Cada caso junta a Sessão de Viabilidade e, quando houve, a apresentação do croqui da mesma pessoa — lado a lado."
              className="text-subtitulo font-bold text-tinta"
            >
              Uma família por linha
            </h2>
            {/* O número de cada desfecho vive AQUI, no filtro que o aplica.
                Antes eram dois KPIs grandes no topo com um link "Ver esses
                casos" que fazia exatamente o que estes chips já fazem — 225 px
                para repetir um controle que existia logo abaixo. */}
            <div role="group" aria-label="Filtrar casos por desfecho" className="flex flex-wrap gap-item">
              {(
                [
                  { id: "", rotulo: "Todos", total: lista.casos.length, title: undefined },
                  { id: "avancou_para_croqui", rotulo: "Com croqui apresentado", total: contagem?.avancou, title: "A mesma família teve a Sessão de Viabilidade e depois a apresentação do croqui." },
                  {
                    id: "indefinido",
                    rotulo: "Sem desfecho conhecido",
                    total: contagem?.indefinido,
                    title: "Não é perda: a sessão é recente ou o croqui não foi gravado. Por isso não vira taxa.",
                  },
                ] as { id: DesfechoObservado | ""; rotulo: string; total: number | undefined; title?: string }[]
              ).map((f) => {
                const ativo = filtroCasos === f.id;
                return (
                  <button
                    key={f.id || "todos"}
                    type="button"
                    aria-pressed={ativo}
                    title={f.title}
                    onClick={() => {
                      setFiltroCasos(f.id);
                      setPagina(1);
                    }}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-pilula border px-3.5 text-sm font-medium transition-colors duration-[var(--transicao-rapida)] ${
                      ativo ? "border-[color:var(--latao)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel-elevado text-tinta-suave hover:border-[color:var(--latao)] hover:text-tinta"
                    }`}
                  >
                    {f.rotulo}
                    {typeof f.total === "number" && <span className="tabular-nums text-tinta-fraca">{f.total}</span>}
                  </button>
                );
              })}
            </div>

            <div className="ms-auto flex min-w-[13rem] flex-1 items-center sm:max-w-xs">
              <label htmlFor="filtro-nome-caso" className="sr-only">
                Filtrar casos por nome da família
              </label>
              <input
                id="filtro-nome-caso"
                type="search"
                value={filtroNome}
                onChange={(e) => {
                  setFiltroNome(e.target.value);
                  setPagina(1);
                }}
                autoComplete="off"
                placeholder="Filtrar por nome…"
                className="min-h-11 w-full rounded-controle border border-linha-controle bg-papel-elevado px-3 text-sm text-tinta placeholder:text-tinta-fraca"
              />
            </div>
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
            <EstadoVazio
              compacto
              titulo={filtroNome.trim() ? `Nenhuma família com “${filtroNome.trim()}”` : "Nenhum caso neste filtro"}
              descricao="Apague o texto do filtro ou volte para “Todos” para ver as demais famílias."
            />
          </div>
        ) : (
          <ul className="divide-y divide-linha" aria-live="polite">
            {casosDaPagina.map((caso) => (
              <li key={caso.caso_id}>
                <Link
                  href={`/conhecimento/casos/${caso.caso_id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-5 py-1.5 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel focus-visible:bg-papel sm:px-6"
                >
                  {/* Uma linha por caso, de verdade: nome e quando, lado a
                      lado. Em duas linhas, dez casos custavam 580 px — mais
                      que a dobra inteira de quem trabalha a 1440×900. */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="truncate font-medium text-tinta">{nomeDoSlug(caso.rotulo)}</span>
                    <span className="truncate text-legenda text-tinta-suave">
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
        {/* Paginação. A base tem 52 casos e cresce a cada reunião transcrita:
            despejar a lista inteira fazia a aba medir ~4.900 px e o teto da
            tela passava a depender do tamanho do banco. Com página, o teto é
            constante. `aria-live` na lista anuncia a troca; o rodapé diz onde
            se está, não só para onde dá para ir. */}
        {!carregandoLista && !erroLista && casosFiltrados.length > 0 && (
          <nav aria-label="Páginas de casos" className="flex flex-wrap items-center justify-between gap-x-cartao gap-y-item border-t border-linha px-5 py-2 sm:px-6">
            <p className="text-legenda text-tinta-suave">
              {inicio + 1}–{Math.min(inicio + CASOS_POR_PAGINA, casosFiltrados.length)} de {casosFiltrados.length} {casosFiltrados.length === 1 ? "caso" : "casos"}
              {totalPaginas > 1 ? ` · página ${paginaAtual} de ${totalPaginas}` : ""}
            </p>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-item">
                <Botao variante="secundario" tamanho="compacto" onClick={() => setPagina(paginaAtual - 1)} disabled={paginaAtual <= 1}>
                  Anterior
                </Botao>
                <Botao variante="secundario" tamanho="compacto" onClick={() => setPagina(paginaAtual + 1)} disabled={paginaAtual >= totalPaginas}>
                  Próxima
                </Botao>
              </div>
            )}
          </nav>
        )}
      </Cartao>
    </div>
  );
}
