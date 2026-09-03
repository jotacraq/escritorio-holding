"use client";

import { useEffect, useState } from "react";
import { buscarIndicadores, ApiError, type IndicadoresEdicao } from "@/lib/api";
import { EstadoCarregando, EstadoVazio } from "@/components/ui/Estado";
import { formatarPercentual } from "@/lib/formatar";

interface LinhaIndicador {
  rotulo: string;
  valor: number;
  base?: number;
  /** Descreve o denominador real do percentual — nunca um rótulo genérico. */
  baseDescricao?: string;
}

function linhasDe(item: IndicadoresEdicao): LinhaIndicador[] {
  return [
    { rotulo: "Sessões contratadas", valor: item.sessoes_contratadas },
    {
      rotulo: "Sessões realizadas",
      valor: item.sessoes_realizadas,
      base: item.sessoes_contratadas,
      baseDescricao: "de quem contratou a sessão",
    },
    {
      rotulo: "Croquis contratados",
      valor: item.croquis_contratados,
      base: item.sessoes_realizadas,
      baseDescricao: "de quem realizou a sessão",
    },
    {
      rotulo: "Holdings contratadas",
      valor: item.holdings,
      base: item.croquis_contratados,
      baseDescricao: "de quem contratou o croqui",
    },
    {
      rotulo: "Formulários respondidos",
      valor: item.formularios_respondidos,
      base: item.sessoes_contratadas,
      baseDescricao: "de quem pagou a sessão",
    },
    {
      rotulo: "Ligações feitas",
      valor: item.ligacoes_feitas,
      base: item.sessoes_contratadas,
      baseDescricao: "de quem pagou a sessão",
    },
  ];
}

function CartaoIndicador({ linha }: { linha: LinhaIndicador }) {
  const percentual = linha.base && linha.base > 0 ? (linha.valor / linha.base) * 100 : null;
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-linha bg-papel-elevado p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">{linha.rotulo}</p>
      <p className="font-serif text-3xl font-semibold text-tinta">{linha.valor}</p>
      {percentual !== null && (
        <p className="text-xs text-tinta-suave">
          {formatarPercentual(percentual)} {linha.baseDescricao}
        </p>
      )}
    </div>
  );
}

export default function PaginaIndicadores() {
  const [itens, setItens] = useState<IndicadoresEdicao[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    buscarIndicadores()
      .then((res) => setItens(res.itens))
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Erro ao carregar indicadores."))
      .finally(() => setCarregando(false));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-tinta">Indicadores</h1>
        <p className="text-sm text-tinta-suave">POP 08 — só o que a view calcula de fato. Sem fonte de dado, o indicador não aparece.</p>
      </div>

      {carregando && <EstadoCarregando rotulo="Carregando indicadores…" />}
      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}

      {!carregando && !erro && (!itens || itens.length === 0) && (
        <EstadoVazio titulo="Nenhum indicador calculado ainda" descricao="A view de indicadores ainda não tem linha para nenhuma edição." />
      )}

      {!carregando && itens && itens.length > 0 && (
        <div className="flex flex-col gap-6">
          {itens.map((item) => (
            <section key={item.edicao_id ?? "sem-edicao"}>
              <h2 className="mb-2 flex items-baseline gap-2 font-serif text-lg font-semibold text-tinta">
                {item.edicao_id ? item.edicao_nome ?? "Edição sem nome cadastrado" : "Sem edição de origem"}
                {item.edicao_id && item.edicao_codigo && (
                  <span className="font-sans text-xs font-normal uppercase tracking-wide text-tinta-fraca">
                    {item.edicao_codigo}
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {linhasDe(item).map((linha) => (
                  <CartaoIndicador key={linha.rotulo} linha={linha} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
