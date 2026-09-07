"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EsqueletoCartao, EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { TourPrimeiraVez } from "@/components/onboarding/TourPrimeiraVez";
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual";
import { formatarDataHora } from "@/lib/formatar";
import { classificarPrazo } from "@/lib/estados/catalogo";
import type { EstadoBloco, PainelDiaNormalizado } from "@/types/painel-ui";
import type { PapelEquipe } from "@/types/banco";
import { usePainelDia } from "./usePainelDia";
import { blocosDoPapel, type ChaveBlocoPainel } from "./blocosPorPapel";
import { SessoesHoje } from "./SessoesHoje";
import { PreparoPendente } from "./PreparoPendente";
import { PagosSemContato } from "./PagosSemContato";
import { Travado, pendenciasVisiveis } from "./Travado";
import { ProvaDeVida } from "./ProvaDeVida";
import { PrazosDoDia, haPrazoUrgente } from "./PrazosDoDia";
import { ComprasTravadas } from "./ComprasTravadas";
import { ResumoDoDia, type ItemResumo } from "./ResumoDoDia";
import { TudoCerto, type BlocoTranquilo } from "./TudoCerto";
import { useComprasDosProcessos, usePrazosAbertos, type CompraDoProcesso, type Fonte, type PrazoAberto } from "./dadosDeUrgencia";

/**
 * A aba "Números" não entra na carga da aba "O dia" (DS §11, regra 1).
 *
 * `IndicadoresApp` (256 linhas + `FunilEtapas`) e `NumerosSemana` só existem
 * dentro da segunda aba, e `ui/Abas` monta apenas o painel ativo — então o
 * `dynamic()` só busca o módulo quando alguém clica em "Números". Quem abre
 * `/hoje` para saber o que fazer hoje não paga pelo funil por coorte.
 *
 * `next/dynamic` exige **objeto literal** nas opções: fatorar o `{ loading }`
 * numa função quebra a compilação e o `tsc` não pega (DS §11, regra 1).
 */
const IndicadoresApp = dynamic(() => import("@/components/indicadores/IndicadoresApp").then((m) => m.IndicadoresApp), {
  loading: () => <EsqueletoCartao quantidade={3} rotulo="Abrindo os números…" />,
});
const NumerosSemana = dynamic(() => import("./NumerosSemana").then((m) => m.NumerosSemana), {
  loading: () => <EsqueletoLista linhas={4} rotulo="Abrindo o resumo da semana…" />,
});

const FORMATADOR_DATA_TITULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const ICONE_ATUALIZAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5" />
  </svg>
);
const ICONE_AJUDA = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-2-8.5a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M10 14.5h.01" />
  </svg>
);

/**
 * "sábado, 05 de setembro" → "Sábado, 05 de setembro". `capitalize` do CSS
 * subiria também o "De" do meio, o que a Neuetra bold deixa feio no display.
 */
function comMaiusculaInicial(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Enquanto o papel não carregou, valem só os blocos que **todo** papel vê.
 * É o oposto de "mostra tudo e esconde depois": bloco de sistema nunca
 * chega ao DOM de quem não é admin, nem por um quadro de render.
 */
const BLOCOS_ENQUANTO_CARREGA: ChaveBlocoPainel[] = ["sessoes_hoje", "preparo"];

/** Meia-noite de hoje e de amanhã, no fuso local — a régua de "é hoje?". */
function limitesDoDia(agora: Date) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const amanha = new Date(hoje.getTime() + 86_400_000);
  return { hoje, amanha, depoisDeAmanha: new Date(hoje.getTime() + 2 * 86_400_000) };
}

function itensDe<T>(estado: EstadoBloco<T>): T[] {
  return estado.situacao === "ok" ? estado.itens : [];
}

/** `Fonte` (3 estados) → `EstadoBloco` (2). "ausente" nunca chega aqui: o bloco não é renderizado. */
function comoBloco<T>(fonte: Fonte<T>): EstadoBloco<T> {
  return fonte.situacao === "ok" ? { situacao: "ok", itens: fonte.itens } : { situacao: "indisponivel" };
}

/**
 * Painel do dia — a primeira tela que a Dra. Elaine vê.
 *
 * ## Fase 8: a fila deixou de ter ordem fixa
 *
 * Até a Fase 7 os blocos apareciam sempre na mesma sequência, e um bloco vazio
 * ocupava o mesmo lugar de um bloco cheio. Quem abria a tela num dia
 * movimentado via, na dobra, quatro cartões — e o que exigia ação podia estar
 * no quarto. Agora a tela responde à pergunta do João ("o que precisa de mim
 * AGORA?") em três faixas nomeadas:
 *
 *   1. **Precisa de você agora** — dinheiro que entrou sem contato, compra que
 *      travou, prazo vencido ou vencendo hoje, sessão de hoje, preparo de
 *      amanhã, sessão sem sala.
 *   2. **Ainda esta semana** — o mesmo trabalho, com folga.
 *   3. **Sem pendência** — uma linha só para tudo que está em dia.
 *
 * A urgência é **derivada do dado** (data da sessão, classe do prazo, se a
 * compra foi revertida), nunca uma ordem escrita à mão. Nenhum bloco sumiu,
 * nenhum papel passou a ver o que não via: o gate de `blocosDoPapel` continua
 * decidindo o que existe antes de a urgência decidir onde fica.
 *
 * Sem polling: uma busca ao montar e uma sob clique em "Atualizar" — inclusive
 * para os prazos e as compras (`dadosDeUrgencia.ts`). O egress do Supabase é da
 * organização inteira.
 *
 * "Atualizado em" usa `gerado_em` — o instante que o servidor calculou o
 * painel, não o relógio do navegador.
 */
export function PainelDia() {
  const { dados, carregando, erro, recarregar } = usePainelDia();
  const { usuario, carregando: carregandoUsuario } = useUsuarioAtual();
  const semNenhumaCargaAinda = !dados;
  const [versao, setVersao] = useState(0);
  const [tourAberto, setTourAberto] = useState(false);

  const papel = usuario?.papel ?? null;
  const ehAdmin = papel === "admin";
  const blocos = useMemo(
    () => new Set<ChaveBlocoPainel>(carregandoUsuario ? BLOCOS_ENQUANTO_CARREGA : blocosDoPapel(papel)),
    [carregandoUsuario, papel],
  );
  const ve = useCallback((b: ChaveBlocoPainel) => blocos.has(b), [blocos]);

  // Prazos e compras travadas não vêm de `/api/painel` (ver `dadosDeUrgencia.ts`).
  const { fonte: fontePrazos } = usePrazosAbertos(versao);
  const { fonte: fonteCompras } = useComprasDosProcessos({ somenteTravadas: true, comNomes: true }, versao);

  const atualizar = useCallback(() => {
    recarregar();
    setVersao((v) => v + 1);
  }, [recarregar]);

  /**
   * Fase 6 — "Indicadores" deixou de ser entrada de menu e virou a aba
   * "Números" de Hoje (`/hoje#numeros`). O acesso NÃO mudou: continua sendo
   * de todo papel interno, como era em `/indicadores`.
   */
  const abas: DefinicaoAba[] = [
    {
      id: "dia",
      rotulo: "O dia",
      descricao: "O que precisa de você agora, na ordem em que atrasa.",
      conteudo: (
        <ConteudoDoDia
          dados={dados}
          carregando={carregando}
          erro={erro}
          atualizar={atualizar}
          ve={ve}
          ehAdmin={ehAdmin}
          papel={papel}
          versao={versao}
          fontePrazos={fontePrazos}
          fonteCompras={fonteCompras}
        />
      ),
    },
    {
      id: "numeros",
      rotulo: "Números",
      // "Funil" saiu do texto visível (§B3): a palavra do ofício é conversão, e
      // "pipeline/funil/deal" não descreve o caminho de um cliente nesta casa.
      // O método continua sendo o mesmo — a leitura é por COORTE.
      descricao: "A conversão por coorte: cada pessoa conta na edição do seminário de onde veio, mesmo que a sessão aconteça meses depois.",
      conteudo: (
        <div className="flex flex-col gap-bloco">
          {ve("numeros") && dados && <NumerosSemana estado={dados.indicadoresSemana} aoTentarDeNovo={atualizar} />}
          <IndicadoresApp />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-bloco">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo={comMaiusculaInicial(FORMATADOR_DATA_TITULO.format(new Date()))}
        acoes={
          <>
            <Botao variante="fantasma" icone={ICONE_AJUDA} onClick={() => setTourAberto(true)}>
              Como funciona
            </Botao>
            <Botao variante="secundario" icone={ICONE_ATUALIZAR} onClick={atualizar} carregando={carregando}>
              Atualizar
            </Botao>
          </>
        }
        meta={
          <>
            {dados?.geradoEm && <span>Atualizado em {formatarDataHora(dados.geradoEm)}</span>}
            {Boolean(erro) && !semNenhumaCargaAinda && (
              <span role="alert" className="text-[color:var(--estado-vermelho)]">
                Não atualizou — mostrando a última carga.
              </span>
            )}
          </>
        }
      />

      <Abas abas={abas} abaInicial="dia" deepLinkHash semMoldura />

      <TourPrimeiraVez forcarAbrir={tourAberto} aoFechar={() => setTourAberto(false)} />
    </div>
  );
}

interface ConteudoDoDiaProps {
  dados: PainelDiaNormalizado | null | undefined;
  carregando: boolean;
  erro: unknown;
  atualizar: () => void;
  ve: (b: ChaveBlocoPainel) => boolean;
  ehAdmin: boolean;
  papel: PapelEquipe | null;
  versao: number;
  fontePrazos: Fonte<PrazoAberto>;
  fonteCompras: Fonte<CompraDoProcesso>;
}

/** Um bloco da fila, já classificado. `render` só é chamado quando há trabalho. */
interface BlocoDoDia {
  id: string;
  titulo: string;
  dica: string;
  /** Prioridade dentro da faixa — dinheiro e prazo antes de agenda. */
  ordem: number;
  /** `true` = precisa de atenção hoje; `false` = ainda esta semana. */
  agora: boolean;
  /** `vazio` entra na linha "Sem pendência"; `oculto` não existe para este papel/banco. */
  situacao: "trabalho" | "vazio" | "falha" | "oculto";
  render: () => ReactNode;
}

/** O conteúdo da aba "O dia" — a fila de trabalho, sem `h1` próprio. */
function ConteudoDoDia({
  dados,
  carregando,
  erro,
  atualizar,
  ve,
  ehAdmin,
  papel,
  versao,
  fontePrazos,
  fonteCompras,
}: ConteudoDoDiaProps) {
  const semNenhumaCargaAinda = !dados;
  // `versao` muda a cada clique em "Atualizar": é ele que manda reler o
  // relógio. Sem uma referência estável, "vence hoje" seria recalculado a cada
  // render e o `useMemo` da fila nunca serviria de nada.
  const agora = useMemo(() => {
    void versao;
    return new Date();
  }, [versao]);

  const fila = useMemo<BlocoDoDia[]>(() => {
    if (!dados) return [];
    const { amanha, depoisDeAmanha } = limitesDoDia(agora);

    const sessoes = itensDe(dados.sessoesDoDia);
    const preparo = itensDe(dados.pendenciasPreparo);
    const pagos = itensDe(dados.pagosSemContato);
    const travados = dados.pendenciasSistema.situacao === "ok" ? pendenciasVisiveis(dados.pendenciasSistema.itens, papel) : [];
    const travadosBloco: EstadoBloco<(typeof travados)[number]> =
      dados.pendenciasSistema.situacao === "ok" ? { situacao: "ok", itens: travados } : { situacao: "indisponivel" };
    const prazos = fontePrazos.situacao === "ok" ? fontePrazos.itens : [];
    const compras = fonteCompras.situacao === "ok" ? fonteCompras.itens : [];

    function situacaoDe<T>(visivel: boolean, estado: EstadoBloco<T>): BlocoDoDia["situacao"] {
      if (!visivel) return "oculto";
      if (estado.situacao !== "ok") return "falha";
      return estado.itens.length === 0 ? "vazio" : "trabalho";
    }
    function situacaoDaFonte<T>(visivel: boolean, fonte: Fonte<T>): BlocoDoDia["situacao"] {
      if (!visivel || fonte.situacao === "ausente") return "oculto";
      if (fonte.situacao !== "ok") return "falha";
      return fonte.itens.length === 0 ? "vazio" : "trabalho";
    }

    return [
      {
        id: "pagos-sem-contato",
        titulo: "Pagou, sem contato",
        dica: "Pagamento aprovado e nenhum contato da equipe ainda.",
        ordem: 1,
        // Dinheiro entrou e o cliente está esperando: nunca é "esta semana".
        agora: pagos.length > 0,
        situacao: situacaoDe(ve("pagos_sem_contato"), dados.pagosSemContato),
        render: () => <PagosSemContato estado={dados.pagosSemContato} aoTentarDeNovo={atualizar} />,
      },
      {
        id: "compras-travadas",
        titulo: "Compra travada",
        dica: "Compra revertida ou boleto que não entrou.",
        ordem: 2,
        agora: compras.some((c) => c.revertido),
        situacao: situacaoDaFonte(true, fonteCompras),
        render: () => <ComprasTravadas estado={comoBloco(fonteCompras)} aoTentarDeNovo={atualizar} />,
      },
      {
        id: "prazos",
        titulo: "Prazos abertos",
        dica: "Tarefa em aberto com data-limite.",
        ordem: 3,
        agora: haPrazoUrgente(prazos, agora),
        situacao: situacaoDaFonte(true, fontePrazos),
        render: () => <PrazosDoDia estado={comoBloco(fontePrazos)} agora={agora} aoTentarDeNovo={atualizar} />,
      },
      {
        id: "sessoes-hoje",
        titulo: "Sessões de hoje",
        dica: "As próximas 48 horas: horário, presença, preparo e sala.",
        ordem: 4,
        agora: sessoes.some((s) => new Date(s.inicio_em) < amanha),
        situacao: situacaoDe(ve("sessoes_hoje"), dados.sessoesDoDia),
        render: () => <SessoesHoje estado={dados.sessoesDoDia} aoTentarDeNovo={atualizar} />,
      },
      {
        id: "preparo-pendente",
        titulo: "Preparo pendente",
        dica: "Sessão marcada com algo faltando antes dela.",
        ordem: 5,
        // Preparo de uma sessão que é hoje ou amanhã não espera.
        agora: preparo.some((p) => new Date(p.inicio_em) < depoisDeAmanha),
        situacao: situacaoDe(ve("preparo"), dados.pendenciasPreparo),
        render: () => <PreparoPendente estado={dados.pendenciasPreparo} aoTentarDeNovo={atualizar} />,
      },
      {
        id: "travado",
        titulo: "Precisa de alguém",
        dica: "O que emperrou e só destrava com uma ação da equipe.",
        ordem: 6,
        // Sessão sem sala é a única pendência de sistema que tem hora marcada.
        agora: travados.some((t) => t.tipo === "sessao_sem_sala"),
        situacao: situacaoDe(ve("travado"), travadosBloco),
        render: () => <Travado estado={dados.pendenciasSistema} papel={papel} aoTentarDeNovo={atualizar} />,
      },
    ];
  }, [dados, papel, ve, atualizar, fontePrazos, fonteCompras, agora]);

  const comTrabalho = fila.filter((b) => b.situacao === "trabalho" || b.situacao === "falha");
  const agoraMesmo = comTrabalho.filter((b) => b.agora).sort((a, b) => a.ordem - b.ordem);
  const estaSemana = comTrabalho.filter((b) => !b.agora).sort((a, b) => a.ordem - b.ordem);
  const tranquilos: BlocoTranquilo[] = fila.filter((b) => b.situacao === "vazio").map((b) => ({ id: b.id, titulo: b.titulo, dica: b.dica }));

  const resumo = useMemo<ItemResumo[]>(() => {
    if (!dados) return [];
    const sessoes = dados.sessoesDoDia.situacao === "ok" ? dados.sessoesDoDia.itens : null;
    const temColunaPresenca = sessoes?.some((s) => s.presenca_confirmada_em !== undefined) ?? false;
    const prazos = fontePrazos.situacao === "ok" ? fontePrazos.itens : null;
    const compras = fonteCompras.situacao === "ok" ? fonteCompras.itens : null;
    const vencendo = prazos?.filter((p) => ["vencido", "hoje"].includes(classificarPrazo(p.vence_em, agora))).length ?? null;

    const itens: (ItemResumo | null)[] = [
      ve("pagos_sem_contato")
        ? {
            id: "r-pagos",
            rotulo: "Pagou, sem contato",
            valor: dados.pagosSemContato.situacao === "ok" ? dados.pagosSemContato.itens.length : null,
            motivoVazio: "não carregou",
            href: "#pagos-sem-contato",
            urgente: true,
          }
        : null,
      fonteCompras.situacao === "ausente"
        ? null
        : { id: "r-compras", rotulo: "Compra travada", valor: compras?.length ?? null, motivoVazio: "não carregou", href: "#compras-travadas", urgente: true },
      fontePrazos.situacao === "ausente"
        ? null
        : { id: "r-prazos", rotulo: "Vence hoje ou venceu", valor: vencendo, motivoVazio: "não carregou", href: "#prazos", urgente: true },
      ve("sessoes_hoje")
        ? { id: "r-sessoes", rotulo: "Sessões em 48 h", valor: sessoes ? sessoes.length : null, motivoVazio: "não carregou", href: "#sessoes-hoje" }
        : null,
      ve("sessoes_hoje")
        ? {
            id: "r-confirmadas",
            rotulo: "Confirmaram presença",
            valor: sessoes && temColunaPresenca ? sessoes.filter((s) => Boolean(s.presenca_confirmada_em)).length : null,
            unidade: sessoes ? `de ${sessoes.length}` : undefined,
            motivoVazio: !sessoes ? "não carregou" : sessoes.length === 0 ? "sem sessão nas próximas 48 h" : "presença ainda não disponível",
            href: "#sessoes-hoje",
          }
        : null,
      // O MESMO recorte do bloco "Travado" (`pendenciasVisiveis`). Contar o
      // array cru dizia "Travado 1" com o bloco logo abaixo dizendo "Nada
      // travado" — dois números para o mesmo fato, na mesma dobra.
      ve("travado")
        ? {
            id: "r-travado",
            rotulo: "Precisa de alguém",
            valor: dados.pendenciasSistema.situacao === "ok" ? pendenciasVisiveis(dados.pendenciasSistema.itens, papel).length : null,
            motivoVazio: "não carregou",
            href: "#travado",
          }
        : null,
    ];
    return itens.filter((i): i is ItemResumo => i !== null);
  }, [dados, fontePrazos, fonteCompras, ve, papel, agora]);

  return (
    <div className="flex flex-col gap-bloco">
      {carregando && semNenhumaCargaAinda && (
        <div className="flex flex-col gap-bloco">
          <EsqueletoCartao quantidade={4} rotulo="Carregando o painel do dia…" />
          <EsqueletoLista linhas={3} rotulo="" />
          <EsqueletoLista linhas={2} rotulo="" />
        </div>
      )}

      {Boolean(erro) && semNenhumaCargaAinda && <EstadoErro erro={erro} tentarNovamente={atualizar} titulo="Não deu para carregar o painel" />}

      {dados && (
        <>
          <ResumoDoDia itens={resumo} />

          {/* Faixa 1 — o que não espera. O rótulo só aparece quando há as duas
              faixas: com uma só, nomear seria ruído (a tela inteira é ela). */}
          {agoraMesmo.length > 0 && (
            <section aria-labelledby="faixa-agora" className="flex flex-col gap-item">
              <h2 id="faixa-agora" className="text-subtitulo font-bold text-tinta">
                Precisa de você agora
              </h2>
              {agoraMesmo.map((bloco) => (
                <div key={bloco.id}>{bloco.render()}</div>
              ))}
            </section>
          )}

          {estaSemana.length > 0 && (
            <section aria-labelledby="faixa-semana" className="flex flex-col gap-item">
              <h2 id="faixa-semana" className="text-subtitulo font-bold text-tinta">
                Ainda esta semana
              </h2>
              {estaSemana.map((bloco) => (
                <div key={bloco.id}>{bloco.render()}</div>
              ))}
            </section>
          )}

          <TudoCerto blocos={tranquilos} />

          {/* Sistema — existe só para o admin, e cabe numa linha. */}
          {ve("sistema") && (
            <section aria-labelledby="secao-sistema" className="flex flex-col gap-item">
              <h2 id="secao-sistema" className="text-subtitulo font-bold text-tinta">
                Sistema
              </h2>
              <ProvaDeVida versao={versao} />
            </section>
          )}

          {ehAdmin && agoraMesmo.length === 0 && estaSemana.length === 0 && (
            <p className="text-sm text-tinta-suave">Nada exige ação hoje. Os números da semana estão na aba “Números”.</p>
          )}
        </>
      )}
    </div>
  );
}
