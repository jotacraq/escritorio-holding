"use client";

import { useCallback, useState } from "react";
import { criarPatrimonio, excluirPatrimonio, listarPatrimonio, ApiError, type PatrimonioItem } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { formatarMoeda } from "@/lib/formatar";

const ROTULOS_TIPO: Record<PatrimonioItem["tipo"], string> = {
  imovel: "Imóvel",
  veiculo: "Veículo",
  investimento: "Investimento",
  previdencia: "Previdência",
  empresa: "Empresa",
  outro: "Outro",
};

function itemVazio(): Omit<PatrimonioItem, "id"> {
  return { tipo: "imovel", descricao: "", ano_aquisicao: null, valor_historico: null, valor_mercado: null, destinacao: null, valor_locacao_mensal: null, detalhes: {} };
}

export function PatrimonioAba({ jornadaId }: { jornadaId: string }) {
  const buscar = useCallback(() => listarPatrimonio(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const itens = dados?.itens ?? [];
  const [novo, setNovo] = useState<Omit<PatrimonioItem, "id"> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o patrimônio" />;
  if (carregando) return <EstadoCarregando rotulo="Carregando patrimônio…" />;

  async function salvarNovo() {
    if (!novo || !novo.descricao.trim()) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      await criarPatrimonio(jornadaId, novo);
      setNovo(null);
      recarregar();
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível salvar o item.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    try {
      await excluirPatrimonio(id);
      recarregar();
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível excluir o item.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">Composição patrimonial — valor histórico e de mercado, como no Relatório da Sessão de Viabilidade.</p>

      {itens.length === 0 && !novo && <EstadoVazio titulo="Nenhum item patrimonial registrado" descricao="Registre os bens levantados na Sessão de Viabilidade." />}

      {itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-linha-forte text-left text-tinta-suave">
                <th className="py-1.5 pr-3 font-medium">Tipo</th>
                <th className="py-1.5 pr-3 font-medium">Descrição</th>
                <th className="py-1.5 pr-3 font-medium">Valor histórico</th>
                <th className="py-1.5 pr-3 font-medium">Valor de mercado</th>
                <th className="py-1.5 font-medium sr-only">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id} className="border-b border-linha">
                  <td className="py-2 pr-3">{ROTULOS_TIPO[item.tipo]}</td>
                  <td className="py-2 pr-3">{item.descricao}</td>
                  <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_historico)}</td>
                  <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_mercado)}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => excluir(item.id)} className="text-xs text-tinta-fraca hover:text-[color:var(--vermelho)]">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {novo ? (
        <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Tipo
              <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as PatrimonioItem["tipo"] })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5">
                {Object.entries(ROTULOS_TIPO).map(([v, r]) => (
                  <option key={v} value={v}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Descrição
              <input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Valor histórico
              <input type="number" value={novo.valor_historico ?? ""} onChange={(e) => setNovo({ ...novo, valor_historico: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Valor de mercado
              <input type="number" value={novo.valor_mercado ?? ""} onChange={(e) => setNovo({ ...novo, valor_mercado: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
          </div>
          {erroSalvar && <p className="text-xs text-[color:var(--vermelho)]">{erroSalvar}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarNovo} className="text-xs">Adicionar</Botao>
            <Botao variante="fantasma" className="text-xs" onClick={() => setNovo(null)}>Cancelar</Botao>
          </div>
        </div>
      ) : (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={() => setNovo(itemVazio())}>+ Adicionar item patrimonial</Botao>
        </div>
      )}
    </div>
  );
}
