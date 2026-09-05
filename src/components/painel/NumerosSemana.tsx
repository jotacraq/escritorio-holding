import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { formatarPercentual } from "@/lib/formatar";
import type { EstadoBloco, IndicadorEdicao } from "@/types/painel-ui";
import { LinkBotao } from "./LinkBotao";

interface LinhaNumero {
  rotulo: string;
  valor: number;
  base: number;
  baseDescricao: string;
}

function linhasDe(item: IndicadorEdicao): LinhaNumero[] {
  return [
    { rotulo: "Compareceram", valor: item.compareceram, base: item.sessoes_com_desfecho, baseDescricao: "das sessões já com desfecho" },
    { rotulo: "Formulário respondido", valor: item.formularios_respondidos, base: item.clientes_pagantes, baseDescricao: "dos clientes pagantes" },
    { rotulo: "Decisores na sessão", valor: item.com_decisores, base: item.com_resposta_decisores, baseDescricao: "de quem respondeu sobre decisores" },
  ];
}

/** Barra de proporção — auxílio visual do KPI; decorativa, o texto já diz o número. */
function BarraProporcao({ fracao }: { fracao: number }) {
  const largura = Math.max(0, Math.min(100, Math.round(fracao * 100)));
  return (
    <svg viewBox="0 0 96 40" className="h-full w-full" fill="none">
      <rect x="0" y="16" width="96" height="8" rx="4" fill="var(--latao-fraco)" />
      <rect x="0" y="16" width={(96 * largura) / 100} height="8" rx="4" fill="currentColor" />
    </svg>
  );
}

/**
 * Bloco 5 — leitura, não ação. POP 01, os três indicadores que o método
 * nomeia, por edição (coorte) — nunca por janela de calendário (brain:
 * "métrica de funil é por coorte, nunca janela de evento"). Campo sem
 * denominador não vira 0%: o `Kpi` mostra o valor e explica por que não há
 * percentual.
 */
export function NumerosSemana({ estado, aoTentarDeNovo }: { estado: EstadoBloco<IndicadorEdicao>; aoTentarDeNovo: () => void }) {
  return (
    <Cartao rotulo="Leitura" titulo="Números" descricao="POP 01, por edição do seminário — leitura, sem ação a tomar aqui" acao={<LinkBotao href="/indicadores">Ver indicadores</LinkBotao>}>
      {estado.situacao === "indisponivel" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-tinta-suave">
          <span>Não conseguiu carregar os números agora.</span>
          <Botao variante="secundario" tamanho="compacto" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}

      {estado.situacao === "ok" && estado.itens.length === 0 && (
        <EstadoVazio compacto titulo="Nenhum indicador calculado ainda" descricao="Sem sessão com desfecho registrado nesta edição, ainda não há o que somar." />
      )}

      {estado.situacao === "ok" && estado.itens.length > 0 && (
        <div className="flex flex-col gap-6">
          {estado.itens.map((item) => (
            <div key={item.edicao_id ?? "sem-edicao"} className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-tinta">{item.edicao_id ? (item.edicao_nome ?? item.edicao_codigo ?? "Edição sem nome cadastrado") : "Sem edição de origem"}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {linhasDe(item).map((linha) => {
                  const percentual = linha.base > 0 ? (linha.valor / linha.base) * 100 : null;
                  return (
                    <Kpi
                      key={linha.rotulo}
                      rotulo={linha.rotulo}
                      valor={linha.valor}
                      unidade={percentual !== null ? `· ${formatarPercentual(percentual)} ${linha.baseDescricao}` : undefined}
                      visual={percentual !== null ? <BarraProporcao fracao={linha.valor / linha.base} /> : undefined}
                      motivoVazio="sem base para percentual ainda"
                      className="bg-papel shadow-none"
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Cartao>
  );
}
