"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { atualizarAgendamento, ApiError, type StatusAgendamento } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { formatarData, formatarDataHora, formatarHora } from "@/lib/formatar";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDaSessaoDoDia } from "@/lib/pasta/sinais";
import { derivarTrilho } from "@/lib/pasta/trilho";
import type { AgendamentoAgenda } from "@/types/agenda";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { Gaveta } from "@/components/ui/Gaveta";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { Trilho } from "@/components/ui/Trilho";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { confirmarPresencaPelaEquipe } from "./api-agendamentos";
import { FormularioAgendamento } from "./FormularioAgendamento";
import { SeloPresenca } from "./SeloPresenca";

/**
 * C23: `status='confirmado'` = o cliente ESCOLHEU o horário pelo link — não
 * "confirmou presença". Por isso os dois estados ativos viram "Horário
 * marcado" (com a origem), e a presença é o selo ao lado (`SeloPresenca`).
 */
const ROTULOS_STATUS: Record<StatusAgendamento, { rotulo: string; tom: TomSelo }> = {
  agendado: { rotulo: "Horário marcado", tom: "neutro" },
  confirmado: { rotulo: "Horário marcado pelo cliente", tom: "azul" },
  realizado: { rotulo: "Realizada", tom: "verde" },
  nao_compareceu: { rotulo: "Não compareceu", tom: "vermelho" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
  remarcado: { rotulo: "Remarcado", tom: "neutro" },
};

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

function temCampoPresenca(agendamento: AgendamentoAgenda): boolean {
  return Object.prototype.hasOwnProperty.call(agendamento, "presenca_confirmada_em");
}

/**
 * Uma linha da agenda (`<li>` — o pai fornece a `<ul>` com divisores).
 * Hora em destaque, pessoa, presença (fato), status do horário, o chip
 * "próximo passo · de quem" (a mesma função da Esteira/Painel) e as ações:
 * realizada · não compareceu · remarcar (Gaveta) · cancelar (confirmação)
 * · confirmar presença pela equipe (só quando a API já carrega o campo).
 * Toda ação termina em toast com o mesmo verbo do botão.
 */
export function LinhaAgendamento({
  agendamento,
  aoAtualizar,
  mostrarPessoa = false,
  mostrarData = true,
}: {
  agendamento: AgendamentoAgenda;
  aoAtualizar: () => void;
  mostrarPessoa?: boolean;
  /** `false` quando a lista já agrupa por dia (só a hora aparece). */
  mostrarData?: boolean;
}) {
  const { notificar } = useToast();
  const [remarcando, setRemarcando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState<null | "realizado" | "nao_compareceu" | "cancelado" | "presenca">(null);

  const ativo = agendamento.status === "agendado" || agendamento.status === "confirmado";
  // Uma leitura só do payload da agenda alimenta o próximo passo E a posição
  // no trilho. A linha da agenda não carrega execução nem croqui: os passos
  // que ela não sabe ficam "sem informação" — o compacto não inventa nada.
  const sinais = useMemo(() => sinaisDaSessaoDoDia({ ...agendamento, status: agendamento.status }), [agendamento]);
  const proximo = useMemo(() => derivarProximoPasso(sinais), [sinais]);
  const passos = useMemo(() => derivarTrilho(sinais), [sinais]);

  function mensagemErro(e: unknown, padrao: string): string {
    if (e instanceof ApiError) return e.status === 409 ? `Conflito: ${e.message}` : e.message;
    return padrao;
  }

  async function mudarStatus(status: "realizado" | "nao_compareceu" | "cancelado") {
    setOcupado(status);
    try {
      await atualizarAgendamento(agendamento.id, { status });
      notificar({
        tom: "sucesso",
        titulo: status === "realizado" ? "Marcada como realizada" : status === "nao_compareceu" ? "Marcada como não compareceu" : "Agendamento cancelado",
        descricao: agendamento.pessoa_nome ?? formatarDataHora(agendamento.inicio_em),
      });
      aoAtualizar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível atualizar o agendamento", descricao: mensagemErro(e, "Confira a internet e tente de novo.") });
    } finally {
      setOcupado(null);
      setCancelando(false);
    }
  }

  async function confirmarPresenca() {
    setOcupado("presenca");
    try {
      await confirmarPresencaPelaEquipe(agendamento.id);
      notificar({ tom: "sucesso", titulo: "Presença confirmada pela equipe", descricao: "Fica registrado que foi a equipe quem confirmou, não o cliente pelo link." });
      aoAtualizar();
    } catch (e) {
      const indisponivel = e instanceof ApiError && (e.status === 400 || e.status === 422 || e.status === 404);
      notificar({
        tom: "erro",
        titulo: indisponivel ? "Confirmar pela equipe ainda não está disponível" : "Não foi possível confirmar a presença",
        descricao: indisponivel ? "O servidor ainda não aceita este registro. Anote no WhatsApp por enquanto." : mensagemErro(e, "Confira a internet e tente de novo."),
      });
    } finally {
      setOcupado(null);
    }
  }

  const status = ROTULOS_STATUS[agendamento.status];
  const podeConfirmarPresenca = ativo && temCampoPresenca(agendamento) && !agendamento.presenca_confirmada_em;

  return (
    // `@container`: a linha decide seu próprio layout (coluna → linha) pela
    // LARGURA DO CARTÃO que a contém, não do viewport. Com `lg:` (viewport),
    // a 1280px de janela mas dentro da Ficha 360 (barra lateral fixa de
    // 288px), o cartão real mede ~900px e a linha virava horizontal mesmo
    // sem espaço, espremendo a coluna do meio (achado H, Fase 4).
    <li className="@container flex min-h-11 flex-col gap-3 px-5 py-4 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:px-6">
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start @3xl:gap-5">
        <div className="flex shrink-0 items-baseline gap-2 @3xl:w-28 @3xl:flex-col @3xl:gap-0">
          <time dateTime={agendamento.inicio_em} className="text-subtitulo font-bold tabular-nums text-tinta">
            {formatarHora(agendamento.inicio_em)}
          </time>
          <span className="text-xs text-tinta-suave">
            até {formatarHora(agendamento.fim_em)}
            {mostrarData ? ` · ${formatarData(agendamento.inicio_em)}` : ""}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {mostrarPessoa && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {agendamento.jornada_id ? (
                <Link href={`/jornadas/${agendamento.jornada_id}`} className="-my-2.5 inline-flex min-h-11 items-center text-sm font-bold text-tinta underline-offset-2 hover:text-[color:var(--latao)] hover:underline">
                  {agendamento.pessoa_nome ?? "Pessoa sem nome"}
                </Link>
              ) : (
                <span className="text-sm font-bold text-tinta">{agendamento.pessoa_nome ?? "Pessoa sem nome"}</span>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {ativo && <SeloPresenca presencaConfirmadaEm={agendamento.presenca_confirmada_em} inicioEm={agendamento.inicio_em} via={agendamento.presenca_confirmada_via} />}
            <Selo tom={status.tom}>{status.rotulo}</Selo>
          </div>
          {ativo && <Trilho passos={passos} variante="compacto" rotulo={`Trilho de ${agendamento.pessoa_nome ?? "cliente"}`} className="max-w-sm" />}
          {ativo && <ChipProximoPasso proximo={proximo} jornadaId={agendamento.jornada_id} tamanho="compacto" />}
        </div>

        {ativo && (
          // Lei de texto §2 ("um verbo por cartão"): a linha tinha CINCO
          // botões — 8 palavras de ação repetidas em cada sessão da agenda.
          // Ficam à vista o verbo do momento (confirmar presença enquanto
          // ninguém confirmou) e "Realizada", que é o que se clica no dia. O
          // resto entra num `<details>` nativo: teclado, Esc e leitor de tela
          // funcionam sem JS, e nada foi removido.
          <div className="nao-imprimir flex flex-wrap items-start gap-2 @3xl:w-80 @3xl:shrink-0 @3xl:justify-end">
            {podeConfirmarPresenca && (
              <Botao variante="secundario" tamanho="compacto" icone={ICONE_CHECK} carregando={ocupado === "presenca"} disabled={ocupado !== null && ocupado !== "presenca"} onClick={confirmarPresenca}>
                Confirmar presença
              </Botao>
            )}
            <Botao variante="secundario" tamanho="compacto" carregando={ocupado === "realizado"} disabled={ocupado !== null && ocupado !== "realizado"} onClick={() => mudarStatus("realizado")}>
              Realizada
            </Botao>
            <details className="relative">
              <summary
                aria-label={`Mais ações para ${agendamento.pessoa_nome ?? "esta sessão"}`}
                className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-controle border border-linha-forte bg-papel-elevado px-3 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] marker:content-none hover:border-[color:var(--latao)]"
              >
                Mais
              </summary>
              <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col gap-1 rounded-controle border border-linha-forte bg-papel-elevado p-2 shadow-flutuante">
                <Botao variante="fantasma" tamanho="compacto" carregando={ocupado === "nao_compareceu"} disabled={ocupado !== null && ocupado !== "nao_compareceu"} onClick={() => mudarStatus("nao_compareceu")}>
                  Não compareceu
                </Botao>
                <Botao variante="fantasma" tamanho="compacto" disabled={ocupado !== null} onClick={() => setRemarcando(true)}>
                  Remarcar
                </Botao>
                <Botao variante="perigo" tamanho="compacto" disabled={ocupado !== null} onClick={() => setCancelando(true)}>
                  Cancelar
                </Botao>
              </div>
            </details>
          </div>
        )}
      </div>

      <Gaveta
        aberta={remarcando}
        aoFechar={() => setRemarcando(false)}
        rotulo={agendamento.pessoa_nome ?? "Agendamento"}
        titulo="Remarcar a sessão"
        descricao={`Hoje está marcada para ${formatarDataHora(agendamento.inicio_em)}. O horário antigo é liberado e as mensagens automáticas recomeçam.`}
      >
        <FormularioAgendamento
          rotuloConfirmar="Remarcar"
          aoCancelar={() => setRemarcando(false)}
          aoSalvar={async (inicioIso, fimIso) => {
            await atualizarAgendamento(agendamento.id, { inicio_em: inicioIso, fim_em: fimIso });
            setRemarcando(false);
            notificar({ tom: "sucesso", titulo: `Remarcada para ${formatarDataHora(inicioIso)}`, descricao: agendamento.pessoa_nome });
            aoAtualizar();
          }}
        />
      </Gaveta>

      <ConfirmarAcao
        aberto={cancelando}
        titulo="Cancelar este agendamento?"
        efeito={`A sessão de ${formatarDataHora(agendamento.inicio_em)}${agendamento.pessoa_nome ? ` com ${agendamento.pessoa_nome}` : ""} sai da agenda e as mensagens automáticas pendentes são canceladas. Para marcar outra data, use “Remarcar”.`}
        perigo
        rotuloConfirmar="Cancelar agendamento"
        rotuloCancelar="Manter"
        confirmando={ocupado === "cancelado"}
        aoConfirmar={() => mudarStatus("cancelado")}
        aoCancelar={() => setCancelando(false)}
      />
    </li>
  );
}
