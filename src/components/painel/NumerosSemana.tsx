import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { formatarPercentual } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import type { EstadoBloco, IndicadorEdicao } from "@/types/painel-ui";
import { BotaoDica } from "./Bloco";
import { LinkBotao } from "./LinkBotao";

interface LinhaNumero {
  rotulo: string;
  valor: number;
  base: number;
  baseDescricao: string;
}

function linhasDe(item: IndicadorEdicao): LinhaNumero[] {
  return [
    { rotulo: "Compareceram", valor: item.compareceram, base: item.sessoes_com_desfecho, baseDescricao: "com desfecho" },
    { rotulo: "Formulário respondido", valor: item.formularios_respondidos, base: item.clientes_pagantes, baseDescricao: "dos pagantes" },
    { rotulo: "Decisores na sessão", valor: item.com_decisores, base: item.com_resposta_decisores, baseDescricao: "de quem respondeu" },
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
    <Cartao
      rotulo="Leitura"
      titulo={<span title={titleDe("pop01")}>Números por edição</span>}
      acao={
        <>
          <BotaoDica texto="Os três indicadores que o método acompanha, sempre por edição do seminário (coorte) — nunca por janela de calendário." rotulo="os números" />
          <LinkBotao href="/indicadores">Ver indicadores</LinkBotao>
        </>
      }
    >
      {estado.situacao === "indisponivel" && (
        <div role="alert" className="flex flex-wrap items-center gap-item text-sm text-tinta-suave">
          <span>Não carregou.</span>
          <Botao variante="secundario" tamanho="compacto" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}

      {estado.situacao === "ok" && estado.itens.length === 0 && (
        <EstadoVazio compacto titulo="Nenhuma sessão com desfecho ainda" acao={<LinkBotao href="/agenda">Abrir agenda</LinkBotao>} />
      )}

      {estado.situacao === "ok" && estado.itens.length > 0 && (
        <div className="flex flex-col gap-cartao">
          {estado.itens.map((item) => (
            <div key={item.edicao_id ?? "sem-edicao"} className="flex flex-col gap-item">
              <h3 className="text-sm font-bold text-tinta">{item.edicao_id ? (item.edicao_nome ?? item.edicao_codigo ?? "Edição sem nome") : "Sem edição"}</h3>
              <div className="grid grid-cols-1 gap-item sm:grid-cols-3">
                {linhasDe(item).map((linha) => {
                  const percentual = linha.base > 0 ? (linha.valor / linha.base) * 100 : null;
                  return (
                    <Kpi
                      key={linha.rotulo}
                      rotulo={linha.rotulo}
                      valor={linha.valor}
                      unidade={percentual !== null ? `· ${formatarPercentual(percentual)} ${linha.baseDescricao}` : undefined}
                      visual={percentual !== null ? <BarraProporcao fracao={linha.valor / linha.base} /> : undefined}
                      motivoVazio="sem base para percentual"
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
