"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface AbaColuna3 {
  /** Id estável — entra no `id`/`aria-controls` e é o que a escolha dela guarda. */
  id: string;
  rotulo: string;
  /**
   * Contagem do que está DENTRO da aba (itens da Ficha, itens do inventário).
   * Só aparece quando é maior que zero — regra da casa: vazio é vazio, nunca
   * `Inventário 0`. `null`/ausente = a aba não tem o que contar.
   */
  contagem?: number | null;
  /**
   * Função, não `ReactNode`: só a aba ATIVA é chamada, então o painel
   * inativo não chega a virar elemento React nenhum. É o que garante o
   * aceite de FE-1 ("painel inativo ausente do DOM") sem depender de
   * `hidden`, e é o que devolve a propriedade que o docblock de
   * `PainelTranscricao` descreve: a aba inativa DESMONTA (nenhum poller,
   * nenhum `onScroll`, nenhum `ResizeObserver` vivo fora de vista).
   */
  conteudo: () => ReactNode;
}

/**
 * Fase 13, FE-1 — a faixa de abas da COL 3 da tela de condução
 * (`Ficha · Transcrição · Inventário`).
 *
 * **Por que não `ui/Abas`** (decisão do arquiteto, §A.2 de
 * `docs/ARQUITETURA-FASE-13.md`, e não preferência de estilo):
 *  1. `ui/Abas` renderiza TODOS os painéis e esconde o inativo com `hidden` —
 *     o painel fora de vista continua montado, com `onScroll`,
 *     `ResizeObserver` e realce vivos. Numa tela que fica 2 horas aberta ao
 *     lado de um cliente, isso é trabalho contínuo por nada.
 *  2. Cada botão de lá é `min-h-11` (44 px) + `border-b` + moldura de cartão.
 *     A COL 3 tem 28% de 1536 px e o orçamento vertical da primeira dobra é
 *     de 601 px (§C.1) — 44 px de faixa é 7% do mosaico gasto em cromo.
 *
 * **O custo vertical, medido no desenho:** a faixa é `min-h-7` (28 px por
 * linha) + `mt-2` (8 px) = 36 px dentro da célula, e a célula é
 * `minmax(0,1fr)` — sai do orçamento da COL 3, nunca do grid da página.
 * `flex-wrap` é contenção obrigatória (§C.2): se os 3 rótulos não couberem
 * na escala Grande, a faixa quebra para 2 linhas (56 px) e o painel absorve;
 * nunca estoura para fora da célula.
 *
 * **O alvo de clique tem 44 px mesmo com 28 px de altura declarada:** o
 * `::after` (`after:-inset-y-2`) estica a área sensível 8 px para cima (para
 * dentro do `mt-2`, que é espaço da própria célula) e 8 px para baixo (para
 * dentro do `gap-2` que separa a faixa do painel). Nada disso conta no
 * layout — `getBoundingClientRect()` da faixa continua medindo 28 px — e
 * nenhum dos dois lados invade o painel rolável, que é o que tornaria um
 * clique na primeira linha da transcrição uma troca de aba acidental.
 *
 * **Nada troca de aba sozinho.** Virada de bloco, sugestão nova, alerta,
 * tick de polling: nenhum evento sequestra a aba. A ÚNICA exceção é anterior
 * à primeira interação dela — enquanto ela não clicou em nada, a aba de
 * estreia acompanha `idPadrao`, que muda de `transcricao` para `ficha` no
 * primeiro tick de polling (o kill-switch `copiloto_sessao.ficha_cliente` só
 * é conhecido depois da 1ª resposta do servidor, ~3 s depois de abrir).
 * Depois do primeiro clique, a escolha dela vence para sempre — e não
 * persiste entre sessões nem recargas (§A.2, decisão de produto declarada
 * fora da v1).
 */
export function AbasColuna3({
  abas,
  idPadrao,
  rotuloDaFaixa = "Conteúdo da coluna",
}: {
  /** Na ordem em que aparecem. Vazio nunca acontece na prática (a aba
   * Transcrição existe sempre), mas é tratado sem quebrar. */
  abas: AbaColuna3[];
  /** Aba de estreia enquanto ela não escolheu nenhuma. Ignorado se o id não
   * existir na lista (ex.: a Ficha ainda não chegou). */
  idPadrao?: string;
  rotuloDaFaixa?: string;
}) {
  const [escolhaDela, setEscolhaDela] = useState<string | null>(null);
  const referencias = useRef<Record<string, HTMLButtonElement | null>>({});

  if (abas.length === 0) return null;

  const preferida = escolhaDela ?? idPadrao;
  // A escolha dela pode apontar para uma aba que deixou de existir (o
  // inventário some do payload, por exemplo). Cai na primeira — nunca numa
  // tela em branco.
  const ativa = abas.find((a) => a.id === preferida) ?? abas[0];

  function aoTeclar(evento: KeyboardEvent, indice: number) {
    let proximo: number | null = null;
    if (evento.key === "ArrowRight") proximo = (indice + 1) % abas.length;
    else if (evento.key === "ArrowLeft") proximo = (indice - 1 + abas.length) % abas.length;
    else if (evento.key === "Home") proximo = 0;
    else if (evento.key === "End") proximo = abas.length - 1;
    if (proximo === null) return;
    evento.preventDefault();
    const id = abas[proximo].id;
    setEscolhaDela(id);
    referencias.current[id]?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="tablist" aria-label={rotuloDaFaixa} className="mt-2 flex shrink-0 flex-wrap items-stretch gap-1">
        {abas.map((aba, indice) => {
          const selecionada = aba.id === ativa.id;
          const temContagem = typeof aba.contagem === "number" && aba.contagem > 0;
          return (
            <button
              key={aba.id}
              ref={(el) => {
                referencias.current[aba.id] = el;
              }}
              type="button"
              role="tab"
              id={`aba-col3-${aba.id}`}
              aria-selected={selecionada}
              aria-controls={`painel-col3-${aba.id}`}
              aria-label={temContagem ? `${aba.rotulo}, ${aba.contagem} itens` : aba.rotulo}
              tabIndex={selecionada ? 0 : -1}
              onKeyDown={(e) => aoTeclar(e, indice)}
              onClick={() => setEscolhaDela(aba.id)}
              className={`relative inline-flex min-h-7 items-center gap-1.5 rounded-t-controle border-b-2 px-2 text-rotulo transition-colors duration-[var(--transicao-rapida)] after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--foco)] ${
                selecionada
                  ? "border-[color:var(--latao)] font-bold text-tinta"
                  : "border-transparent font-medium text-tinta-suave hover:bg-papel-elevado hover:text-tinta"
              }`}
            >
              <span aria-hidden="true">{aba.rotulo}</span>
              {temContagem && (
                <span aria-hidden="true" className="tabular-nums font-bold text-tinta-fraca">
                  {aba.contagem}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sem `tabIndex` no painel, de propósito (APG: o painel só precisa ser
       * focável quando NÃO tem conteúdo focável dentro). Todo painel desta
       * coluna ou traz a própria região rolável focável (transcrição,
       * inventário) ou, no caso da Ficha, só deixa de trazê-la quando não há
       * excedente nenhum para rolar — e aí não há nada a alcançar rolando.
       * Um `tabIndex={0}` aqui seria uma segunda parada de Tab para a mesma
       * região, no meio de uma tela que ela opera falando com o cliente. */}
      <div
        role="tabpanel"
        id={`painel-col3-${ativa.id}`}
        aria-labelledby={`aba-col3-${ativa.id}`}
        // `overflow-hidden` (não `auto`): o painel CONTÉM, quem rola é o
        // conteúdo dele. Sem isto, o container-sombra de medição da
        // `FichaCliente` (`absolute`, `invisible`, ~604 px medidos em
        // Chromium) atravessa este nível e entra no `scrollHeight` da
        // CÉLULA — `col3.scrollHeight 670 ≠ clientHeight 571`, o número
        // exato do defeito F4-1 que o Fable mediu em 18/09. Não havia
        // barra de rolagem (a `Coluna` é `overflow-hidden`), mas a asserção
        // de §C.4 é sobre `scrollHeight`, e um ancestral que "rola" por
        // conteúdo invisível é a porta de entrada do duplo-scroll toda vez
        // que alguém troca a contenção de lugar. Clipar aqui faz a sombra
        // parar neste nível e nunca mais contar acima.
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {ativa.conteudo()}
      </div>
    </div>
  );
}
