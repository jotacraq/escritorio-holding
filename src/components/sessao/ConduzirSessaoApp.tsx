"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buscarFicha360, type Ficha360 } from "@/lib/api";
import {
  buscarRoteiroAtivo,
  buscarSims,
  listarOfertas,
  ErroSessao,
  type EstadoSims,
} from "@/components/sessao/api";
import type { Oferta, RoteiroVersao } from "@/types/roteiro";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { BarraProgresso } from "@/components/sessao/BarraProgresso";
import { BlocoRoteiro } from "@/components/sessao/BlocoRoteiro";
import { PainelSims } from "@/components/sessao/PainelSims";
import { PainelOferta } from "@/components/sessao/PainelOferta";
import { AtalhosTeclado } from "@/components/sessao/AtalhosTeclado";
import { Botao } from "@/components/ui/Botao";
import { PainelBriefingSessao } from "@/components/briefing/PainelBriefingSessao";

/** Chave de sessionStorage: em qual PARTE ela estava, para sobreviver a F5 sem voltar ao começo. */
function chaveIndice(sessaoId: string) {
  return `sic-hf:sessao:${sessaoId}:parte-atual`;
}

type EstadoCarga =
  | { fase: "carregando" }
  | { fase: "erro"; erro: unknown }
  | { fase: "sem-sessao"; ficha: Ficha360 }
  | { fase: "sem-roteiro" }
  | { fase: "pronto"; ficha: Ficha360; roteiro: RoteiroVersao; sims: EstadoSims; ofertas: Oferta[] };

export function ConduzirSessaoApp({ jornadaId }: { jornadaId: string }) {
  const [estado, setEstado] = useState<EstadoCarga>({ fase: "carregando" });
  const [indice, setIndice] = useState(0);

  const carregar = useCallback(async () => {
    setEstado({ fase: "carregando" });
    try {
      const ficha = await buscarFicha360(jornadaId);
      if (!ficha.sessao) {
        setEstado({ fase: "sem-sessao", ficha });
        return;
      }
      const sessaoId = ficha.sessao.id;

      let roteiro: RoteiroVersao;
      try {
        roteiro = await buscarRoteiroAtivo("sessao_viabilidade");
      } catch (e) {
        if (e instanceof ErroSessao && e.status === 404) {
          setEstado({ fase: "sem-roteiro" });
          return;
        }
        throw e;
      }

      const [sims, ofertas] = await Promise.all([buscarSims(sessaoId), listarOfertas(jornadaId)]);

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
      setIndice(indiceInicial);

      setEstado({ fase: "pronto", ficha, roteiro, sims, ofertas });
    } catch (erro) {
      setEstado({ fase: "erro", erro });
    }
  }, [jornadaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
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

  if (estado.fase === "carregando") return <EstadoCarregando rotulo="Carregando sessão…" />;

  if (estado.fase === "erro") {
    return <EstadoErro erro={estado.erro} tentarNovamente={carregar} titulo="Não foi possível carregar a sessão" />;
  }

  if (estado.fase === "sem-sessao") {
    return (
      <div className="flex flex-col gap-4">
        <CabecalhoPessoa pessoa={estado.ficha.pessoa} jornadaId={jornadaId} />
        <EstadoVazio
          titulo="Nenhuma Sessão de Viabilidade registrada para esta jornada"
          descricao="Sem uma sessão criada não há o que conduzir aqui — nada é improvisado. Registre a sessão na ficha da jornada."
          acao={
            <Link href={`/jornadas/${jornadaId}`} className="text-sm font-medium text-[color:var(--latao)] underline">
              Abrir ficha da jornada
            </Link>
          }
        />
      </div>
    );
  }

  if (estado.fase === "sem-roteiro") {
    return (
      <EstadoVazio
        titulo="Nenhum roteiro ativo para Sessão de Viabilidade"
        descricao='Não existe versão ativa em roteiros_versoes para a chave "sessao_viabilidade". A tela não improvisa o script — configure uma versão em Admin antes de conduzir a sessão.'
      />
    );
  }

  if (!blocoAtual || !sessaoId) return null;

  const mostrarOferta = estado.ofertas.length > 0 || indice >= total - 3;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <CabecalhoPessoa pessoa={estado.ficha.pessoa} jornadaId={jornadaId} />

      <AvisoVersaoRoteiro roteiro={estado.roteiro} />

      {/*
       * U1 (ARQUITETURA-FASE-3.md §5.3): o roteiro nunca pode ir para baixo da
       * dobra por causa do briefing. Em telas largas (notebook 1366×768
       * incluído — o breakpoint `lg` é 1024px) o briefing vira uma COLUNA ao
       * lado do roteiro, então ele não ocupa altura nenhuma da coluna
       * principal. Só em telas estreitas os dois empilham, e aí o briefing
       * vem DEPOIS do roteiro — a Dra. Elaine já está com o roteiro na tela
       * antes de rolar até o briefing.
       */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <BarraProgresso blocos={estado.roteiro.definicao.blocos} indiceAtual={indice} aoIrPara={irPara} />

          <PainelSims
            roteiro={estado.roteiro}
            sessaoId={sessaoId}
            estado={estado.sims}
            aoAtualizar={(novoEstado) => setEstado((e) => (e.fase === "pronto" ? { ...e, sims: novoEstado } : e))}
          />

          <div className="rounded-sm border border-linha bg-papel-elevado px-4 py-5 shadow-[var(--sombra-cartao)] sm:px-6 sm:py-7">
            <BlocoRoteiro sessaoId={sessaoId} bloco={blocoAtual} indice={indice} total={total} />
          </div>

          {mostrarOferta && (
            <PainelOferta
              jornadaId={jornadaId}
              ofertas={estado.ofertas}
              aoAtualizar={(ofertas) => setEstado((e) => (e.fase === "pronto" ? { ...e, ofertas } : e))}
            />
          )}

          <AtalhosTeclado />
        </div>

        <PainelBriefingSessao jornadaId={jornadaId} sessaoId={sessaoId} briefingAtual={estado.ficha.briefingAtual} />
      </div>

      <nav aria-label="Navegar entre partes" className="nao-imprimir fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-linha bg-papel-elevado px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:px-6">
        <Botao variante="secundario" onClick={() => irPara(indice - 1)} disabled={indice === 0}>
          ← Anterior
        </Botao>
        <span className="text-xs text-tinta-fraca">
          Parte {indice} de {total - 1}
        </span>
        <Botao variante="primario" onClick={() => irPara(indice + 1)} disabled={indice === total - 1}>
          Próxima →
        </Botao>
      </nav>
    </div>
  );
}

function CabecalhoPessoa({ pessoa, jornadaId }: { pessoa: Ficha360["pessoa"]; jornadaId: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Modo conduzir sessão</p>
        <h1 className="font-serif text-lg font-semibold text-tinta">{pessoa.nome}</h1>
      </div>
      <Link href={`/jornadas/${jornadaId}`} className="nao-imprimir text-sm text-tinta-suave underline hover:text-tinta">
        Ver ficha completa
      </Link>
    </header>
  );
}

/**
 * O script existe em 4 versões no material da Dra. Elaine e nenhuma foi
 * carimbada como oficial (BLOQUEIO B15, ARQUITETURA-FASE-2 §7). A versão 4
 * está ativa por escolha técnica, não por decisão dela — a tela precisa
 * dizer isso, sóbrio, sem alarme.
 */
function AvisoVersaoRoteiro({ roteiro }: { roteiro: RoteiroVersao }) {
  return (
    <p className="nao-imprimir rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-xs leading-relaxed text-tinta-fraca">
      Roteiro: <span className="font-medium text-tinta-suave">{roteiro.titulo}</span> — versão {roteiro.versao} de 4
      registradas no material. Nenhuma das 4 foi formalmente carimbada como oficial pela Dra. Elaine; esta é a mais
      extensa e está ativa por escolha do time técnico.
    </p>
  );
}
