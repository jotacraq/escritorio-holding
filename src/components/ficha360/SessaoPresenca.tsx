"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { Selo } from "@/components/ui/Selo";
import { SeloPresenca } from "@/components/agenda/SeloPresenca";
import { confirmarPresencaPelaEquipe } from "./api-sessao";
import type { ExtrasFicha360 } from "./api-extras";

const ROTULO_VIA: Record<string, string> = {
  link: "pelo link de confirmação",
  whatsapp: "por WhatsApp",
  email: "por e-mail",
  equipe: "pela equipe (telefone/WhatsApp)",
  ligacao_ia: "na ligação por IA",
};

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

/**
 * Presença confirmada é um FATO sobre o agendamento (Fase 4 §1.2, C23) — não
 * o `status='confirmado'` (que é "o cliente escolheu o horário pelo link").
 * Três estados reais + "sem informação" enquanto a coluna 0051 não existir
 * no banco. "Marcar como confirmado" grava `via='equipe'` e é irreversível
 * (trigger `app.protege_presenca_confirmada`) — por isso passa por
 * `ConfirmarAcao` com o efeito por extenso.
 */
export function SessaoPresenca({
  agendamento,
  aoAtualizar,
}: {
  agendamento: ExtrasFicha360["agendamentos"][number] | null;
  aoAtualizar: () => void;
}) {
  const { notificar } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  if (!agendamento) {
    return (
      <div className="flex flex-col gap-1">
        <Selo tom="neutro" className="self-start border-dashed">
          Sem agendamento ativo
        </Selo>
        <p className="text-sm text-tinta-suave">A confirmação de presença só existe depois que a sessão tiver um horário marcado.</p>
      </div>
    );
  }

  const colunaExiste = Object.prototype.hasOwnProperty.call(agendamento, "presenca_confirmada_em");
  const confirmadaEm = agendamento.presenca_confirmada_em ?? null;
  const via = agendamento.presenca_confirmada_via ?? null;

  async function confirmar() {
    setSalvando(true);
    try {
      await confirmarPresencaPelaEquipe(agendamento!.id);
      notificar({ tom: "sucesso", titulo: "Presença marcada como confirmada", descricao: "Fica registrado que a equipe confirmou por telefone/WhatsApp, não o cliente pelo link." });
      setConfirmando(false);
      aoAtualizar();
    } catch (e) {
      const codigo = e instanceof ApiError ? e.codigo : undefined;
      const status = e instanceof ApiError ? e.status : 0;
      notificar({
        tom: "erro",
        titulo: codigo === "agendamento_inativo" ? "Este horário não está mais ativo" : "Não foi possível marcar a presença",
        descricao:
          codigo === "agendamento_inativo"
            ? "O agendamento foi cancelado, remarcado ou já aconteceu. Só um horário ativo recebe confirmação — veja a lista de agendamentos abaixo."
            : status === 400 || status === 422
              ? "O servidor ainda não aceita este registro (migração 0051 pendente). Anote no WhatsApp por enquanto."
              : e instanceof ApiError
                ? e.message
                : "Confira a internet e tente de novo.",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeloPresenca presencaConfirmadaEm={colunaExiste ? confirmadaEm : undefined} inicioEm={agendamento.inicio_em} via={via} />
        <span className="text-sm text-tinta-suave">Sessão marcada para {formatarDataHora(agendamento.inicio_em)}</span>
      </div>

      {confirmadaEm ? (
        <p className="text-sm text-tinta">
          Confirmou em <strong>{formatarDataHora(confirmadaEm)}</strong>
          {via && ROTULO_VIA[via] ? ` ${ROTULO_VIA[via]}` : ""}.
        </p>
      ) : !colunaExiste ? (
        <p className="text-sm text-tinta-suave">O servidor ainda não registra confirmação de presença (migração 0051 pendente) — o que o cliente disser fica só no WhatsApp por enquanto.</p>
      ) : (
        <>
          <p className="text-sm text-tinta-suave">
            A régua pede a confirmação uma semana antes, por e-mail e WhatsApp, com um link de um toque. Se o cliente confirmar por telefone ou WhatsApp com a equipe, marque aqui.
          </p>
          <div className="nao-imprimir">
            <Botao variante="secundario" icone={ICONE_CHECK} onClick={() => setConfirmando(true)}>
              Marcar como confirmado (por telefone/WhatsApp)
            </Botao>
          </div>
        </>
      )}

      <ConfirmarAcao
        aberto={confirmando}
        titulo="Marcar presença como confirmada?"
        efeito={`Fica registrado que a EQUIPE confirmou a presença do cliente na sessão de ${formatarDataHora(agendamento.inicio_em)} — por telefone ou WhatsApp, não pelo link. O lembrete de confirmação pendente é cancelado e o registro não pode ser desfeito.`}
        rotuloConfirmar="Marcar como confirmado"
        confirmando={salvando}
        aoConfirmar={confirmar}
        aoCancelar={() => setConfirmando(false)}
      />
    </div>
  );
}
