import { EstadoVazio } from "@/components/ui/Estado";
import { formatarPercentual } from "@/lib/formatar";
import type { EstadoBloco, IndicadorEdicao } from "@/types/painel-ui";

interface LinhaNumero {
  rotulo: string;
  valor: number;
  base: number;
  baseDescricao: string;
}

function linhasDe(item: IndicadorEdicao): LinhaNumero[] {
  return [
    {
      rotulo: "Compareceram",
      valor: item.compareceram,
      base: item.sessoes_com_desfecho,
      baseDescricao: "das sessões já com desfecho",
    },
    {
      rotulo: "Formulário respondido",
      valor: item.formularios_respondidos,
      base: item.clientes_pagantes,
      baseDescricao: "dos clientes pagantes",
    },
    {
      rotulo: "Decisores na sessão",
      valor: item.com_decisores,
      base: item.com_resposta_decisores,
      baseDescricao: "de quem respondeu sobre decisores",
    },
  ];
}

function Cartao({ linha }: { linha: LinhaNumero }) {
  // Campo novo nasce vazio: sem denominador, o percentual não aparece — não é 0%.
  const percentual = linha.base > 0 ? (linha.valor / linha.base) * 100 : null;
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-linha bg-papel px-3.5 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">{linha.rotulo}</p>
      <p className="font-serif text-2xl font-semibold text-tinta">{linha.valor}</p>
      <p className="text-xs text-tinta-suave">
        {percentual !== null ? `${formatarPercentual(percentual)} ${linha.baseDescricao}` : "sem base para percentual ainda"}
      </p>
    </div>
  );
}

/**
 * Bloco 5 — leitura, não ação. POP 01, os três indicadores que o método
 * nomeia, por edição (coorte) — nunca por janela de calendário (brain:
 * "métrica de funil é por coorte, nunca janela de evento").
 */
export function NumerosSemana({ estado, aoTentarDeNovo }: { estado: EstadoBloco<IndicadorEdicao>; aoTentarDeNovo: () => void }) {
  return (
    <section aria-labelledby="numeros-titulo" className="rounded-sm border border-linha bg-papel-elevado">
      <header className="border-b border-linha px-4 py-3 sm:px-5">
        <h2 id="numeros-titulo" className="font-serif text-lg font-semibold text-tinta">
          Números
        </h2>
        <p className="text-xs text-tinta-suave">POP 01, por edição do seminário — leitura, sem ação a tomar aqui</p>
      </header>

      <div className="px-4 py-3 sm:px-5">
        {estado.situacao === "indisponivel" && (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 py-2 text-sm text-tinta-suave">
            <span>Não conseguiu carregar os números agora.</span>
            <button
              type="button"
              onClick={aoTentarDeNovo}
              className="rounded-sm border border-linha-forte px-2 py-1 text-xs font-medium text-tinta hover:bg-papel"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {estado.situacao === "ok" && estado.itens.length === 0 && (
          <EstadoVazio titulo="Nenhum indicador calculado ainda" descricao="Sem sessão com desfecho registrado nesta edição, ainda não há o que somar." />
        )}

        {estado.situacao === "ok" && estado.itens.length > 0 && (
          <div className="flex flex-col gap-4">
            {estado.itens.map((item) => (
              <div key={item.edicao_id ?? "sem-edicao"}>
                <h3 className="mb-2 font-serif text-sm font-semibold text-tinta">
                  {item.edicao_id ? item.edicao_nome ?? item.edicao_codigo ?? "Edição sem nome cadastrado" : "Sem edição de origem"}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {linhasDe(item).map((linha) => (
                    <Cartao key={linha.rotulo} linha={linha} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
