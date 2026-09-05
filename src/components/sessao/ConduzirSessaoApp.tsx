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
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { BarraProgresso } from "@/components/sessao/BarraProgresso";
import { BlocoRoteiro } from "@/components/sessao/BlocoRoteiro";
import { PainelSims } from "@/components/sessao/PainelSims";
import { PainelOferta } from "@/components/sessao/PainelOferta";
import { AtalhosTeclado } from "@/components/sessao/AtalhosTeclado";
import { PainelBriefingSessao } from "@/components/briefing/PainelBriefingSessao";
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
      <div className="flex flex-col gap-8" aria-busy="true">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Carregando a sessão…" />
        <EsqueletoFicha />
      </div>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="flex flex-col gap-8">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Sessão de Viabilidade" />
        <EstadoErro erro={estado.erro} tentarNovamente={tentarNovamente} titulo="Não foi possível carregar a sessão" />
      </div>
    );
  }

  if (estado.fase === "sem-sessao" || estado.fase === "sem-roteiro") {
    const semRoteiro = estado.fase === "sem-roteiro";
    return (
      <div className="flex flex-col gap-8">
        <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} />
        <EstadoVazio
          ilustracao="agenda"
          titulo={semRoteiro ? "Nenhum roteiro ativo para Sessão de Viabilidade" : "Nenhuma Sessão de Viabilidade registrada para esta jornada"}
          descricao={
            semRoteiro
              ? "Não existe versão ativa do roteiro da Sessão de Viabilidade. A tela não improvisa o script — o Admin ainda não tem aba de roteiros; a versão é ativada pela equipe técnica (roteiros_versoes, chave sessao_viabilidade)."
              : "Sem uma sessão criada não há o que conduzir aqui — nada é improvisado. Registre a sessão na ficha da jornada."
          }
          acao={
            <Link href={semRoteiro ? "/admin#prompts" : `/jornadas/${jornadaId}`}>
              <Botao variante="primario">{semRoteiro ? "Abrir Admin → Método" : "Abrir ficha da jornada"}</Botao>
            </Link>
          }
        />
      </div>
    );
  }

  if (!blocoAtual || !sessaoId) return null;

  const mostrarOferta = estado.ofertas.length > 0 || indice >= total - 3;

  return (
    <div className="flex flex-col gap-6 pb-28">
      <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} roteiro={estado.roteiro} />

      {/*
       * U1 (ARQUITETURA-FASE-3.md §5.3): o roteiro nunca pode ir para baixo da
       * dobra por causa do briefing. Em telas largas (notebook 1366×768
       * incluído — o breakpoint `lg` é 1024px) o briefing vira uma COLUNA ao
       * lado do roteiro, então ele não ocupa altura nenhuma da coluna
       * principal. Só em telas estreitas os dois empilham, e aí o briefing
       * vem DEPOIS do roteiro — a Dra. Elaine já está com o roteiro na tela
       * antes de rolar até o briefing.
       */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <BarraProgresso blocos={estado.roteiro.definicao.blocos} indiceAtual={indice} aoIrPara={irPara} />

          <PainelSims
            roteiro={estado.roteiro}
            sessaoId={sessaoId}
            estado={estado.sims}
            aoAtualizar={(novoEstado) => setEstado((e) => (e.fase === "pronto" ? { ...e, sims: novoEstado } : e))}
          />

          <Cartao como="div" realce="latao">
            <BlocoRoteiro sessaoId={sessaoId} bloco={blocoAtual} indice={indice} total={total} />
          </Cartao>

          {mostrarOferta && (
            <PainelOferta
              jornadaId={jornadaId}
              ofertas={estado.ofertas}
              preco={estado.preco}
              aoAtualizar={(ofertas) => setEstado((e) => (e.fase === "pronto" ? { ...e, ofertas } : e))}
            />
          )}

          <AtalhosTeclado />
        </div>

        <PainelBriefingSessao jornadaId={jornadaId} sessaoId={sessaoId} briefingAtual={estado.ficha.briefingAtual} />
      </div>

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
