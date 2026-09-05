"use client";

import { useState } from "react";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ROTULO_DIA_SEMANA } from "./rotulos";
import { ApiError, criarDisponibilidade } from "./api";

/**
 * Cria uma janela recorrente. `duracao_minutos` fica vazio por padrão de
 * propósito (BLOQUEIO B12): sem valor aqui, o servidor lê
 * `configuracoes.agenda.duracao_padrao_minutos` — nunca uma constante fixa
 * no front. O campo existe só para quem quiser uma duração diferente desta
 * janela específica.
 */
export function FormularioDisponibilidade({ advogadaId, aoCriar }: { advogadaId: string; aoCriar: () => void }) {
  const { notificar } = useToast();
  const [diaSemana, setDiaSemana] = useState(1);
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFim, setHoraFim] = useState("18:00");
  const [duracaoMinutos, setDuracaoMinutos] = useState("");
  const [valeDe, setValeDe] = useState(() => new Date().toISOString().slice(0, 10));
  const [valeAte, setValeAte] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroHora, setErroHora] = useState<string | null>(null);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (horaFim <= horaInicio) {
      setErroHora("O horário final precisa ser depois do inicial.");
      return;
    }
    setErroHora(null);
    setSalvando(true);
    try {
      await criarDisponibilidade({
        advogada_id: advogadaId,
        dia_semana: diaSemana,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
        duracao_minutos: duracaoMinutos ? Number(duracaoMinutos) : undefined,
        vale_de: valeDe || undefined,
        vale_ate: valeAte || undefined,
      });
      setDuracaoMinutos("");
      setValeAte("");
      notificar({ tom: "sucesso", titulo: "Janela adicionada", descricao: `${ROTULO_DIA_SEMANA[diaSemana]}, ${horaInicio} às ${horaFim}` });
      aoCriar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível adicionar a janela", descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao como="div" rotulo="Nova janela" titulo="Adicionar horário livre recorrente" descricao="Toda semana, neste dia e neste intervalo, a advogada atende. É daqui que saem as opções do link de agendamento.">
      <form noValidate onSubmit={salvar} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Campo rotulo="Dia da semana" id="disp-dia">
            <Selecao value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))}>
              {ROTULO_DIA_SEMANA.map((rotulo, indice) => (
                <option key={rotulo} value={indice}>
                  {rotulo}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Início" id="disp-inicio">
            <Entrada type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </Campo>
          <Campo rotulo="Fim" id="disp-fim" erro={erroHora}>
            <Entrada type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} onBlur={() => horaFim > horaInicio && setErroHora(null)} />
          </Campo>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Campo rotulo="Duração da sessão" id="disp-duracao" extra="opcional" ajuda="Em minutos. Em branco, vale o padrão configurado em Admin (é um valor inicial, ajustável sem código).">
            <Entrada type="number" min={1} max={480} inputMode="numeric" placeholder="padrão do sistema" value={duracaoMinutos} onChange={(e) => setDuracaoMinutos(e.target.value)} />
          </Campo>
          <Campo rotulo="Vale a partir de" id="disp-vale-de">
            <Entrada type="date" value={valeDe} onChange={(e) => setValeDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Vale até" id="disp-vale-ate" extra="opcional">
            <Entrada type="date" value={valeAte} onChange={(e) => setValeAte(e.target.value)} />
          </Campo>
        </div>
        <div className="flex justify-end">
          <Botao type="submit" variante="primario" carregando={salvando}>
            Adicionar janela
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
