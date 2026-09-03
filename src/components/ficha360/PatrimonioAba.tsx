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

/**
 * `detalhes` é jsonb livre (nenhuma migration nova por isto) — o Relatório da
 * SV (template da Dra. Elaine) pede, só para empresa, objeto/composição
 * societária/capital social/nº de empregados/PL/faturamento. Convenção de
 * chaves fixada aqui; nenhum outro lugar escreve neste objeto.
 */
interface DetalhesEmpresa {
  objeto?: string;
  composicao_societaria?: string;
  capital_social?: number | null;
  numero_empregados?: number | null;
  pl?: number | null;
  faturamento?: number | null;
}

function detalhesEmpresa(item: Pick<PatrimonioItem, "detalhes">): DetalhesEmpresa {
  return (item.detalhes ?? {}) as DetalhesEmpresa;
}

function itemVazio(): Omit<PatrimonioItem, "id"> {
  return { tipo: "imovel", descricao: "", ano_aquisicao: null, valor_historico: null, valor_mercado: null, destinacao: null, valor_locacao_mensal: null, detalhes: {} };
}

/** Linha auxiliar "rótulo: valor" — só aparece quando há valor (vazio é omitido, nunca "—" poluindo a subtítulo). */
function parte(rotulo: string, valor: string | number | null | undefined, formatar?: (v: string | number) => string): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return `${rotulo}: ${formatar ? formatar(valor) : valor}`;
}

function subtituloItem(item: PatrimonioItem): string | null {
  const partes: (string | null)[] = [parte("Aquisição", item.ano_aquisicao)];
  if (item.tipo === "imovel") {
    partes.push(parte("Destinação", item.destinacao), parte("Locação", item.valor_locacao_mensal, (v) => `${formatarMoeda(Number(v))}/mês`));
  }
  if (item.tipo === "empresa") {
    const d = detalhesEmpresa(item);
    partes.push(
      parte("Objeto", d.objeto),
      parte("Sócios", d.composicao_societaria),
      parte("Capital social", d.capital_social, (v) => formatarMoeda(Number(v))),
      parte("Funcionários", d.numero_empregados),
      parte("PL", d.pl, (v) => formatarMoeda(Number(v))),
      parte("Faturamento", d.faturamento, (v) => formatarMoeda(Number(v))),
    );
  }
  const texto = partes.filter((p): p is string => p !== null).join(" · ");
  return texto || null;
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

  function mudarDetalheEmpresa(campo: keyof DetalhesEmpresa, valor: string) {
    if (!novo) return;
    const numerico = campo === "objeto" || campo === "composicao_societaria";
    setNovo({
      ...novo,
      detalhes: { ...novo.detalhes, [campo]: numerico ? valor : valor === "" ? null : Number(valor) },
    });
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
              {itens.map((item) => {
                const subtitulo = subtituloItem(item);
                return (
                  <tr key={item.id} className="border-b border-linha align-top">
                    <td className="py-2 pr-3">{ROTULOS_TIPO[item.tipo]}</td>
                    <td className="py-2 pr-3">
                      <p>{item.descricao}</p>
                      {subtitulo && <p className="text-xs text-tinta-fraca">{subtitulo}</p>}
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_historico)}</td>
                    <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_mercado)}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => excluir(item.id)} className="nao-imprimir text-xs text-tinta-fraca hover:text-[color:var(--vermelho)]">
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {novo ? (
        <div className="nao-imprimir flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Tipo
              <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as PatrimonioItem["tipo"], detalhes: {} })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5">
                {Object.entries(ROTULOS_TIPO).map(([v, r]) => (
                  <option key={v} value={v}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Descrição
              <input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" placeholder={novo.tipo === "empresa" ? "Razão social" : novo.tipo === "investimento" ? "Ex.: poupança, VGBL, ações…" : undefined} />
            </label>
            {(novo.tipo === "imovel" || novo.tipo === "veiculo") && (
              <label className="flex flex-col gap-1 text-sm">
                Ano de aquisição
                <input type="number" value={novo.ano_aquisicao ?? ""} onChange={(e) => setNovo({ ...novo, ano_aquisicao: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Valor histórico
              <input type="number" value={novo.valor_historico ?? ""} onChange={(e) => setNovo({ ...novo, valor_historico: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {novo.tipo === "investimento" || novo.tipo === "previdencia" ? "Valor atual" : "Valor de mercado"}
              <input type="number" value={novo.valor_mercado ?? ""} onChange={(e) => setNovo({ ...novo, valor_mercado: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            {novo.tipo === "imovel" && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Destinação (moradia, aluguel, vazio…)
                  <input value={novo.destinacao ?? ""} onChange={(e) => setNovo({ ...novo, destinacao: e.target.value || null })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Valor de locação mensal
                  <input type="number" value={novo.valor_locacao_mensal ?? ""} onChange={(e) => setNovo({ ...novo, valor_locacao_mensal: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
              </>
            )}
          </div>

          {novo.tipo === "empresa" && (
            <fieldset className="flex flex-col gap-3 border-t border-linha pt-3">
              <legend className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Dados da empresa</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  Objeto social
                  <input value={detalhesEmpresa(novo).objeto ?? ""} onChange={(e) => mudarDetalheEmpresa("objeto", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  Composição societária
                  <input value={detalhesEmpresa(novo).composicao_societaria ?? ""} onChange={(e) => mudarDetalheEmpresa("composicao_societaria", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" placeholder="Ex.: 50% pai, 25% cada filho" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Capital social
                  <input type="number" value={detalhesEmpresa(novo).capital_social ?? ""} onChange={(e) => mudarDetalheEmpresa("capital_social", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Número de empregados
                  <input type="number" value={detalhesEmpresa(novo).numero_empregados ?? ""} onChange={(e) => mudarDetalheEmpresa("numero_empregados", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Patrimônio líquido (PL)
                  <input type="number" value={detalhesEmpresa(novo).pl ?? ""} onChange={(e) => mudarDetalheEmpresa("pl", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Faturamento
                  <input type="number" value={detalhesEmpresa(novo).faturamento ?? ""} onChange={(e) => mudarDetalheEmpresa("faturamento", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
              </div>
            </fieldset>
          )}

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
