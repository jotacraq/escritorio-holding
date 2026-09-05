"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useEquipe, useEtapasOrdem, useJornadas } from "@/hooks/useJornadas";
import { useToast } from "@/hooks/useToast";
import { atualizarEtapa, ApiError, listarJornadas, type EtapaJornada, type EtapaOrdem, type FiltrosJornadas, type JornadaKanban } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { CartaoJornada } from "./CartaoJornada";
import { FiltrosEsteira, haFiltroAtivo, type OpcaoEdicao } from "./FiltrosEsteira";
import { ListaPorEtapa } from "./ListaPorEtapa";
import { CHAVE_VISAO_ESTEIRA, corDaEtapa, type VisaoEsteira } from "./etapas";
import { rotulo, rotuloDeEtapa, titleDe } from "@/lib/vocabulario";

const ICONE_QUADRO = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h3A1.5 1.5 0 0 1 9 4.5v11A1.5 1.5 0 0 1 7.5 17h-3A1.5 1.5 0 0 1 3 15.5v-11Zm8 0A1.5 1.5 0 0 1 12.5 3h3A1.5 1.5 0 0 1 17 4.5v6a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 11 10.5v-6Z" />
  </svg>
);
const ICONE_LISTA = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
    <path d="M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H4Z" />
  </svg>
);

/**
 * Esteira — do seminário à holding. Duas visões da mesma lista, sem fetch a
 * mais: o QUADRO (8 colunas; as vazias colapsam numa faixa estreita com
 * contagem, para o que importa caber na tela) e a LISTA POR ETAPA (cartões
 * empilhados — o caminho natural no celular e para quem não gosta de rolar
 * de lado). A faixa "resumo por etapa" responde "quantas pessoas em cada
 * etapa, agora?" e leva ao lugar certo com um clique.
 *
 * Mover de etapa: otimista (o cartão troca de coluna na hora), toast com
 * "Desfazer", e volta ao lugar com o motivo se o servidor recusar.
 */
export function KanbanEsteira() {
  const { notificar } = useToast();
  const [filtrosDigitados, setFiltrosDigitados] = useState<FiltrosJornadas>({});
  const [mostrarFechadas, setMostrarFechadas] = useState(false);
  const buscaDebatida = useDebounce(filtrosDigitados.busca, 350);
  const filtros = useMemo<FiltrosJornadas>(
    () => ({
      ...filtrosDigitados,
      busca: buscaDebatida,
      incluir_fechadas: mostrarFechadas,
    }),
    [filtrosDigitados, buscaDebatida, mostrarFechadas],
  );

  const { etapas, carregando: carregandoEtapas, erro: erroEtapas, recarregar: recarregarEtapas } = useEtapasOrdem();
  const equipe = useEquipe();
  const { itens, total, carregando: carregandoJornadas, erro: erroJornadas, recarregar: recarregarJornadas, setItens } = useJornadas(filtros);

  const [opcoesEdicoes, setOpcoesEdicoes] = useState<OpcaoEdicao[]>([]);
  useEffect(() => {
    // Uma única chamada, sem filtro de edição, só para popular o seletor de edições existentes.
    listarJornadas({ incluir_fechadas: true })
      .then((dados) => {
        const mapa = new Map<string, string>();
        for (const j of dados.itens) {
          if (j.edicao_id && j.edicao_codigo) mapa.set(j.edicao_id, j.edicao_codigo);
        }
        setOpcoesEdicoes(Array.from(mapa, ([id, codigo]) => ({ id, codigo })).sort((a, b) => b.codigo.localeCompare(a.codigo)));
      })
      .catch(() => setOpcoesEdicoes([]));
  }, []);

  // Visão: preferência de tela, guardada no navegador. No celular, a lista é o padrão.
  const [visao, setVisao] = useState<VisaoEsteira>("quadro");
  useEffect(() => {
    // Leitura do navegador após montar (mesmo padrão de `useTema`): evita mismatch de hidratação.
    const salva = window.localStorage.getItem(CHAVE_VISAO_ESTEIRA);
    if (salva === "quadro" || salva === "lista") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisao(salva);
    } else if (window.matchMedia("(max-width: 767px)").matches) {
      setVisao("lista");
    }
  }, []);
  function escolherVisao(nova: VisaoEsteira) {
    setVisao(nova);
    window.localStorage.setItem(CHAVE_VISAO_ESTEIRA, nova);
  }

  // Colunas colapsadas: por padrão as vazias; a pessoa pode abrir/fechar qualquer uma.
  const [colapsoManual, setColapsoManual] = useState<Partial<Record<EtapaJornada, boolean>>>({});
  const colunaColapsada = useCallback((etapa: EtapaJornada, quantidade: number) => colapsoManual[etapa] ?? quantidade === 0, [colapsoManual]);
  function alternarColuna(etapa: EtapaJornada, quantidade: number) {
    setColapsoManual((atual) => ({
      ...atual,
      [etapa]: !colunaColapsada(etapa, quantidade),
    }));
  }

  const [idArrastando, setIdArrastando] = useState<string | null>(null);
  const [idEmMovimento, setIdEmMovimento] = useState<string | null>(null);

  const trilhaRef = useRef<HTMLDivElement>(null);
  const [podeRolarEsquerda, setPodeRolarEsquerda] = useState(false);
  const [podeRolarDireita, setPodeRolarDireita] = useState(false);

  const atualizarSombrasDeRolagem = useCallback(() => {
    const el = trilhaRef.current;
    if (!el) return;
    setPodeRolarEsquerda(el.scrollLeft > 1);
    setPodeRolarDireita(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  function rolarTrilha(direcao: 1 | -1) {
    trilhaRef.current?.scrollBy({ left: direcao * 320, behavior: "smooth" });
  }

  useEffect(() => {
    atualizarSombrasDeRolagem();
    const el = trilhaRef.current;
    if (!el) return;
    const observador = new ResizeObserver(atualizarSombrasDeRolagem);
    observador.observe(el);
    window.addEventListener("resize", atualizarSombrasDeRolagem);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", atualizarSombrasDeRolagem);
    };
  }, [itens, etapas, visao, colapsoManual, atualizarSombrasDeRolagem]);

  /**
   * O rótulo da coluna vem de `etapas_jornada_ordem.rotulo`, no banco — e uma
   * das linhas do seed é **"Qualificado (MQL)"**. Sigla dentro do fluxo é o que
   * o §9.2 proíbe, e o banco não muda por causa de tela (o mesmo rótulo
   * alimenta API e relatório). Então a tradução acontece na leitura, por
   * `rotuloDeEtapa()` (dicionário único): a sigla sai do texto e vai para o
   * `title` da coluna e do chip de resumo. Rótulo que o dicionário não conhece
   * passa intacto.
   */
  const etapasOrdenadas = useMemo(
    () =>
      (etapas ? [...etapas].sort((a, b) => a.ordem - b.ordem) : []).map((etapa) => ({
        ...etapa,
        ...rotuloDeEtapa(etapa.rotulo),
      })),
    [etapas],
  );
  const contagemPorEtapa = useMemo(() => {
    const mapa = new Map<EtapaJornada, number>();
    for (const j of itens) mapa.set(j.etapa, (mapa.get(j.etapa) ?? 0) + 1);
    return mapa;
  }, [itens]);

  function irParaEtapa(etapa: EtapaOrdem) {
    if (visao === "quadro") {
      setColapsoManual((atual) => ({ ...atual, [etapa.etapa]: false }));
      window.setTimeout(() => {
        document.getElementById(`coluna-${etapa.etapa}`)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }, 50);
    } else {
      document.getElementById(`etapa-${etapa.etapa}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function moverJornada(jornada: JornadaKanban, etapaDestino: EtapaJornada, ehDesfazer = false) {
    if (etapaDestino === jornada.etapa) return;
    const etapaAnterior = jornada.etapa;
    const rotuloDestino = etapasOrdenadas.find((e) => e.etapa === etapaDestino)?.rotulo ?? etapaDestino;
    setIdEmMovimento(jornada.id);
    // Otimista: troca de coluna na hora; o estado só se confirma com o servidor.
    setItens((atual) => atual.map((j) => (j.id === jornada.id ? { ...j, etapa: etapaDestino } : j)));
    try {
      const { jornada: atualizada } = await atualizarEtapa(jornada.id, {
        etapa: etapaDestino,
      });
      setItens((atual) => atual.map((j) => (j.id === jornada.id ? { ...j, ...atualizada } : j)));
      notificar({
        tom: "sucesso",
        titulo: ehDesfazer ? "Movimento desfeito" : `Movido para ${rotuloDestino}`,
        descricao: jornada.nome,
        acao: ehDesfazer
          ? undefined
          : {
              rotulo: "Desfazer",
              aoClicar: () => moverJornada({ ...jornada, etapa: etapaDestino }, etapaAnterior, true),
            },
      });
    } catch (erro) {
      // Servidor recusou (ex.: 409 transicao_invalida) — o cartão volta ao lugar, com o motivo escrito.
      setItens((atual) => atual.map((j) => (j.id === jornada.id ? { ...j, etapa: etapaAnterior } : j)));
      notificar({
        tom: "erro",
        titulo: `Não foi possível mover ${jornada.nome}`,
        descricao: erro instanceof ApiError ? erro.message : "Confira a internet e tente de novo.",
      });
    } finally {
      setIdEmMovimento(null);
    }
  }

  const filtroAtivo = haFiltroAtivo(filtrosDigitados, mostrarFechadas);
  function limparFiltros() {
    setFiltrosDigitados({});
    setMostrarFechadas(false);
  }

  const alternadorVisao = (
    <div role="group" aria-label="Como ver" className="inline-flex rounded-controle border border-linha-controle bg-papel-elevado p-0.5">
      {(
        [
          ["quadro", "Quadro", ICONE_QUADRO],
          ["lista", "Lista por etapa", ICONE_LISTA],
        ] as const
      ).map(([valor, rotulo, icone]) => (
        <button
          key={valor}
          type="button"
          aria-pressed={visao === valor}
          onClick={() => escolherVisao(valor)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-[calc(var(--raio-controle)-2px)] px-3.5 text-sm font-medium transition-colors duration-[var(--transicao-rapida)] ${
            visao === valor ? "bg-latao-fraco text-tinta" : "text-tinta-suave hover:text-tinta"
          }`}
        >
          {icone}
          {rotulo}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo={<span title={titleDe("esteira")}>{rotulo("esteira")}</span>}
        acoes={alternadorVisao}
        meta={
          !carregandoJornadas && !erroJornadas ? (
            <span>
              {total} {total === 1 ? "jornada" : "jornadas"}
              {filtroAtivo ? " com os filtros atuais" : mostrarFechadas ? " (abertas e fechadas)" : " abertas"}
            </span>
          ) : undefined
        }
      />

      <FiltrosEsteira
        filtros={filtrosDigitados}
        aoMudar={(parcial) => setFiltrosDigitados((atual) => ({ ...atual, ...parcial }))}
        aoLimpar={limparFiltros}
        opcoesEdicoes={opcoesEdicoes}
        equipe={equipe}
        mostrarFechadas={mostrarFechadas}
        aoAlternarFechadas={setMostrarFechadas}
      />

      {carregandoEtapas && <EsqueletoCartao quantidade={6} rotulo="Carregando as colunas…" />}
      {Boolean(erroEtapas) && <EstadoErro erro={erroEtapas} tentarNovamente={recarregarEtapas} titulo="Não foi possível carregar as colunas" />}
      {!carregandoEtapas && !erroEtapas && etapasOrdenadas.length === 0 && (
        <EstadoVazio ilustracao="lista" titulo="Nenhuma etapa cadastrada" />
      )}

      {etapasOrdenadas.length > 0 && (
        <>
          {/* Resumo por etapa — "quantas pessoas em cada etapa, agora?" + atalho para a coluna/seção. */}
          <nav aria-label="Resumo por etapa" className="flex flex-wrap gap-2">
            {etapasOrdenadas.map((etapa) => {
              const quantidade = contagemPorEtapa.get(etapa.etapa) ?? 0;
              return (
                <button
                  key={etapa.etapa}
                  type="button"
                  onClick={() => irParaEtapa(etapa)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pilula border border-linha-forte bg-papel-elevado px-3.5 text-sm text-tinta transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:shadow-cartao"
                >
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corDaEtapa(etapa.cor) }} />
                  <span className="font-medium" title={etapa.title}>{etapa.rotulo}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-legenda font-bold tabular-nums ${quantidade > 0 ? "bg-latao-fraco text-tinta" : "bg-papel text-tinta-fraca"}`}
                  >
                    {quantidade}
                  </span>
                </button>
              );
            })}
          </nav>

          {erroJornadas ? <EstadoErro erro={erroJornadas} tentarNovamente={recarregarJornadas} titulo="Não foi possível carregar as jornadas" /> : null}

          {carregandoJornadas && itens.length === 0 && !erroJornadas && <EsqueletoCartao quantidade={6} rotulo="Carregando jornadas…" />}

          {!carregandoJornadas && !erroJornadas && itens.length === 0 && (
            <EstadoVazio
              ilustracao="busca"
              titulo="Nenhuma jornada encontrada"
              descricao={
                filtroAtivo
                  ? "Nenhuma pessoa bate com estes filtros."
                  : "Ainda não há captação registrada. As jornadas entram pela importação da planilha do seminário ou pelo pagamento na Hotmart."
              }
              acao={
                filtroAtivo ? (
                  <Botao variante="primario" onClick={limparFiltros}>
                    Limpar filtros
                  </Botao>
                ) : undefined
              }
            />
          )}

          {itens.length > 0 && visao === "lista" && (
            <ListaPorEtapa etapas={etapasOrdenadas} itens={itens} idEmMovimento={idEmMovimento} aoMover={moverJornada} />
          )}

          {itens.length > 0 && visao === "quadro" && (
            <div className="relative">
              <div
                ref={trilhaRef}
                onScroll={atualizarSombrasDeRolagem}
                tabIndex={0}
                role="group"
                aria-label="Colunas. Use as setas do teclado ou os botões ao lado para rolar na horizontal."
                className="trilha-esteira relative flex gap-4 overflow-x-auto pb-4"
              >
                {etapasOrdenadas.map((etapa) => {
                  const cartoes = itens.filter((j) => j.etapa === etapa.etapa);
                  const colapsada = colunaColapsada(etapa.etapa, cartoes.length);
                  const idColuna = `coluna-${etapa.etapa}`;
                  const idTitulo = `${idColuna}-titulo`;
                  return (
                    <section
                      key={etapa.etapa}
                      id={idColuna}
                      aria-labelledby={idTitulo}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const jornada = itens.find((j) => j.id === idArrastando);
                        setIdArrastando(null);
                        if (jornada) moverJornada(jornada, etapa.etapa);
                      }}
                      className={`flex shrink-0 flex-col rounded-cartao border border-linha bg-papel transition-[width] duration-[var(--transicao-normal)] ease-[var(--suavizacao)] ${
                        colapsada ? "w-14" : "w-80"
                      }`}
                      style={{
                        borderTopColor: corDaEtapa(etapa.cor),
                        borderTopWidth: 4,
                      }}
                    >
                      {colapsada ? (
                        <button
                          type="button"
                          onClick={() => alternarColuna(etapa.etapa, cartoes.length)}
                          aria-expanded={false}
                          aria-controls={`${idColuna}-cartoes`}
                          className="flex min-h-[220px] flex-1 flex-col items-center gap-3 px-2 py-4 text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:bg-papel-elevado hover:text-tinta"
                        >
                          <span
                            className={`rounded-full px-2 py-0.5 text-legenda font-bold tabular-nums ${cartoes.length > 0 ? "bg-latao-fraco text-tinta" : "bg-papel-elevado text-tinta-fraca"}`}
                          >
                            {cartoes.length}
                          </span>
                          <span id={idTitulo} className="text-sm font-bold [writing-mode:vertical-rl]" title={etapa.title}>
                            {etapa.rotulo}
                          </span>
                          <span className="sr-only">— abrir coluna</span>
                        </button>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2 px-3 pt-3">
                            <h2 id={idTitulo} className="flex items-center gap-2 text-sm font-bold text-tinta" title={etapa.title}>
                              {etapa.rotulo}
                              <span
                                className={`rounded-full px-2 py-0.5 text-legenda font-bold tabular-nums ${cartoes.length > 0 ? "bg-latao-fraco" : "bg-papel-elevado text-tinta-fraca"}`}
                              >
                                {cartoes.length}
                              </span>
                            </h2>
                            <button
                              type="button"
                              onClick={() => alternarColuna(etapa.etapa, cartoes.length)}
                              aria-expanded
                              aria-controls={`${idColuna}-cartoes`}
                              className="grid h-11 w-11 place-items-center rounded-controle text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:bg-papel-elevado hover:text-tinta"
                            >
                              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                                <path d="M12.7 15.3a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 1 1 1.4 1.4L8.42 9.6l4.3 4.3a1 1 0 0 1 0 1.4Z" />
                              </svg>
                              <span className="sr-only">Recolher a coluna {etapa.rotulo}</span>
                            </button>
                          </div>
                          <div id={`${idColuna}-cartoes`} className="flex min-h-[120px] flex-col gap-3 p-3">
                            {cartoes.length === 0 && <EstadoVazio compacto titulo="Nenhuma jornada aqui" descricao="Arraste um cartão ou use “Mover”." />}
                            {cartoes.map((jornada) => (
                              <CartaoJornada
                                key={jornada.id}
                                jornada={jornada}
                                etapas={etapasOrdenadas}
                                arrastando={idArrastando === jornada.id}
                                emMovimento={idEmMovimento === jornada.id}
                                aoIniciarArrasto={(e) => {
                                  setIdArrastando(jornada.id);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                aoMoverParaEtapa={(destino) => moverJornada(jornada, destino)}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </section>
                  );
                })}
              </div>

              {/* Degradês + botões: avisam e permitem rolar quando há coluna fora da vista. */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-papel-fundo to-transparent transition-opacity duration-[var(--transicao-rapida)] ${podeRolarEsquerda ? "opacity-100" : "opacity-0"}`}
              />
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-papel-fundo to-transparent transition-opacity duration-[var(--transicao-rapida)] ${podeRolarDireita ? "opacity-100" : "opacity-0"}`}
              />
              {podeRolarEsquerda && (
                <button
                  type="button"
                  onClick={() => rolarTrilha(-1)}
                  aria-label="Rolar colunas para a esquerda"
                  className="absolute left-1 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-linha-forte bg-papel-elevado text-tinta shadow-flutuante transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
                    <path d="M12.7 15.3a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 1 1 1.4 1.4L8.42 9.6l4.3 4.3a1 1 0 0 1 0 1.4Z" />
                  </svg>
                </button>
              )}
              {podeRolarDireita && (
                <button
                  type="button"
                  onClick={() => rolarTrilha(1)}
                  aria-label="Rolar colunas para a direita"
                  className="absolute right-1 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-linha-forte bg-papel-elevado text-tinta shadow-flutuante transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
                    <path d="M7.3 4.7a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4Z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
