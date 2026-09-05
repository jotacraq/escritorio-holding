"use client";

import { useState } from "react";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ApiError, criarBloqueio } from "./api";

function paraIso(dataHoraLocal: string): string {
  return new Date(dataHoraLocal).toISOString();
}

/** Exceção pontual (folga, feriado, compromisso) — nunca mexe nas janelas
 * recorrentes, só cobre o período informado. Valida no envio, erro por campo. */
export function FormularioBloqueio({ advogadaId, aoCriar }: { advogadaId: string; aoCriar: () => void }) {
  const { notificar } = useToast();
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<{ inicio?: string; fim?: string; motivo?: string }>({});

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    const novos: typeof erros = {};
    if (!inicio) novos.inicio = "Informe quando o bloqueio começa.";
    if (!fim) novos.fim = "Informe quando o bloqueio termina.";
    if (inicio && fim && new Date(fim) <= new Date(inicio)) novos.fim = "O fim precisa ser depois do início.";
    if (!motivo.trim()) novos.motivo = "Diga o motivo — ajuda a lembrar depois.";
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    setSalvando(true);
    try {
      await criarBloqueio({ advogada_id: advogadaId, inicio_em: paraIso(inicio), fim_em: paraIso(fim), motivo: motivo.trim() });
      setInicio("");
      setFim("");
      setMotivo("");
      notificar({ tom: "sucesso", titulo: "Horário bloqueado", descricao: motivo.trim() });
      aoCriar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível bloquear", descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao como="div" rotulo="Novo bloqueio" titulo="Bloquear um período" descricao="Folga, feriado, compromisso: o período some das opções oferecidas ao cliente.">
      <form noValidate onSubmit={salvar} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="De" id="bloq-inicio" erro={erros.inicio} obrigatorio>
            <Entrada type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Campo>
          <Campo rotulo="Até" id="bloq-fim" erro={erros.fim} obrigatorio>
            <Entrada type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
          </Campo>
        </div>
        <Campo rotulo="Motivo" id="bloq-motivo" erro={erros.motivo} obrigatorio extra={`${motivo.length}/500`}>
          <Entrada type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Folga, feriado, compromisso…" maxLength={500} />
        </Campo>
        <div className="flex justify-end">
          <Botao type="submit" variante="primario" carregando={salvando}>
            Bloquear
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
