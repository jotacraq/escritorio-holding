"use client";

import { useState } from "react";
import { useTema } from "@/hooks/useTema";
import type { EstadoCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { CroquiCalculado } from "@/components/croqui/CroquiCalculado";
import { EditorCroqui } from "@/components/croqui/EditorCroqui";
import { NarrativaCroqui } from "@/components/croqui/NarrativaCroqui";
import { rotaCroquiApresentar, rotaCroquiSimular } from "./rotas-croqui";

/**
 * A Ficha 360 · Croqui.
 *
 * O croqui É o cálculo: as 19 tabelas do motor, com procedência por célula
 * (`CroquiCalculado`) — e daqui saem Apresentar, Simular e o `.docx`. Até a
 * Fase 5 esta aba mostrava OUTRO croqui, o editor de 13 slides de prosa da IA
 * v1, e o botão "Apresentar" abria algo que não era o que se editava. Dois
 * croquis na mesma aba, um deles falando por números que o motor não conhece.
 *
 * Decisão (Fase 5, rodada de correção): o cálculo é o conteúdo; o editor v1
 * não some — vira "Narrativa da IA (versão anterior)", recolhido, com UMA
 * ação. Nada de dado apagado, e a tela deixa de ter duas verdades ao mesmo
 * tempo sobre o mesmo cliente.
 */
export function CroquiAba({ jornadaId, estadoCroqui }: { jornadaId: string; estadoCroqui: EstadoCroquiDaJornada }) {
  const { tema } = useTema();
  const [editorAberto, setEditorAberto] = useState(false);
  const {
    croqui,
    croquiAtual,
    carregandoCroqui,
    erroCroqui,
    croquiInexistente,
    recarregarCroqui,
    criando,
    erroCriar,
    iniciarCroqui,
    dadosGraficos,
  } = estadoCroqui;

  if (croqui === undefined && carregandoCroqui) return <EstadoCarregando rotulo="Carregando croqui…" />;
  if (croqui === undefined && erroCroqui && !croquiInexistente) {
    return <EstadoErro erro={erroCroqui} tentarNovamente={recarregarCroqui} titulo="Não deu para abrir o croqui" />;
  }

  // Sem registro de croqui não há rota para apresentar nem para simular (as
  // três telas são `/croquis/[croquiId]/…`). Uma linha e um botão.
  if (!croquiAtual) {
    return (
      <div className="flex flex-col gap-item">
        <EstadoVazio
          compacto
          titulo="Nenhum croqui iniciado"
          acao={
            <Botao variante="primario" carregando={criando} onClick={iniciarCroqui}>
              Iniciar croqui
            </Botao>
          }
        />
        {erroCriar && (
          <p role="alert" className="text-sm text-[color:var(--vermelho)]">
            {erroCriar}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-secao">
      {Boolean(erroCroqui) && !croquiInexistente && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          Croqui não atualizado — o que está na tela é o último estado salvo.
        </p>
      )}

      <CroquiCalculado
        jornadaId={jornadaId}
        croquiId={croquiAtual.id}
        hrefSimular={rotaCroquiSimular(croquiAtual.id)}
        hrefApresentar={rotaCroquiApresentar(croquiAtual.id)}
      />

      <NarrativaCroqui croquiId={croquiAtual.id} />

      <Cartao
        rotulo="Versão anterior"
        titulo="Narrativa da IA"
        preenchimento="compacto"
        acao={
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => setEditorAberto((v) => !v)}
            aria-expanded={editorAberto}
            aria-controls={editorAberto ? "editor-croqui-v1" : undefined}
          >
            {editorAberto ? "Fechar editor" : "Abrir editor"}
          </Botao>
        }
      >
        {editorAberto && (
          <div id="editor-croqui-v1" className="mt-4">
            <EditorCroqui croqui={croquiAtual} dadosGraficos={dadosGraficos} tema={tema} aoAtualizar={recarregarCroqui} />
          </div>
        )}
      </Cartao>
    </div>
  );
}
