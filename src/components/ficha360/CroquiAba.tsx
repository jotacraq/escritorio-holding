"use client";

import { useTema } from "@/hooks/useTema";
import type { EstadoCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { EditorCroqui } from "@/components/croqui/EditorCroqui";

/**
 * A Ficha 360 · Croqui (ARQUITETURA-FASE-3.md §2/§3, onda 3 — agente H).
 * Mostra só o Editor do Croqui — a Análise da Sessão (U4) virou aba de topo
 * própria no grupo "Sessão" (`AnaliseSessaoAba.tsx`, ver `jornadas/[id]/page.tsx`),
 * consumindo o mesmo estado via `useCroquiDaJornada`. Dívida documentada aqui
 * antes ("mover Análise da Sessão para o grupo Sessão quando `page.tsx` for
 * tocado de novo") — paga nesta mudança.
 *
 * Estado recebido por prop (mesma cirurgia já feita com `BriefingAba`): o
 * pai (`ConteudoFicha`) chama `useCroquiDaJornada` UMA vez e compartilha com
 * `CroquiAba`, `AnaliseSessaoAba` e `CabecalhoFicha` (atalho fixo), em vez de
 * cada aba buscar o croqui por conta própria.
 */
export function CroquiAba({ jornadaId, estadoCroqui }: { jornadaId: string; estadoCroqui: EstadoCroquiDaJornada }) {
  const { tema } = useTema();
  const { croqui, croquiAtual, carregandoCroqui, erroCroqui, croquiInexistente, recarregarCroqui, criando, erroCriar, iniciarCroqui, dadosGraficos } =
    estadoCroqui;

  const conteudoEditor = (() => {
    if (croqui === undefined) {
      if (carregandoCroqui) return <EstadoCarregando rotulo="Carregando croqui…" />;
      if (erroCroqui && !croquiInexistente) return <EstadoErro erro={erroCroqui} tentarNovamente={recarregarCroqui} />;
    }
    if (!croquiAtual) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-tinta-suave">
            Nenhum croqui iniciado para esta jornada. Iniciar monta o esqueleto dos 13 slides do método — ou rode a Análise da Sessão
            (aba Sessão › Análise da Sessão), que cria o rascunho automaticamente.
          </p>
          {erroCriar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroCriar}</p>}
          <Botao variante="primario" carregando={criando} onClick={iniciarCroqui}>Iniciar croqui</Botao>
        </div>
      );
    }
    return (
      <EditorCroqui
        jornadaId={jornadaId}
        croqui={croquiAtual}
        dadosGraficos={dadosGraficos}
        tema={tema}
        aoAtualizar={recarregarCroqui}
      />
    );
  })();

  return (
    <div className="flex flex-col gap-3">
      {croqui !== undefined && erroCroqui && !croquiInexistente ? (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          Não foi possível atualizar o croqui a partir do servidor — o que está na tela é o último estado salvo com sucesso.
        </p>
      ) : null}
      {conteudoEditor}
    </div>
  );
}
