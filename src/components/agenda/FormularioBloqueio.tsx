"use client";

import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { ApiError, criarBloqueio } from "./api";

function paraIso(dataHoraLocal: string): string {
  return new Date(dataHoraLocal).toISOString();
}

/** Exceção pontual (folga, feriado, compromisso) — nunca mexe nas janelas
 * recorrentes, só cobre o período informado. */
export function FormularioBloqueio({ advogadaId, aoCriar }: { advogadaId: string; aoCriar: () => void }) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    if (!inicio || !fim) {
      setErro("Informe início e fim do bloqueio.");
      return;
    }
    if (!motivo.trim()) {
      setErro("Informe o motivo do bloqueio.");
      return;
    }
    if (new Date(fim) <= new Date(inicio)) {
      setErro("O fim precisa ser depois do início.");
      return;
    }
    setSalvando(true);
    try {
      await criarBloqueio({ advogada_id: advogadaId, inicio_em: paraIso(inicio), fim_em: paraIso(fim), motivo: motivo.trim() });
      setInicio("");
      setFim("");
      setMotivo("");
      aoCriar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar este bloqueio.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="bloq-inicio">
          De
          <input id="bloq-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="bloq-fim">
          Até
          <input id="bloq-fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5" />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm" htmlFor="bloq-motivo">
          Motivo
          <input
            id="bloq-motivo"
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Folga, feriado, compromisso…"
            maxLength={500}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
          />
        </label>
        <Botao variante="primario" carregando={salvando} onClick={salvar}>
          Bloquear
        </Botao>
      </div>
      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
    </div>
  );
}
