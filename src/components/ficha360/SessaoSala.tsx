"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Selo } from "@/components/ui/Selo";
import { ErroFicha360Api } from "./api";
import { gravarLinkSala, linkSalaValido } from "./api-sessao";
import type { ExtrasFicha360 } from "./api-extras";

const ICONE_LINK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 6.8l1-1a2.9 2.9 0 014.1 4.1l-1.6 1.6M11.5 13.2l-1 1a2.9 2.9 0 01-4.1-4.1l1.6-1.6M8.3 11.7l3.4-3.4" />
  </svg>
);

/**
 * Sala da sessão (Fase 4 §1.3): o e-mail do dia só sai quando o link existe —
 * o cron segura a mensagem sem sala e a pendência `sessao_sem_sala` avisa.
 * Origem do link é fato do banco (`link_sala_origem` manual|n8n, 0051);
 * "sala solicitada ao n8n em …" vem de `sala_solicitada_em`. Sem nada disso
 * no payload, a tela diz com todas as letras que a sala é colada à mão.
 */
export function SessaoSala({ sessao, temAgendamentoAtivo, aoAtualizar }: { sessao: ExtrasFicha360["sessao"]; temAgendamentoAtivo: boolean; aoAtualizar: () => void }) {
  const { notificar } = useToast();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  if (!sessao) {
    return <p className="text-sm text-tinta-suave">Marque o horário primeiro</p>;
  }

  const colunaOrigemExiste = Object.prototype.hasOwnProperty.call(sessao, "link_sala_origem");
  const origem = sessao.link_sala_origem ?? "manual";
  const solicitadaEm = sessao.sala_solicitada_em ?? null;

  function abrirEdicao() {
    setTexto(sessao?.link_sala ?? "");
    setErro(null);
    setEditando(true);
  }

  async function salvar() {
    const url = linkSalaValido(texto);
    if (!url) {
      setErro("Cole o endereço completo da sala, começando com https:// (Zoom, Meet ou Teams).");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const { inalterada } = await gravarLinkSala(sessao!.jornada_id, url);
      notificar(
        inalterada
          ? { tom: "info", titulo: "O link da sala já era esse", descricao: "Nada foi alterado." }
          : { tom: "sucesso", titulo: "Link da sala salvo", descricao: "O e-mail do dia da sessão passa a sair com este link." },
      );
      setEditando(false);
      aoAtualizar();
    } catch (e) {
      const mensagem = e instanceof ErroFicha360Api || e instanceof ApiError ? e.message : "Confira a internet e tente de novo.";
      notificar({ tom: "erro", titulo: "Não foi possível salvar o link da sala", descricao: mensagem });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {sessao.link_sala ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom="verde" icone={ICONE_LINK}>
              Sala pronta
            </Selo>
            {colunaOrigemExiste && <Selo tom="neutro">{origem === "n8n" ? "criada pela integração" : "colada à mão"}</Selo>}
            {sessao.link_sala_atualizado_em && <span className="text-xs text-tinta-suave">atualizado em {formatarDataHora(sessao.link_sala_atualizado_em)}</span>}
          </div>
          <a href={sessao.link_sala} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center break-all text-sm text-[color:var(--latao)] underline underline-offset-2">
            {sessao.link_sala}
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Selo tom={temAgendamentoAtivo ? "ambar" : "neutro"} className="self-start">
            {temAgendamentoAtivo ? "Sem link da sala — o e-mail do dia fica segurado" : "Sem link da sala"}
          </Selo>
          {solicitadaEm ? (
            <p className="text-sm text-tinta-suave">Sala solicitada à integração (n8n) em {formatarDataHora(solicitadaEm)} — o link chega sozinho quando a reunião for criada. Se demorar, cole à mão.</p>
          ) : (
            <p className="text-sm text-tinta-suave">A sala é colada à mão: crie a reunião no Zoom ou Meet e cole o endereço aqui. A integração automática (n8n) só age quando estiver configurada em Admin → Integrações.</p>
          )}
        </div>
      )}

      {editando ? (
        <form
          className="nao-imprimir flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <Campo rotulo="Endereço da sala" ajuda="Zoom, Google Meet ou Teams — cole o link completo." erro={erro} obrigatorio>
            <Entrada type="url" inputMode="url" autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="https://…" autoFocus />
          </Campo>
          <div className="flex flex-wrap gap-2">
            <Botao type="submit" variante="primario" carregando={salvando}>
              Salvar link da sala
            </Botao>
            <Botao variante="fantasma" onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={abrirEdicao}>
            {sessao.link_sala ? "Trocar o link da sala" : "Colar link da sala"}
          </Botao>
        </div>
      )}
    </div>
  );
}
