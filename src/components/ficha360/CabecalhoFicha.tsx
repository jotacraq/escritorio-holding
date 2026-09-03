"use client";

import { useState } from "react";
import Link from "next/link";
import { useEtapasOrdem } from "@/hooks/useJornadas";
import { atualizarEtapa, ApiError, type DesfechoJornada, type Ficha360 } from "@/lib/api";
import { formatarCidadeUf, formatarTelefone } from "@/lib/formatar";
import { Selo, SeloDadoExemplo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";

const ROTULOS_DESFECHO: Record<DesfechoJornada, { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  aberta: { rotulo: "Aberta", tom: "azul" },
  ganha: { rotulo: "Ganha", tom: "verde" },
  perdida: { rotulo: "Perdida", tom: "vermelho" },
  descartada: { rotulo: "Descartada", tom: "vermelho" },
  congelada: { rotulo: "Congelada", tom: "neutro" },
};

const ROTULOS_NIVEL_PAGO = ["Nada pago", "Sessão paga", "Croqui pago", "Holding paga"];

export function CabecalhoFicha({ ficha, aoAtualizar }: { ficha: Ficha360; aoAtualizar: () => void }) {
  const { etapas } = useEtapasOrdem();
  const { jornada, pessoa } = ficha;
  const [editandoDesfecho, setEditandoDesfecho] = useState(false);
  const [novoDesfecho, setNovoDesfecho] = useState<DesfechoJornada>(jornada.desfecho);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const rotuloEtapa = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;

  async function salvarDesfecho() {
    if (novoDesfecho !== "aberta" && !motivo.trim()) {
      setErro("Motivo é obrigatório para qualquer desfecho diferente de aberta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await atualizarEtapa(jornada.id, { desfecho: novoDesfecho, motivo: motivo.trim() || undefined });
      setEditandoDesfecho(false);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o desfecho.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <header className="flex flex-col gap-3 border-b border-linha-forte pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-tinta">{pessoa.nome}</h1>
            {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
          </div>
          <p className="text-sm text-tinta-suave">
            {formatarCidadeUf(pessoa.cidade, pessoa.uf)}
            {pessoa.profissao && ` · ${pessoa.profissao}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom="azul">{rotuloEtapa}</Selo>
          <Selo tom={ROTULOS_DESFECHO[jornada.desfecho].tom}>{ROTULOS_DESFECHO[jornada.desfecho].rotulo}</Selo>
          <Selo tom="neutro">{ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}</Selo>
          <Link
            href={`/sessoes/${jornada.id}/conduzir`}
            className="nao-imprimir inline-flex items-center justify-center gap-1.5 rounded-sm border border-transparent bg-[color:var(--latao)] px-3.5 py-2 text-sm font-medium text-papel-elevado transition-colors hover:bg-[color:var(--latao-forte)]"
          >
            Conduzir sessão
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-tinta-fraca">Origem</dt>
          <dd className="text-tinta">
            {jornada.origem}
            {jornada.edicao_id && (
              <span title={jornada.edicao_id} className="ml-1 font-mono text-xs text-tinta-fraca">
                ({jornada.edicao_id.slice(0, 8)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Trilha</dt>
          <dd className="text-tinta">{jornada.trilha === "seminario" ? "Seminário" : "Preliminar"}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Telefone</dt>
          <dd className="font-mono text-tinta">{formatarTelefone(pessoa.telefone)}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">E-mail</dt>
          <dd className="text-tinta">{pessoa.email ?? "—"}</dd>
        </div>
      </dl>

      {jornada.motivo_desfecho && jornada.desfecho !== "aberta" && (
        <p className="rounded-sm bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Motivo do desfecho: </span>
          {jornada.motivo_desfecho}
        </p>
      )}

      {!editandoDesfecho ? (
        <div className="nao-imprimir">
          <Botao variante="fantasma" className="px-2 py-1 text-xs" onClick={() => setEditandoDesfecho(true)}>
            Alterar desfecho
          </Botao>
        </div>
      ) : (
        <div className="nao-imprimir flex flex-col gap-2 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="novo-desfecho" className="text-xs font-medium text-tinta-suave">
              Novo desfecho
            </label>
            <select
              id="novo-desfecho"
              value={novoDesfecho}
              onChange={(e) => setNovoDesfecho(e.target.value as DesfechoJornada)}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm"
            >
              {Object.entries(ROTULOS_DESFECHO).map(([valor, info]) => (
                <option key={valor} value={valor}>
                  {info.rotulo}
                </option>
              ))}
            </select>
          </div>
          {novoDesfecho !== "aberta" && (
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (obrigatório)"
              rows={2}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 text-sm"
            />
          )}
          {erro && <p className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarDesfecho} className="text-xs">
              Salvar
            </Botao>
            <Botao
              variante="fantasma"
              className="text-xs"
              onClick={() => {
                setEditandoDesfecho(false);
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </header>
  );
}
