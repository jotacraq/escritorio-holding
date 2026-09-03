"use client";

import { useState } from "react";
import Link from "next/link";
import { atualizarAgendamento, ApiError, type Agendamento, type StatusAgendamento } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { FormularioAgendamento } from "./FormularioAgendamento";

const ROTULOS_STATUS: Record<StatusAgendamento, { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  agendado: { rotulo: "Agendado", tom: "neutro" },
  confirmado: { rotulo: "Confirmado", tom: "azul" },
  realizado: { rotulo: "Realizado", tom: "verde" },
  nao_compareceu: { rotulo: "Não compareceu", tom: "vermelho" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
  remarcado: { rotulo: "Remarcado", tom: "neutro" },
};

export function LinhaAgendamento({ agendamento, aoAtualizar, mostrarPessoa = false }: { agendamento: Agendamento; aoAtualizar: () => void; mostrarPessoa?: boolean }) {
  const [remarcando, setRemarcando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function mudarStatus(status: StatusAgendamento) {
    setOcupado(true);
    setErro(null);
    try {
      await atualizarAgendamento(agendamento.id, { status });
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? (e.status === 409 ? `Conflito: ${e.message}` : e.message) : "Não foi possível atualizar.");
    } finally {
      setOcupado(false);
    }
  }

  const ativo = agendamento.status === "agendado" || agendamento.status === "confirmado";

  return (
    <li className="flex flex-col gap-2 rounded-sm border border-linha bg-papel-elevado p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {mostrarPessoa && agendamento.jornada_id && (
            <Link href={`/jornadas/${agendamento.jornada_id}`} className="mb-0.5 block text-xs font-medium text-[color:var(--latao)] hover:underline">
              Abrir jornada →
            </Link>
          )}
          {mostrarPessoa && agendamento.pessoa_nome && <p className="font-medium text-tinta">{agendamento.pessoa_nome}</p>}
          <p className="font-mono text-sm text-tinta">{formatarDataHora(agendamento.inicio_em)}</p>
        </div>
        <Selo tom={ROTULOS_STATUS[agendamento.status].tom}>{ROTULOS_STATUS[agendamento.status].rotulo}</Selo>
      </div>

      {erro && <p role="alert" className="text-xs text-[color:var(--vermelho)]">{erro}</p>}

      {ativo && !remarcando && (
        <div className="nao-imprimir flex flex-wrap gap-2">
          <Botao variante="fantasma" className="text-xs" carregando={ocupado} onClick={() => mudarStatus("realizado")}>Marcar realizada</Botao>
          <Botao variante="fantasma" className="text-xs" carregando={ocupado} onClick={() => mudarStatus("nao_compareceu")}>Marcar no-show</Botao>
          <Botao variante="fantasma" className="text-xs" onClick={() => setRemarcando(true)}>Remarcar</Botao>
          <Botao variante="perigo" className="text-xs" carregando={ocupado} onClick={() => mudarStatus("cancelado")}>Cancelar</Botao>
        </div>
      )}

      {remarcando && (
        <FormularioAgendamento
          aoCancelar={() => setRemarcando(false)}
          aoSalvar={async (inicioIso, fimIso) => {
            await atualizarAgendamento(agendamento.id, { inicio_em: inicioIso, fim_em: fimIso });
            setRemarcando(false);
            aoAtualizar();
          }}
        />
      )}
    </li>
  );
}
