"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buscarFicha360, type Agendamento, type Ficha360 } from "@/lib/api";
import { buscarRoteiroAtivo, buscarSims, listarOfertas, ErroSessao, type EstadoSims } from "@/components/sessao/api";
import type { Oferta, RoteiroVersao } from "@/types/roteiro";
import type { PrecoCroqui } from "@/types/cenario";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Quadro } from "@/components/ui/Quadro";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { BarraProgresso } from "@/components/sessao/BarraProgresso";
import { BlocoRoteiro } from "@/components/sessao/BlocoRoteiro";
import { PainelSims } from "@/components/sessao/PainelSims";
import { PainelOferta } from "@/components/sessao/PainelOferta";
import { AtalhosTeclado } from "@/components/sessao/AtalhosTeclado";
import { PainelBriefingSessao } from "@/components/briefing/PainelBriefingSessao";
import { PainelCopiloto } from "@/components/sessao/PainelCopiloto";
import { PainelVigilanciaAoVivo, PainelPerfilConsulta } from "@/components/sessao/PainelPerfilSessao";
import { formatarData } from "@/lib/formatar";

/** Chave de sessionStorage: em qual PARTE ela estava, para sobreviver a F5 sem voltar ao começo. */
function chaveIndice(sessaoId: string) {
  return `sic-hf:sessao:${sessaoId}:parte-atual`;
}

type EstadoCarga =
  | { fase: "carregando" }
  | { fase: "erro"; erro: unknown }
  | { fase: "sem-sessao"; ficha: Ficha360 }
  | { fase: "sem-roteiro"; ficha: Ficha360 }
  | { fase: "pronto"; ficha: Ficha360; roteiro: RoteiroVersao; sims: EstadoSims; ofertas: Oferta[]; preco: PrecoCroqui | null };

/**
 * `presenca_confirmada_em/_via` (0051) chegam em `Ficha360.agendamentos`
 * (`select("*")`), mas `src/lib/api.ts` (travado nesta onda) ainda não tipa
 * os campos. Leitura estreita: `undefined` = a coluna não existe neste banco
 * (migration não aplicada) → não mostra nada, não inventa; `null` =
 * aguardando; string = confirmada.
 */
type AgendamentoComPresenca = Agendamento & { presenca_confirmada_em?: string | null; presenca_confirmada_via?: string | null };

function agendamentoRelevante(agendamentos: Agendamento[]): AgendamentoComPresenca | null {
  if (agendamentos.length === 0) return null;
  const ativos = agendamentos.filter((a) => a.status === "agendado" || a.status === "confirmado");
  const lista = (ativos.length > 0 ? ativos : agendamentos).slice().sort((a, b) => b.inicio_em.localeCompare(a.inicio_em));
  return lista[0] as AgendamentoComPresenca;
}

function SeloPresenca({ agendamentos }: { agendamentos: Agendamento[] }) {
  const ag = agendamentoRelevante(agendamentos);
  if (!ag || ag.presenca_confirmada_em === undefined) return null;
  if (ag.presenca_confirmada_em) {
    const via = ag.presenca_confirmada_via === "equipe" ? " pela equipe" : ag.presenca_confirmada_via === "link" ? " pelo cliente" : "";
    return (
      <Selo
        tom="verde"
        icone={
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 10.5l3.6 3.5 7.4-8" />
          </svg>
        }
      >
        Presença confirmada{via} · {formatarData(ag.presenca_confirmada_em)}
      </Selo>
    );
  }
  return <Selo tom="neutro">Aguardando confirmação de presença</Selo>;
}

export function ConduzirSessaoApp({ jornadaId }: { jornadaId: string }) {
  const [estado, setEstado] = useState<EstadoCarga>({ fase: "carregando" });
  const [indice, setIndice] = useState(0);
  const [tentativa, setTentativa] = useState(0);

  // Busca PURA: devolve o próximo estado, não o grava — o efeito abaixo só
  // faz setState em continuação (`.then/.catch`), o padrão de `useRecurso`.
  const carregar = useCallback(async (): Promise<{ estado: EstadoCarga; indice: number }> => {
    const ficha = await buscarFicha360(jornadaId);
    if (!ficha.sessao) return { estado: { fase: "sem-sessao", ficha }, indice: 0 };
    const sessaoId = ficha.sessao.id;

    let roteiro: RoteiroVersao;
    try {
      roteiro = await buscarRoteiroAtivo("sessao_viabilidade");
    } catch (e) {
      if (e instanceof ErroSessao && e.status === 404) return { estado: { fase: "sem-roteiro", ficha }, indice: 0 };
      throw e;
    }

    const [sims, ofertasResposta] = await Promise.all([buscarSims(sessaoId), listarOfertas(jornadaId)]);

    let indiceInicial = 0;
    try {
      const salvo = window.sessionStorage.getItem(chaveIndice(sessaoId));
      if (salvo) {
        const n = Number(salvo);
        if (Number.isInteger(n) && n >= 0 && n < roteiro.definicao.blocos.length) indiceInicial = n;
      }
    } catch {
      /* sessionStorage indisponível — começa do 0 */
    }

    return {
      estado: { fase: "pronto", ficha, roteiro, sims, ofertas: ofertasResposta.itens, preco: ofertasResposta.preco },
      indice: indiceInicial,
    };
  }, [jornadaId]);

  useEffect(() => {
    let vivo = true;
    carregar()
      .then((resultado) => {
        if (!vivo) return;
        setIndice(resultado.indice);
        setEstado(resultado.estado);
      })
      .catch((erro) => {
        if (vivo) setEstado({ fase: "erro", erro });
      });
    return () => {
      vivo = false;
    };
  }, [carregar, tentativa]);

  const tentarNovamente = useCallback(() => {
    setEstado({ fase: "carregando" });
    setTentativa((t) => t + 1);
  }, []);

  const total = estado.fase === "pronto" ? estado.roteiro.definicao.blocos.length : 0;
  const sessaoId = estado.fase === "pronto" ? estado.ficha.sessao!.id : null;

  const irPara = useCallback(
    (novoIndice: number) => {
      setIndice((atual) => {
        const proximo = Math.max(0, Math.min(total - 1, novoIndice));
        if (sessaoId) {
          try {
            window.sessionStorage.setItem(chaveIndice(sessaoId), String(proximo));
          } catch {
            /* ok não persistir */
          }
        }
        return proximo === atual ? atual : proximo;
      });
    },
    [total, sessaoId],
  );

  // Navegação por teclado (setas). Ignora quando o foco está em campo de texto,
  // para não brigar com a digitação da anotação rápida ou do valor da oferta.
  useEffect(() => {
    if (estado.fase !== "pronto") return;
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT" || alvo.isContentEditable);
      if (digitando) return;
      if (evento.key === "ArrowRight") {
        evento.preventDefault();
        irPara(indice + 1);
      } else if (evento.key === "ArrowLeft") {
        evento.preventDefault();
        irPara(indice - 1);
      } else if (evento.key === "Home") {
        evento.preventDefault();
        irPara(0);
      } else if (evento.key === "End") {
        evento.preventDefault();
        irPara(total - 1);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [estado.fase, indice, irPara, total]);

  const blocoAtual = useMemo(() => {
    if (estado.fase !== "pronto") return null;
    return estado.roteiro.definicao.blocos[indice] ?? null;
  }, [estado, indice]);

  if (estado.fase === "carregando") {
    return (
      <div className="flex flex-col gap-bloco" aria-busy="true">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Carregando a sessão…" />
        <EsqueletoFicha />
      </div>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="flex flex-col gap-bloco">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Sessão de Viabilidade" />
        <EstadoErro erro={estado.erro} tentarNovamente={tentarNovamente} titulo="Não foi possível carregar a sessão" />
      </div>
    );
  }

  if (estado.fase === "sem-sessao" || estado.fase === "sem-roteiro") {
    const semRoteiro = estado.fase === "sem-roteiro";
    return (
      <div className="flex flex-col gap-bloco">
        <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} />
        <EstadoVazio
          ilustracao="agenda"
          titulo={semRoteiro ? "Nenhum roteiro ativo para Sessão de Viabilidade" : "Nenhuma Sessão de Viabilidade registrada para esta jornada"}
          descricao={
            semRoteiro
              ? // Correção de 15/09: o texto antigo dizia que o Admin não tinha
                // aba de roteiros e mandava a equipe técnica mexer direto no
                // banco — isso deixou de ser verdade na Fase 7 r3, quando
                // "Formulário e roteiros" (aba `formularios`) ganhou o botão
                // "Ativar esta" (`RoteirosSecao.tsx`, BLOQUEIO B15).
                "Não existe versão ativa do roteiro da Sessão de Viabilidade. A tela não improvisa o script — ative uma versão em Admin → Formulário e roteiros."
              : "Sem uma sessão criada não há o que conduzir aqui — nada é improvisado. Registre a sessão na ficha da jornada."
          }
          acao={
            <Link href={semRoteiro ? "/admin#formularios" : `/jornadas/${jornadaId}`}>
              <Botao variante="primario">{semRoteiro ? "Abrir Admin → Formulário e roteiros" : "Abrir ficha da jornada"}</Botao>
            </Link>
          }
        />
      </div>
    );
  }

  if (!blocoAtual || !sessaoId) return null;

  const mostrarOferta = estado.ofertas.length > 0 || indice >= total - 3;

  return (
    <div className="flex w-full flex-col gap-2 pb-28">
      <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} roteiro={estado.roteiro} />

      {/*
       * Redesenho de largura cheia (pedido do Marcio, 14/09): "tudo sobre a
       * sessão em andamento precisa estar visível na primeira dobra, para
       * monitorar no segundo monitor durante a sessão em tempo real" — é
       * painel de VIGILÂNCIA, não página de leitura. Quatro peças formam a
       * primeira dobra, nesta ordem:
       *
       *  1. Faixa fina do roteiro (logo abaixo) — "Parte X de Y — Título" +
       *     os N números clicáveis, uma linha, ~60-70px.
       *  2. Sugestão (quadro 1) + Alerta (quadro 2) do `PainelCopiloto` — o
       *     copiloto propriamente dito.
       *  3. Os 4 SIMs, ao lado do mosaico (não mais dentro da 2ª dobra) —
       *     registrar um SIM não pode exigir rolar a página no meio da
       *     conversa.
       *  4. Transcrição ao vivo + registrar trecho — dentro do
       *     `PainelCopiloto`, logo após o quadro 2 (ver comentário lá).
       *
       * `PainelPerfilSessao` deixou de ser a coluna esquerda inteira: só o
       * que é VIGILÂNCIA AO VIVO (Progresso da sessão, Estado final) continua
       * aqui em cima, ao lado do mosaico — 5 dos 7 campos (Perfil, Leitura
       * decisória, Modo, Preço, Sessão) são CONSULTA ocasional do briefing,
       * não leitura contínua durante a fala do cliente, e desceram para
       * fora da primeira dobra (ver mais abaixo). `items-start` em toda a
       * grade: cada bloco tem a altura do próprio conteúdo, nunca estica
       * para casar com o vizinho mais alto — densidade real, sem espaço
       * morto.
       *
       * Decisão do dono (15/09, 1ª rodada): breakpoint alinhado com a grade
       * B (mais abaixo) em `lg` (1024px), não mais `xl` (1280px) — entre
       * 1024 e 1279px a tela tinha uma seção em 2 colunas e outra em 1.
       *
       * Decisão do dono (15/09, 2ª rodada, medição aceita): mesmo com o
       * teto do `<blockquote>` (Tarefa 1) e a quebra em `lg` (Tarefa 2), os
       * 4 SIMs empilhados numa coluna de 260px somam ~692px — não cabem em
       * 900px de viewport junto com cabeçalho, faixa do roteiro e
       * vigilância (medido, ver Diário). Solução: abaixo de `xl` (1280px)
       * o `PainelSims` DEIXA a coluna lateral e vira uma FAIXA de largura
       * cheia, ACIMA do mosaico do `PainelCopiloto` — os 4 SIMs dividem
       * espaço horizontal em vez de empilhar, e os botões de ação param de
       * quebrar para linha própria (ver `PainelSims.tsx`).
       *
       * Decisão do dono (15/09, 3ª rodada, achado aceito): `xl` é
       * INCLUSIVO (min-width: 1280px) — então as duas larguras que o dono
       * pediu para medir (1280×800, 1440×900) caíam no modo COLUNA, não na
       * faixa, e continuavam em ~692px sem caber. Corte movido de `xl`
       * para `2xl` (1536px): agora 1280×800 e 1440×900 usam a faixa
       * (medido: ~436px, cabe), e só monitor grande (o caso de uso
       * declarado — "monitorar no segundo monitor", comentário acima) usa
       * a coluna lateral. `2xl` escolhido em vez de um valor customizado
       * (ex. 1441px) para não criar escala de breakpoint fora do padrão do
       * projeto — o mesmo motivo que fez `PainelCopiloto.tsx` adotar
       * `2xl:grid-cols-4` na grade de apoio (outro agente, mesma decisão).
       *
       * Implementado com UMA `<div>` `grid` e `grid-template-areas`
       * nomeadas (`copiloto`/`vigilancia`/`sims`) em vez de duas grades
       * concorrentes: é a MESMA instância de cada componente mudando de
       * área por breakpoint — nunca duas instâncias com uma escondida. Isso
       * evita o problema do requisito do dono: duplicar `PainelSims` no DOM
       * quebraria o axe (conteúdo repetido para leitor de tela) e o teste
       * de `offsetParent`. A ordem de leitura (vigilância → SIMs → mosaico)
       * é a mesma em qualquer largura — só a GEOMETRIA muda, nunca a ordem
       * das áreas no `grid-template-areas`.
       *
       * A coluna lateral nasce em 300px (não mais 260px→300px em dois
       * estágios `xl`/`2xl`): como a transição faixa→coluna e o alargamento
       * da coluna aconteciam em breakpoints DIFERENTES antes (`xl`/`2xl`),
       * ao herdar o único corte em `2xl` as duas regras concorreriam pela
       * mesma propriedade (`grid-template-columns`) no mesmo breakpoint —
       * absorvidas em uma só: a coluna já nasce na largura final quando
       * aparece.
       */}
      {/* Sem o wrapper `Quadro` de propósito aqui: um rótulo "ROTEIRO" em
       * caixa alta acima somaria uma linha inteira a uma faixa que já diz
       * "Parte X de Y — Título" por extenso (dentro de `BarraProgresso
       * compacta`) — literalmente o "quadro que não precisa existir"
       * aplicado à própria faixa. A borda fina do `nao-imprimir` dentro do
       * componente já delimita a área; aqui só o respiro de padding. */}
      <div className="rounded-controle border border-linha bg-papel-elevado px-3 py-2">
        <BarraProgresso blocos={estado.roteiro.definicao.blocos} indiceAtual={indice} aoIrPara={irPara} compacta />
      </div>

      <div
        className="grid grid-cols-1 items-start gap-2 [grid-template-areas:'vigilancia'_'sims'_'copiloto'] 2xl:grid-cols-[minmax(0,1fr)_300px] 2xl:[grid-template-areas:'copiloto_vigilancia'_'copiloto_sims']"
      >
        {/*
         * Ordem no DOM = ordem visual abaixo de `2xl` (vigilância → sims →
         * copiloto), para não descasar da ordem de leitura por teclado/
         * leitor de tela: `grid-template-areas` só reordena a GEOMETRIA, a
         * navegação sequencial (Tab, leitor de tela linha a linha) sempre
         * segue a ordem do DOM. Em `2xl`+ a área "copiloto" ocupa as duas
         * linhas da coluna esquerda — a inversão visual ali é aceitável
         * porque em `2xl`+ a tela é larga o bastante para vigilância/SIMs
         * ficarem sempre visíveis ao lado, sem precisar rolar até o
         * copiloto primeiro (o motivo original do redesenho, ver comentário
         * acima).
         */}
        <div className="flex flex-col gap-2 [grid-area:vigilancia]">
          <PainelVigilanciaAoVivo sessao={estado.ficha.sessao!} indiceAtual={indice} totalBlocos={total} />
        </div>

        <div className="[grid-area:sims]">
          <PainelSims
            roteiro={estado.roteiro}
            sessaoId={sessaoId}
            estado={estado.sims}
            aoAtualizar={(novoEstado) => setEstado((e) => (e.fase === "pronto" ? { ...e, sims: novoEstado } : e))}
          />
        </div>

        <div className="flex flex-col gap-2 [grid-area:copiloto]">
          <PainelCopiloto sessaoId={sessaoId} indiceAtual={indice} blocosRoteiro={estado.roteiro.definicao.blocos} irPara={irPara} />
        </div>
      </div>

      {/* Fora da primeira dobra (ordem de importância, pedido do Marcio):
       * Anotação da parte · Perfil/briefing de CONSULTA · Atalhos de teclado
       * · Briefing Estratégico · Oferta. "Histórico do coach" e "Encerrar
       * copiloto" já vêm depois, dentro do próprio `PainelCopiloto` — nunca
       * duplicados aqui. */}
      <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Quadro rotulo="Anotação da parte atual" como="article">
          <BlocoRoteiro sessaoId={sessaoId} bloco={blocoAtual} indice={indice} total={total} />
        </Quadro>

        <div className="flex flex-col gap-2">
          <PainelPerfilConsulta
            pessoa={estado.ficha.pessoa}
            jornada={estado.ficha.jornada}
            sessao={estado.ficha.sessao!}
            briefingAtual={estado.ficha.briefingAtual}
            preco={estado.preco}
          />
          <AtalhosTeclado />
        </div>
      </div>

      <Quadro rotulo="Briefing" como="article">
        <PainelBriefingSessao jornadaId={jornadaId} sessaoId={sessaoId} briefingAtual={estado.ficha.briefingAtual} />
      </Quadro>

      {mostrarOferta && (
        <PainelOferta
          jornadaId={jornadaId}
          ofertas={estado.ofertas}
          preco={estado.preco}
          aoAtualizar={(ofertas) => setEstado((e) => (e.fase === "pronto" ? { ...e, ofertas } : e))}
        />
      )}

      <nav
        aria-label="Navegar entre partes"
        className="nao-imprimir fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-linha bg-papel-elevado px-4 py-3 shadow-flutuante sm:px-6"
      >
        <Botao variante="secundario" onClick={() => irPara(indice - 1)} disabled={indice === 0}>
          ← Anterior
        </Botao>
        <span aria-live="polite" className="text-sm text-tinta-suave">
          Parte <span className="font-bold text-tinta">{indice}</span> de {total - 1}
        </span>
        <Botao variante="primario" onClick={() => irPara(indice + 1)} disabled={indice === total - 1}>
          Próxima →
        </Botao>
      </nav>
    </div>
  );
}

/**
 * O script existe em 4 versões no material da Dra. Elaine e nenhuma foi
 * carimbada como oficial (BLOQUEIO B15, ARQUITETURA-FASE-2 §7). A versão 4
 * está ativa por escolha técnica, não por decisão dela — a tela precisa
 * dizer isso, sóbrio, sem alarme.
 */
function Cabecalho({ ficha, jornadaId, roteiro }: { ficha: Ficha360; jornadaId: string; roteiro?: RoteiroVersao }) {
  return (
    <CabecalhoPagina
      rotulo="Conduzir sessão"
      titulo={ficha.pessoa.nome}
      descricao="Roteiro da Sessão de Viabilidade, uma parte por vez. Fala, ação, o que nunca dizer e o que observar."
      acoes={
        <Link href={`/jornadas/${jornadaId}`} className="nao-imprimir">
          <Botao variante="secundario">Ver ficha completa</Botao>
        </Link>
      }
      meta={
        <>
          <SeloPresenca agendamentos={ficha.agendamentos} />
          {roteiro && (
            <>
              <Selo tom="neutro">
                Roteiro: {roteiro.titulo} · versão {roteiro.versao}
              </Selo>
              <span className="nao-imprimir">Nenhuma das 4 versões do material foi carimbada como oficial pela Dra. Elaine; esta é a mais extensa e está ativa por escolha do time técnico.</span>
            </>
          )}
        </>
      }
    />
  );
}
