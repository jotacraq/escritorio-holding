"use client";

import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { ROTULO_DIA_SEMANA } from "./rotulos";
import { ApiError, criarDisponibilidade } from "./api";

/**
 * Cria uma janela recorrente. `duracao_minutos` fica vazio por padrão de
 * propósito (BLOQUEIO B12): sem valor aqui, o servidor lê
 * `configuracoes.agenda.duracao_padrao_minutos` — nunca uma constante fixa
 * no front. O campo existe só para quem quiser uma duração diferente desta
 * janela específica.
 */
export function FormularioDisponibilidade({
  advogadaId,
  aoCriar,
}: {
  advogadaId: string;
  aoCriar: () => void;
}) {
  const [diaSemana, setDiaSemana] = useState(1);
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFim, setHoraFim] = useState("18:00");
  const [duracaoMinutos, setDuracaoMinutos] = useState("");
  const [valeDe, setValeDe] = useState(() => new Date().toISOString().slice(0, 10));
  const [valeAte, setValeAte] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    if (horaFim <= horaInicio) {
      setErro("O horário final precisa ser depois do inicial.");
      return;
    }
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
      aoCriar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar esta janela.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-dia">
          Dia da semana
          <select
            id="disp-dia"
            value={diaSemana}
            onChange={(e) => setDiaSemana(Number(e.target.value))}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
          >
            {ROTULO_DIA_SEMANA.map((rotulo, indice) => (
              <option key={rotulo} value={indice}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-inicio">
          Início
          <input id="disp-inicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-fim">
          Fim
          <input id="disp-fim" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-duracao">
          Duração da sessão (min)
          <input
            id="disp-duracao"
            type="number"
            min={1}
            max={480}
            placeholder="valor padrão do sistema"
            value={duracaoMinutos}
            onChange={(e) => setDuracaoMinutos(e.target.value)}
            className="w-40 rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
            aria-describedby="disp-duracao-ajuda"
          />
        </label>
      </div>
      <p id="disp-duracao-ajuda" className="text-xs text-tinta-fraca">
        Deixe em branco para usar o valor padrão configurado no sistema. Esse padrão é um VALOR INICIAL — não vem do
        método da Dra. Elaine — e é ajustável em Admin sem precisar mexer em código.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-vale-de">
          Vale a partir de
          <input id="disp-vale-de" type="date" value={valeDe} onChange={(e) => setValeDe(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="disp-vale-ate">
          Vale até (opcional)
          <input id="disp-vale-ate" type="date" value={valeAte} onChange={(e) => setValeAte(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <Botao variante="primario" carregando={salvando} onClick={salvar}>
          Adicionar janela
        </Botao>
      </div>
      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
    </div>
  );
}
