"use client";

import { useEffect, useState } from "react";
import { adicionarFamiliar, criarAgendamento, listarFamiliares, type Agendamento, type Familiar, type SessaoViabilidade } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoVazio } from "@/components/ui/Estado";
import { LinhaAgendamento } from "@/components/agenda/LinhaAgendamento";
import { FormularioAgendamento } from "@/components/agenda/FormularioAgendamento";

const ROTULOS_RESULTADO: Record<NonNullable<SessaoViabilidade["resultado"]>, string> = {
  fechou: "Fechou",
  nao_fechou: "Não fechou",
  indefinido: "Indefinido",
};

export function SessaoAba({
  jornadaId,
  sessao,
  agendamentos,
  aoAtualizar,
}: {
  jornadaId: string;
  sessao: SessaoViabilidade | null;
  agendamentos: Agendamento[];
  aoAtualizar: () => void;
}) {
  const [criando, setCriando] = useState(false);
  const [familiares, setFamiliares] = useState<Familiar[] | null>(null);
  const [novoFamiliar, setNovoFamiliar] = useState<{ parentesco: string; nome: string } | null>(null);
  const [salvandoFamiliar, setSalvandoFamiliar] = useState(false);

  function carregarFamiliares() {
    listarFamiliares(jornadaId).then((r) => setFamiliares(r.familiares)).catch(() => setFamiliares(null));
  }
  useEffect(carregarFamiliares, [jornadaId]);

  async function salvarFamiliar() {
    if (!novoFamiliar?.parentesco.trim()) return;
    setSalvandoFamiliar(true);
    try {
      await adicionarFamiliar(jornadaId, { parentesco: novoFamiliar.parentesco, nome: novoFamiliar.nome || null, idade: null, ocupacao: null, regime_casamento: null, dependente_financeiro: null, observacoes: null });
      setNovoFamiliar(null);
      carregarFamiliares();
    } finally {
      setSalvandoFamiliar(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 font-serif text-base font-semibold text-tinta">Composição familiar</h3>
        {familiares === null ? (
          <p className="text-sm text-tinta-fraca">Carregando…</p>
        ) : familiares.length === 0 && !novoFamiliar ? (
          <EstadoVazio titulo="Nenhum familiar registrado" />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {familiares.map((f) => (
              <li key={f.id} className="rounded-sm border border-linha bg-papel-fundo px-2 py-1 text-xs text-tinta">
                {f.nome ? `${f.nome} · ` : ""}{f.parentesco}
              </li>
            ))}
          </ul>
        )}
        {novoFamiliar ? (
          <div className="nao-imprimir mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Parentesco
              <input value={novoFamiliar.parentesco} onChange={(e) => setNovoFamiliar({ ...novoFamiliar, parentesco: e.target.value })} placeholder="cônjuge, filho…" className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Nome (opcional)
              <input value={novoFamiliar.nome} onChange={(e) => setNovoFamiliar({ ...novoFamiliar, nome: e.target.value })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm" />
            </label>
            <Botao variante="primario" className="text-xs" carregando={salvandoFamiliar} onClick={salvarFamiliar}>Adicionar</Botao>
            <Botao variante="fantasma" className="text-xs" onClick={() => setNovoFamiliar(null)}>Cancelar</Botao>
          </div>
        ) : (
          <div className="nao-imprimir mt-2">
            <Botao variante="fantasma" className="text-xs" onClick={() => setNovoFamiliar({ parentesco: "", nome: "" })}>+ Adicionar familiar</Botao>
          </div>
        )}
      </div>

      {sessao?.link_sala && (
        <p className="rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-sm">
          <span className="font-medium text-tinta">Sala: </span>
          <a href={sessao.link_sala} target="_blank" rel="noreferrer" className="text-[color:var(--latao)] underline">{sessao.link_sala}</a>
        </p>
      )}
      {sessao?.resultado && (
        <p className="text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Resultado: </span>
          {ROTULOS_RESULTADO[sessao.resultado]}
          {sessao.motivo_resultado && ` — ${sessao.motivo_resultado}`}
        </p>
      )}

      <div>
        <h3 className="mb-2 font-serif text-base font-semibold text-tinta">Agendamentos</h3>
        {agendamentos.length === 0 ? (
          <EstadoVazio titulo="Nenhum agendamento ainda" />
        ) : (
          <ul className="flex flex-col gap-2">
            {agendamentos.map((a) => (
              <LinhaAgendamento key={a.id} agendamento={a} aoAtualizar={aoAtualizar} />
            ))}
          </ul>
        )}
      </div>

      {criando ? (
        <FormularioAgendamento
          aoCancelar={() => setCriando(false)}
          aoSalvar={async (inicioIso, fimIso) => {
            await criarAgendamento(jornadaId, { inicio_em: inicioIso, fim_em: fimIso });
            setCriando(false);
            aoAtualizar();
          }}
        />
      ) : (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={() => setCriando(true)}>+ Novo agendamento</Botao>
        </div>
      )}
    </div>
  );
}
