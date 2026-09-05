"use client";

import { useCallback, useMemo, useState } from "react";
import type { HorarioConfirmadoPublico, SlotAgendamentoPublico } from "@/types/publico-ui";
import { abrirLinkAgendamento, conferirTipo, ErroLinkPublico, escolherHorarioPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { BotaoPublico, CartaoPublico, ContatoEquipe, IconeFeito, RotuloPublico } from "@/components/publico/atomos";
import { chaveDoDia, formatarDiaPorExtenso, formatarHoraSimples } from "@/components/publico/datas";

function agruparPorDia(slots: SlotAgendamentoPublico[]): { chave: string; rotulo: string; slots: SlotAgendamentoPublico[] }[] {
  const mapa = new Map<string, SlotAgendamentoPublico[]>();
  for (const slot of slots) {
    const chave = chaveDoDia(slot.inicio_em);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(slot);
  }
  return Array.from(mapa.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, slots]) => ({ chave, rotulo: formatarDiaPorExtenso(slots[0].inicio_em), slots }));
}

function TelaConfirmado({ horario, podeRemarcar, aoRemarcar }: { horario: HorarioConfirmadoPublico; podeRemarcar: boolean; aoRemarcar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center" aria-live="polite">
      <IconeFeito />
      <div className="flex flex-col gap-2">
        <RotuloPublico>Sessão de Viabilidade</RotuloPublico>
        <h1 className="text-tinta">Sessão confirmada</h1>
        <p className="text-subtitulo font-bold text-tinta">
          {formatarDiaPorExtenso(horario.inicio_em)} às {formatarHoraSimples(horario.inicio_em)}
        </p>
        <p className="text-sm text-tinta-suave">Horário de São Paulo · o link da sala chega no seu e-mail no dia.</p>
      </div>
      {podeRemarcar ? (
        <BotaoPublico variante="secundario" onClick={aoRemarcar}>
          Preciso remarcar
        </BotaoPublico>
      ) : (
        <ContatoEquipe antes="Precisa mudar o horário?" />
      )}
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
      <CartaoPublico className="flex flex-col items-center gap-3 text-center">
        <p className="max-w-sm text-tinta-suave">Não há mais horários abertos neste link no momento.</p>
        <ContatoEquipe antes="Para receber novas opções:" />
      </CartaoPublico>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-tinta-suave">Toque num horário. Todos estão no fuso de São Paulo.</p>

      <div className="flex flex-col gap-5">
        {diasAtuais.map((dia) => (
          <CartaoPublico key={dia.chave} como="section" className="flex flex-col gap-3">
            <h2 className="text-subtitulo font-bold text-tinta">{dia.rotulo}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {dia.slots.map((slot) => {
                const ativo = selecionado?.inicio_em === slot.inicio_em;
                return (
                  <button
                    key={slot.inicio_em}
                    type="button"
                    onClick={() => setSelecionado(slot)}
                    aria-pressed={ativo}
                    className={`flex min-h-[3.25rem] flex-col items-center justify-center rounded-controle border-2 px-2 py-2 text-base font-bold transition-colors duration-[var(--transicao-rapida)] ${
                      ativo ? "border-[color:var(--latao-cta)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel text-tinta hover:border-[color:var(--latao-cta)]"
                    }`}
                  >
                    {formatarHoraSimples(slot.inicio_em)}
                    {slot.motivo_sugestao && slot.posicao === 1 && <span className="text-legenda font-medium uppercase text-tinta-suave">Recomendado</span>}
                  </button>
                );
              })}
            </div>
          </CartaoPublico>
        ))}
      </div>

      {erro && (
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <BotaoPublico variante="primario" largo onClick={confirmar} disabled={!selecionado} carregando={confirmando}>
        {confirmando ? "Confirmando…" : selecionado ? `Confirmar ${formatarDiaPorExtenso(selecionado.inicio_em)} às ${formatarHoraSimples(selecionado.inicio_em)}` : "Escolha um horário acima"}
      </BotaoPublico>
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
      <div className="flex flex-col gap-2">
        <RotuloPublico>Sessão de Viabilidade</RotuloPublico>
        <h1 className="text-tinta">Olá, {abertura.primeiro_nome}</h1>
        <p className="text-tinta-suave">Escolha o melhor horário para a sua sessão com a Dra. Elaine Montenegro.</p>
      </div>
      <SeletorDeHorario token={token} slots={abertura.payload.slots} aoConfirmar={setConfirmadoLocal} />
    </div>
  );
}
