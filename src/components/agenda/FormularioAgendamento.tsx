"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";

/** Converte datetime-local (sem fuso) assumindo horário local do navegador, que é o do escritório. */
function paraIso(dataHoraLocal: string): string {
  return new Date(dataHoraLocal).toISOString();
}

export function FormularioAgendamento({
  aoSalvar,
  aoCancelar,
  valorInicial,
}: {
  aoSalvar: (inicioIso: string, fimIso: string) => Promise<void>;
  aoCancelar: () => void;
  valorInicial?: { inicio: string; fim: string };
}) {
  const [inicio, setInicio] = useState(valorInicial?.inicio ?? "");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!inicio) {
      setErro("Informe data e hora de início.");
      return;
    }
    const inicioData = new Date(inicio);
    const fimData = new Date(inicioData.getTime() + duracaoMin * 60000);
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar(paraIso(inicio), fimData.toISOString());
    } catch (e) {
      // 409 do banco (exclusion constraint) ou da regra de sobreposição — mensagem legível.
      setErro(e instanceof ApiError ? (e.status === 409 ? `Conflito de horário: ${e.message}` : e.message) : "Não foi possível salvar o agendamento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Início
          <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Duração
          <select value={duracaoMin} onChange={(e) => setDuracaoMin(Number(e.target.value))} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5">
            <option value={30}>30 min</option>
            <option value={60}>1 hora</option>
            <option value={90}>1h30</option>
          </select>
        </label>
      </div>
      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      <div className="flex gap-2">
        <Botao variante="primario" carregando={salvando} onClick={confirmar}>Confirmar</Botao>
        <Botao variante="fantasma" onClick={aoCancelar}>Cancelar</Botao>
      </div>
    </div>
  );
}
