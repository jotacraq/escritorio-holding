"use client";

import type { ReactNode } from "react";
import type { ChaveTabFicha, DefinicaoTabFicha } from "@/lib/pasta/tabs";

export interface PainelTabFicha {
  definicao: DefinicaoTabFicha;
  conteudo: ReactNode;
}

/**
 * As 4 tabs da Ficha (Fatia 3) — pedido literal do João: *"dividir em tabs:
 * sessão · croqui · holding · documentos. Não podem ocupar o mesmo espaço.
 * Tá muito confuso tudo reunido numa tela só."*
 *
 * Por que não reusar `components/ui/Abas.tsx`: aquele componente marca a
 * aba inativa com `hidden` (CSS) e **continua montando os 4 painéis o tempo
 * todo** — é assim que ele preserva estado de formulário ao trocar de aba.
 * Aqui o efeito é o oposto do que se quer: `ConduzirSessaoApp.tsx:140`
 * acabou de consolidar 2 pollers em 1 (achado do Fable, 16/09) — 4 tabs
 * montando juntas desfaria isso e multiplicaria por 4 a carga de toda
 * gaveta/bloco que busca dado (`RadarDocumentos`, `AutomacoesFicha`,
 * `RecebidasFicha`…). Este componente devolve `null` para o conteúdo de toda
 * tab que não é a ativa — o MESMO contrato que `Gaveta` já cumpre fechada.
 *
 * Estado (`tabAtiva`) mora no componente pai (`page.tsx`), não aqui: a
 * página também precisa saber a tab ativa para abrir a gaveta certa quando
 * um hash de fora (`#briefing`, chip do Painel) chega apontando para um item
 * de uma tab que não é a corrente.
 */
export function TabsFicha({ tabAtiva, aoTrocarTab, paineis }: { tabAtiva: ChaveTabFicha; aoTrocarTab: (chave: ChaveTabFicha) => void; paineis: PainelTabFicha[] }) {
  return (
    <div>
      <div role="tablist" aria-label="Seções da ficha" className="nao-imprimir -mb-px flex flex-wrap gap-0.5 border-b border-linha-forte">
        {paineis.map(({ definicao }) => {
          const selecionada = definicao.chave === tabAtiva;
          return (
            <button
              key={definicao.chave}
              type="button"
              role="tab"
              id={`tab-${definicao.chave}`}
              aria-selected={selecionada}
              aria-controls={`painel-tab-${definicao.chave}`}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => aoTrocarTab(definicao.chave)}
              onKeyDown={(evento) => aoTeclarNaTab(evento, paineis, definicao.chave, aoTrocarTab)}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-controle border-b-[3px] px-4 text-sm transition-colors duration-[var(--transicao-rapida)] ${
                selecionada ? "border-[color:var(--latao)] font-bold text-tinta" : "border-transparent font-medium text-tinta-suave hover:bg-papel-elevado hover:text-tinta"
              }`}
            >
              {definicao.rotulo}
            </button>
          );
        })}
      </div>

      {paineis.map(({ definicao, conteudo }) => {
        const ativa = definicao.chave === tabAtiva;
        return (
          <div
            key={definicao.chave}
            role="tabpanel"
            id={`painel-tab-${definicao.chave}`}
            aria-labelledby={`tab-${definicao.chave}`}
            hidden={!ativa}
            tabIndex={0}
            className="flex flex-col gap-bloco pt-cartao"
          >
            {/* A tab inativa não monta o conteúdo — nunca um `<div hidden>`
                carregando o que não está sendo visto. */}
            {ativa ? conteudo : null}
          </div>
        );
      })}
    </div>
  );
}

function aoTeclarNaTab(
  evento: React.KeyboardEvent,
  paineis: PainelTabFicha[],
  atual: ChaveTabFicha,
  aoTrocarTab: (chave: ChaveTabFicha) => void,
) {
  const indice = paineis.findIndex((p) => p.definicao.chave === atual);
  let proximo: number | null = null;
  if (evento.key === "ArrowRight") proximo = (indice + 1) % paineis.length;
  else if (evento.key === "ArrowLeft") proximo = (indice - 1 + paineis.length) % paineis.length;
  else if (evento.key === "Home") proximo = 0;
  else if (evento.key === "End") proximo = paineis.length - 1;
  if (proximo === null) return;
  evento.preventDefault();
  const chave = paineis[proximo].definicao.chave;
  aoTrocarTab(chave);
  document.getElementById(`tab-${chave}`)?.focus();
}
