"use client";

import { useState } from "react";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import type { LigacaoIaResumo, Tarefa } from "@/types/banco";
import type { LigacaoIa } from "@/types/integracoes";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { Selo, SeloStub, type TomSelo } from "@/components/ui/Selo";
import { ErroFicha360Api } from "./api";
import { cancelarLigacaoIa, ligarPorIaAgora, listarLigacoesIa } from "./api-ligacoes-ia";

type Status = LigacaoIaResumo["status"];

/** Os 7 estados da máquina (0053) em português de gente — nunca a chave crua. */
const ESTADO: Record<Status, { rotulo: string; tom: TomSelo; explicacao: string }> = {
  na_fila: { rotulo: "Na fila para ligar", tom: "azul", explicacao: "A ligação foi pedida e sai na próxima rodada da régua (a cada 15 minutos)." },
  discando: { rotulo: "Discando", tom: "azul", explicacao: "A integração recebeu o pedido e está chamando o cliente agora." },
  em_ligacao: { rotulo: "Em ligação", tom: "latao", explicacao: "O cliente atendeu — a IA está oferecendo os horários." },
  concluida: { rotulo: "Ligação concluída", tom: "verde", explicacao: "A ligação terminou; veja o resultado abaixo." },
  sem_resposta: { rotulo: "Não atendeu", tom: "ambar", explicacao: "O cliente não atendeu. O sistema tenta de novo pela régua; esgotadas as tentativas, envia o link de agendamento por mensagem." },
  falhou: { rotulo: "Falhou", tom: "vermelho", explicacao: "A ligação não aconteceu. Esgotadas as tentativas, o link de agendamento sai por e-mail e WhatsApp (fila manual)." },
  cancelada: { rotulo: "Cancelada", tom: "neutro", explicacao: "Cancelada pela equipe antes de acontecer." },
};

const RESULTADO: Record<NonNullable<LigacaoIaResumo["resultado"]>, string> = {
  agendou: "Agendou a sessão",
  recusou: "Recusou marcar agora",
  pediu_retorno: "Pediu para ligar depois",
  caixa_postal: "Caiu na caixa postal",
  numero_invalido: "Número inválido",
  manual: "Virou tarefa para a equipe ligar",
};

const ICONE_TELEFONE = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
    <path d="M6.8 3.1c.6-.6 1.6-.5 2 .2l1.1 1.7c.4.6.3 1.4-.2 1.9l-.7.7c.6 1.2 1.6 2.2 2.8 2.8l.7-.7c.5-.5 1.3-.6 1.9-.2l1.7 1.1c.7.4.8 1.4.2 2l-.8.8c-.6.6-1.5.9-2.3.6-4-1.2-6.2-3.4-7.4-7.4-.3-.8 0-1.7.6-2.3l.4-.3z" />
  </svg>
);

/**
 * Ligação por IA (Fase 4 §2.4, agente B): a IA liga para o cliente, oferece
 * o melhor horário da equipe + 3 alternativas e o agendamento cai no
 * sistema. Este cartão mostra a última ligação (`ligacaoIaAtual`, sem
 * transcrição — LGPD), o botão "Ligar por IA agora" (sempre disponível,
 * B33), cancelar enquanto ainda não atendeu, e o histórico sob demanda —
 * sem polling: quem quiser o estado novo recarrega a Ficha.
 */
export function SessaoLigacaoIa({
  jornadaId,
  ligacao,
  disponivel,
  tarefaLigarAberta,
  temAgendamentoAtivo,
  aoAtualizar,
}: {
  jornadaId: string;
  ligacao: LigacaoIaResumo | null;
  /** `false` = a Ficha ainda não carrega `ligacoes_ia` (tabela 0053 ausente). */
  disponivel: boolean;
  /** Tarefa `ligar_para_agendar` aberta (provedor manual) — a equipe liga. */
  tarefaLigarAberta: Tarefa | null;
  temAgendamentoAtivo: boolean;
  aoAtualizar: () => void;
}) {
  const { notificar } = useToast();
  const [ligando, setLigando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [historico, setHistorico] = useState<LigacaoIa[] | null>(null);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  const ativa = ligacao && (ligacao.status === "na_fila" || ligacao.status === "discando" || ligacao.status === "em_ligacao");
  const cancelavel = ligacao && (ligacao.status === "na_fila" || ligacao.status === "discando");

  async function ligar() {
    setLigando(true);
    try {
      const res = await ligarPorIaAgora(jornadaId);
      if (res.aviso) {
        notificar({ tom: "aviso", titulo: "Ligação registrada, com aviso", descricao: res.aviso, duracao: 10000 });
      } else {
        notificar({ tom: "sucesso", titulo: "Ligação por IA pedida", descricao: "A IA vai ligar agora e oferecer os horários da equipe. Recarregue a ficha para ver o resultado." });
      }
      aoAtualizar();
    } catch (e) {
      const erro = e instanceof ErroFicha360Api ? e : null;
      notificar({
        tom: "erro",
        titulo: erro?.status === 503 ? "Ligação por IA não configurada" : erro?.status === 409 ? "Já existe uma ligação em andamento" : "Não foi possível pedir a ligação",
        descricao:
          erro?.status === 503
            ? "Integração não configurada no servidor: faltam N8N_WEBHOOK_LIGACAO_URL e LIGACAO_IA_WEBHOOK_SECRET (ou a chave de serviço). Enquanto isso, ligue pela equipe e registre a Ligação Estratégica."
            : erro?.message ?? "Confira a internet e tente de novo.",
      });
    } finally {
      setLigando(false);
    }
  }

  async function cancelar() {
    if (!ligacao) return;
    setCancelando(true);
    try {
      await cancelarLigacaoIa(ligacao.id);
      notificar({ tom: "sucesso", titulo: "Ligação cancelada" });
      setConfirmandoCancelar(false);
      aoAtualizar();
    } catch (e) {
      const erro = e instanceof ErroFicha360Api ? e : null;
      notificar({
        tom: "erro",
        titulo: erro?.codigo === "ligacao_nao_cancelavel" ? "A ligação já mudou de estado" : "Não foi possível cancelar",
        descricao: erro?.codigo === "ligacao_nao_cancelavel" ? "Ela já foi atendida ou encerrada — recarregue a ficha para ver o resultado." : erro?.message ?? "Confira a internet e tente de novo.",
      });
    } finally {
      setCancelando(false);
    }
  }

  async function alternarHistorico() {
    if (mostrarHistorico) {
      setMostrarHistorico(false);
      return;
    }
    setMostrarHistorico(true);
    if (historico !== null) return;
    setCarregandoHistorico(true);
    try {
      setHistorico(await listarLigacoesIa(jornadaId));
    } catch (e) {
      setHistorico([]);
      notificar({ tom: "erro", titulo: "Não foi possível carregar o histórico de ligações", descricao: e instanceof ErroFicha360Api ? e.message : "Tente de novo em instantes." });
    } finally {
      setCarregandoHistorico(false);
    }
  }

  if (!disponivel) {
    return (
      <div className="flex flex-col gap-3">
        <SeloStub texto="Ligação por IA ainda não disponível — a tabela de ligações (migração 0053) não foi aplicada neste ambiente." />
        <p className="text-sm text-tinta-suave">Enquanto isso, a equipe liga e registra a Ligação Estratégica (POP 03) na Pasta do Cliente.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {ligacao ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom={ESTADO[ligacao.status].tom} icone={ICONE_TELEFONE}>
              {ESTADO[ligacao.status].rotulo}
            </Selo>
            <Selo tom="neutro">tentativa {ligacao.tentativa}</Selo>
            {ligacao.provedor === "manual" && <Selo tom="ambar">sem integração — manual</Selo>}
            <span className="text-xs text-tinta-suave">
              {ligacao.encerrada_em ? `encerrada ${formatarRelativo(ligacao.encerrada_em)}` : ligacao.disparada_em ? `disparada ${formatarRelativo(ligacao.disparada_em)}` : `pedida ${formatarRelativo(ligacao.criado_em)}`}
            </span>
          </div>
          <p className="text-sm text-tinta-suave">{ESTADO[ligacao.status].explicacao}</p>
          {ligacao.resultado && (
            <p className="text-sm text-tinta">
              <strong>Resultado:</strong> {RESULTADO[ligacao.resultado]}
              {ligacao.horario_escolhido && (
                <>
                  {" "}
                  — horário escolhido: <strong>{formatarDataHora(ligacao.horario_escolhido)}</strong>
                </>
              )}
            </p>
          )}
          {ligacao.resumo && <p className="rounded-controle border-l-4 border-l-[color:var(--latao-cta)] bg-papel px-3.5 py-2.5 text-sm text-tinta">{ligacao.resumo}</p>}
          {ligacao.erro && (
            <p role="status" className="text-sm text-[color:var(--vermelho)]">
              Motivo registrado: {ligacao.erro}
            </p>
          )}
          {(ligacao.status === "falhou" || ligacao.status === "sem_resposta") && (
            <p className="rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
              Fallback da esteira: quando as tentativas se esgotam, o link de agendamento é enviado por mensagem (e-mail automático; WhatsApp entra na fila de Comunicação). Confira lá se já saiu.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">
          Nenhuma ligação por IA pedida para este cliente.
          {temAgendamentoAtivo ? " A sessão já tem horário marcado — a ligação por IA serve para quem ainda não agendou." : " A IA liga, oferece o melhor horário da equipe e mais três alternativas, e o agendamento cai no sistema."}
        </p>
      )}

      {tarefaLigarAberta && (
        <div className="rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
          <p className="font-bold">Tarefa aberta para a equipe: ligar para agendar</p>
          <p>
            Sem integração de voz configurada, a ligação virou tarefa humana{tarefaLigarAberta.vence_em ? ` (vence ${formatarRelativo(tarefaLigarAberta.vence_em)})` : ""}. Ligue, registre a Ligação Estratégica e marque o horário na agenda.
          </p>
        </div>
      )}

      <div className="nao-imprimir flex flex-wrap gap-2">
        {!ativa && (
          <Botao variante={temAgendamentoAtivo ? "secundario" : "primario"} icone={ICONE_TELEFONE} carregando={ligando} onClick={ligar}>
            Ligar por IA agora
          </Botao>
        )}
        {cancelavel && (
          <Botao variante="perigo" onClick={() => setConfirmandoCancelar(true)} disabled={cancelando}>
            Cancelar ligação
          </Botao>
        )}
        <Botao variante="fantasma" onClick={alternarHistorico} aria-expanded={mostrarHistorico}>
          {mostrarHistorico ? "Ocultar histórico" : "Ver histórico de ligações"}
        </Botao>
      </div>

      {mostrarHistorico && (
        <div className="flex flex-col gap-2 border-t border-linha pt-3">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Histórico de ligações por IA</p>
          {carregandoHistorico ? (
            <EsqueletoLista linhas={2} rotulo="Carregando o histórico…" />
          ) : !historico || historico.length === 0 ? (
            <p className="text-sm text-tinta-suave">Nenhuma ligação registrada.</p>
          ) : (
            <ul className="divide-y divide-linha">
              {historico.map((item) => (
                <li key={item.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <Selo tom={ESTADO[item.status].tom}>{ESTADO[item.status].rotulo}</Selo>
                  <span className="text-tinta">tentativa {item.tentativa}</span>
                  <span className="text-tinta-suave">{formatarDataHora(item.criado_em)}</span>
                  {item.resultado && <span className="text-tinta">{RESULTADO[item.resultado]}</span>}
                  {item.nao_antes_de && !item.encerrada_em && <span className="text-tinta-suave">próxima tentativa não antes de {formatarDataHora(item.nao_antes_de)}</span>}
                  {item.duracao_segundos != null && <span className="text-tinta-suave">{Math.round(item.duracao_segundos / 60)} min</span>}
                  {item.custo_usd != null && <span className="text-tinta-suave">custo US$ {item.custo_usd.toFixed(2)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmandoCancelar}
        titulo="Cancelar a ligação por IA?"
        efeito="A ligação sai da fila e não acontece. Se a integração já estiver discando, a chamada em curso não é derrubada — só o resultado dela é ignorado. Para ligar de novo, use “Ligar por IA agora”."
        rotuloConfirmar="Cancelar ligação"
        rotuloCancelar="Manter"
        perigo
        confirmando={cancelando}
        aoConfirmar={cancelar}
        aoCancelar={() => setConfirmandoCancelar(false)}
      />
    </div>
  );
}
