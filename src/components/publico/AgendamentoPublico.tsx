"use client";

import { useCallback, useMemo, useState } from "react";
import type { HorarioConfirmadoPublico, SlotAgendamentoPublico } from "@/types/publico-ui";
import { abrirLinkAgendamento, conferirTipo, ErroLinkPublico, escolherHorarioPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";

const FUSO = "America/Sao_Paulo";

/** "terça, 14 de setembro" — sem ano (a janela é sempre próxima) e sempre por extenso, nunca "14/09". */
function formatarDiaPorExtenso(iso: string): string {
  const data = new Date(iso);
  const texto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" }).format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarHoraSimples(iso: string): string {
  const data = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(data);
}

function agruparPorDia(slots: SlotAgendamentoPublico[]): { chave: string; rotulo: string; slots: SlotAgendamentoPublico[] }[] {
  const mapa = new Map<string, SlotAgendamentoPublico[]>();
  for (const slot of slots) {
    const chave = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(slot.inicio_em));
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(slot);
  }
  return Array.from(mapa.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, slots]) => ({ chave, rotulo: formatarDiaPorExtenso(slots[0].inicio_em), slots }));
}

function TelaConfirmado({ horario, podeRemarcar, aoRemarcar }: { horario: HorarioConfirmadoPublico; podeRemarcar: boolean; aoRemarcar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-11 w-11 fill-none stroke-[color:var(--verde)] stroke-2">
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
      </svg>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-xl font-bold text-tinta">Sessão confirmada</h1>
        <p className="text-lg font-medium text-tinta">
          {formatarDiaPorExtenso(horario.inicio_em)} às {formatarHoraSimples(horario.inicio_em)}
        </p>
        <p className="text-sm text-tinta-suave">Horário de São Paulo.</p>
      </div>
      {podeRemarcar && (
        <button type="button" onClick={aoRemarcar} className="rounded-md border border-linha-forte bg-papel-elevado px-5 py-3 text-base font-medium text-tinta hover:bg-papel">
          Preciso remarcar
        </button>
      )}
      {!podeRemarcar && <p className="max-w-xs text-sm text-tinta-suave">Precisa mudar o horário? Fale com a equipe da Dra. Elaine.</p>}
    </div>
  );
}

function SeletorDeHorario({ token, slots, aoConfirmar }: { token: string; slots: SlotAgendamentoPublico[]; aoConfirmar: (h: HorarioConfirmadoPublico) => void }) {
  const [selecionado, setSelecionado] = useState<SlotAgendamentoPublico | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [slotsAtuais, setSlotsAtuais] = useState(slots);

  const diasAtuais = useMemo(() => agruparPorDia(slotsAtuais), [slotsAtuais]);

  async function confirmar() {
    if (!selecionado) return;
    setConfirmando(true);
    setErro(null);
    try {
      const resposta = await escolherHorarioPublico(token, { inicio_em: selecionado.inicio_em });
      aoConfirmar(resposta.horario_confirmado);
    } catch (e) {
      if (e instanceof ErroLinkPublico && e.codigo === "horario_indisponivel") {
        setErro("Esse horário acabou de ser preenchido por outra pessoa. Aqui estão os que ainda estão abertos.");
        setSelecionado(null);
        setSlotsAtuais((atual) => atual.filter((s) => s.inicio_em !== selecionado.inicio_em));
      } else if (e instanceof ErroLinkPublico && e.codigo === "limite_excedido") {
        setErro("Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.");
      } else {
        setErro("Não foi possível confirmar agora. Tente de novo em instantes.");
      }
    } finally {
      setConfirmando(false);
    }
  }

  if (diasAtuais.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="max-w-sm text-tinta-suave">
          Não há mais horários abertos neste link no momento. Fale com a equipe da Dra. Elaine para receber novas opções.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-tinta-suave">Escolha um horário. Todos os horários abaixo estão no fuso de São Paulo.</p>

      <div className="flex flex-col gap-5">
        {diasAtuais.map((dia) => (
          <div key={dia.chave} className="flex flex-col gap-2.5">
            <h2 className="font-serif text-base font-bold text-tinta">{dia.rotulo}</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {dia.slots.map((slot) => (
                <button
                  key={slot.inicio_em}
                  type="button"
                  onClick={() => setSelecionado(slot)}
                  aria-pressed={selecionado?.inicio_em === slot.inicio_em}
                  className={`rounded-md border py-3 text-base font-medium ${
                    selecionado?.inicio_em === slot.inicio_em
                      ? "border-[color:var(--latao)] bg-latao-fraco text-tinta"
                      : "border-linha-forte bg-papel-elevado text-tinta hover:bg-papel"
                  }`}
                >
                  {formatarHoraSimples(slot.inicio_em)}
                  {slot.motivo_sugestao && slot.posicao === 1 && <span className="mt-0.5 block text-[11px] font-normal text-tinta-suave">Recomendado</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {erro && (
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <button
        type="button"
        onClick={confirmar}
        disabled={!selecionado || confirmando}
        aria-busy={confirmando}
        className="rounded-md bg-[color:var(--latao)] py-3 text-base font-bold text-tinta disabled:cursor-not-allowed disabled:opacity-40"
      >
        {confirmando ? "Confirmando…" : selecionado ? `Confirmar ${formatarDiaPorExtenso(selecionado.inicio_em)} às ${formatarHoraSimples(selecionado.inicio_em)}` : "Escolha um horário acima"}
      </button>
    </div>
  );
}

export function AgendamentoPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkAgendamento(token).then((res) => conferirTipo(res, "agendamento")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);
  const [remarcando, setRemarcando] = useState(false);
  const [confirmadoLocal, setConfirmadoLocal] = useState<HorarioConfirmadoPublico | null>(null);

  if (carregando) return <CarregandoPublico />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido") return <TelaLinkInvalido />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  const horarioConfirmado = confirmadoLocal ?? abertura.payload.horario_confirmado;

  if (horarioConfirmado && !remarcando) {
    return <TelaConfirmado horario={horarioConfirmado} podeRemarcar={horarioConfirmado.pode_remarcar} aoRemarcar={() => setRemarcando(true)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-xl font-bold text-tinta">Olá, {abertura.primeiro_nome}</h1>
        <p className="mt-1 text-tinta-suave">Escolha o melhor horário para sua Sessão de Viabilidade.</p>
      </div>
      <SeletorDeHorario token={token} slots={abertura.payload.slots} aoConfirmar={setConfirmadoLocal} />
    </div>
  );
}
