"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";

/** Converte datetime-local (sem fuso) assumindo horário local do navegador, que é o do escritório. */
function paraIso(dataHoraLocal: string): string {
  return new Date(dataHoraLocal).toISOString();
}

/**
 * Início + duração → `inicio_em`/`fim_em`. Usado pela Agenda (dentro da
 * Gaveta de remarcar) e pela Ficha 360 (`SessaoAba`, inline) — a assinatura
 * é a mesma de antes. Validação em submit; erro humano ligado ao campo.
 */
export function FormularioAgendamento({
  aoSalvar,
  aoCancelar,
  valorInicial,
  rotuloConfirmar = "Confirmar horário",
}: {
  aoSalvar: (inicioIso: string, fimIso: string) => Promise<void>;
  aoCancelar: () => void;
  valorInicial?: { inicio: string; fim: string };
  rotuloConfirmar?: string;
}) {
  const [inicio, setInicio] = useState(valorInicial?.inicio ?? "");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [salvando, setSalvando] = useState(false);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!inicio) {
      setErroInicio("Informe a data e a hora de início.");
      return;
    }
    const inicioData = new Date(inicio);
    const fimData = new Date(inicioData.getTime() + duracaoMin * 60000);
    setSalvando(true);
    setErro(null);
    setErroInicio(null);
    try {
      await aoSalvar(paraIso(inicio), fimData.toISOString());
    } catch (e) {
      // 409 do banco (exclusion constraint) ou da regra de sobreposição — mensagem legível.
      setErro(e instanceof ApiError ? (e.status === 409 ? `Conflito de horário: ${e.message}` : e.message) : "Não foi possível salvar o agendamento. Confira a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form noValidate onSubmit={confirmar} className="flex flex-col gap-5">
      <Campo rotulo="Início" erro={erroInicio} obrigatorio ajuda="Data e hora no horário do escritório.">
        <Entrada type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} onBlur={() => inicio && setErroInicio(null)} />
      </Campo>
      <Campo rotulo="Duração">
        <Selecao value={duracaoMin} onChange={(e) => setDuracaoMin(Number(e.target.value))}>
          <option value={30}>30 minutos</option>
          <option value={60}>1 hora</option>
          <option value={90}>1 hora e meia</option>
        </Selecao>
      </Campo>
      {erro && (
        <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Botao variante="fantasma" onClick={aoCancelar}>
          Cancelar
        </Botao>
        <Botao type="submit" variante="primario" carregando={salvando}>
          {rotuloConfirmar}
        </Botao>
      </div>
    </form>
  );
}
