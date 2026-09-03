"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useEquipe, useEtapasOrdem, useJornadas } from "@/hooks/useJornadas";
import { atualizarEtapa, ApiError, listarJornadas, type EtapaJornada, type FiltrosJornadas, type JornadaKanban } from "@/lib/api";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { CartaoJornada } from "./CartaoJornada";
import { FiltrosEsteira, type OpcaoEdicao } from "./FiltrosEsteira";

export function KanbanEsteira() {
  const [filtrosDigitados, setFiltrosDigitados] = useState<FiltrosJornadas>({});
  const [mostrarFechadas, setMostrarFechadas] = useState(false);
  const buscaDebatida = useDebounce(filtrosDigitados.busca, 350);
  const filtros = useMemo<FiltrosJornadas>(
    () => ({ ...filtrosDigitados, busca: buscaDebatida, incluir_fechadas: mostrarFechadas }),
    [filtrosDigitados, buscaDebatida, mostrarFechadas],
  );

  const { etapas, carregando: carregandoEtapas, erro: erroEtapas, recarregar: recarregarEtapas } = useEtapasOrdem();
  const equipe = useEquipe();
  const { itens, carregando: carregandoJornadas, erro: erroJornadas, recarregar: recarregarJornadas, setItens } = useJornadas(filtros);

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

  const [idArrastando, setIdArrastando] = useState<string | null>(null);
  const [idEmMovimento, setIdEmMovimento] = useState<string | null>(null);
  const [erroMovimento, setErroMovimento] = useState<{ jornadaId: string; mensagem: string } | null>(null);

  // A esteira tem mais colunas do que cabem em 1440px — a trilha rola na horizontal,
  // isolada do body, e os degradês nas bordas avisam que há mais coluna fora da vista.
  const trilhaRef = useRef<HTMLDivElement>(null);
  const [podeRolarEsquerda, setPodeRolarEsquerda] = useState(false);
  const [podeRolarDireita, setPodeRolarDireita] = useState(false);

  function atualizarSombrasDeRolagem() {
    const el = trilhaRef.current;
    if (!el) return;
    setPodeRolarEsquerda(el.scrollLeft > 1);
    setPodeRolarDireita(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, etapas]);

  async function moverJornada(jornada: JornadaKanban, etapaDestino: EtapaJornada) {
    if (etapaDestino === jornada.etapa) return;
    setErroMovimento(null);
    setIdEmMovimento(jornada.id);
    // Move visualmente para dar feedback imediato, mas o estado só se confirma com o servidor.
    setItens((atual) => atual.map((j) => (j.id === jornada.id ? { ...j, etapa: etapaDestino } : j)));
    try {
      await atualizarEtapa(jornada.id, { etapa: etapaDestino });
      recarregarJornadas();
    } catch (erro) {
      // Servidor recusou (ex.: 409 transicao_invalida) — o card volta ao lugar, com o motivo escrito.
      setItens((atual) => atual.map((j) => (j.id === jornada.id ? { ...j, etapa: jornada.etapa } : j)));
      const mensagem = erro instanceof ApiError ? erro.message : "Não foi possível mover o card. Tente de novo.";
      setErroMovimento({ jornadaId: jornada.id, mensagem });
    } finally {
      setIdEmMovimento(null);
    }
  }

  if (carregandoEtapas) return <EstadoCarregando rotulo="Carregando as colunas da esteira…" />;
  if (erroEtapas) return <EstadoErro erro={erroEtapas} tentarNovamente={recarregarEtapas} titulo="Não foi possível carregar as colunas da esteira" />;
  if (!etapas || etapas.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma etapa cadastrada"
        descricao="A esteira depende da tabela etapas_jornada_ordem. Sem linhas lá, não há coluna para desenhar — e é assim mesmo: nenhuma coluna é inventada na tela."
      />
    );
  }

  const etapasOrdenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-tinta">Esteira</h1>
        <p className="text-sm text-tinta-suave">Do seminário à holding contratada — cada card é uma jornada.</p>
      </div>

      <FiltrosEsteira
        filtros={filtrosDigitados}
        aoMudar={(parcial) => setFiltrosDigitados((atual) => ({ ...atual, ...parcial }))}
        opcoesEdicoes={opcoesEdicoes}
        equipe={equipe}
        mostrarFechadas={mostrarFechadas}
        aoAlternarFechadas={setMostrarFechadas}
      />

      {erroMovimento && (
        <div role="alert" className="rounded-sm border border-vermelho bg-vermelho-fraco px-3 py-2 text-sm text-[color:var(--vermelho)]">
          O card não pôde ser movido: {erroMovimento.mensagem}
        </div>
      )}

      {erroJornadas ? <EstadoErro erro={erroJornadas} tentarNovamente={recarregarJornadas} /> : null}

      {carregandoJornadas && itens.length === 0 && !erroJornadas && <EstadoCarregando rotulo="Carregando jornadas…" />}

      {!carregandoJornadas && !erroJornadas && itens.length === 0 && (
        <EstadoVazio titulo="Nenhuma jornada encontrada" descricao="Ajuste os filtros ou verifique se já há captação nesta edição." />
      )}

      {itens.length > 0 && (
        <div className="relative">
          <div
            ref={trilhaRef}
            onScroll={atualizarSombrasDeRolagem}
            tabIndex={0}
            role="group"
            aria-label="Colunas da esteira. Use as setas do teclado ou os botões ao lado para rolar na horizontal."
            className="trilha-esteira flex gap-4 overflow-x-auto pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao)]"
          >
            {etapasOrdenadas.map((etapa) => {
              const cartoes = itens.filter((j) => j.etapa === etapa.etapa);
              return (
                <div
                  key={etapa.etapa}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const jornada = itens.find((j) => j.id === idArrastando);
                    setIdArrastando(null);
                    if (jornada) moverJornada(jornada, etapa.etapa);
                  }}
                  className="flex w-72 shrink-0 flex-col gap-3 rounded-sm border border-linha bg-papel-fundo/60 p-2"
                >
                  <div className="flex items-baseline justify-between px-1.5 pt-1">
                    <h2 className="font-serif text-sm font-semibold text-tinta">{etapa.rotulo}</h2>
                    <span className="font-mono text-xs text-tinta-fraca">{cartoes.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 min-h-[80px]">
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
                </div>
              );
            })}
          </div>

          {/* Degradês + botões: avisam e permitem rolar quando há coluna fora da vista. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-papel-fundo to-transparent transition-opacity duration-150 ${
              podeRolarEsquerda ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-papel-fundo to-transparent transition-opacity duration-150 ${
              podeRolarDireita ? "opacity-100" : "opacity-0"
            }`}
          />
          {podeRolarEsquerda && (
            <button
              type="button"
              onClick={() => rolarTrilha(-1)}
              aria-label="Rolar colunas para a esquerda"
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-linha-forte bg-papel-elevado p-1.5 text-tinta shadow-[var(--sombra-cartao)] hover:border-latao hover:text-latao"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                <path d="M12.7 15.3a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 1 1 1.4 1.4L8.42 9.6l4.3 4.3a1 1 0 0 1 0 1.4Z" />
              </svg>
            </button>
          )}
          {podeRolarDireita && (
            <button
              type="button"
              onClick={() => rolarTrilha(1)}
              aria-label="Rolar colunas para a direita"
              className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-linha-forte bg-papel-elevado p-1.5 text-tinta shadow-[var(--sombra-cartao)] hover:border-latao hover:text-latao"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                <path d="M7.3 4.7a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4Z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
