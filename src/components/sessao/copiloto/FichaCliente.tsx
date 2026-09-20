"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ItemFichaParaPainel } from "@/types/copiloto";
import { formatarHora } from "@/lib/formatar";
import { useRealceUmaVez } from "@/components/sessao/copiloto/useRealceUmaVez";

/** WCAG 2.1.1 — mesma armadilha documentada em `Coluna.tsx`/`PainelCopiloto.tsx`
 * (`TAB_INDEX_ROLAVEL`): uma constante nomeada sai do falso positivo de
 * `jsx-a11y/no-noninteractive-tabindex` em `role="region"` estático, sem
 * mudar o comportamento — é sempre `0`. */
const TAB_INDEX_ROLAVEL = 0;

/** Teto de PRODUTO (config `copiloto_sessao.ficha_teto_fixos`, migration
 * 0122) — nasce `null` no banco (a tela deriva do viewport) e um valor
 * gravado ali VENCE esta constante. O campo JÁ chega ao payload de polling
 * (`FichaParaPainel.teto_fixos`, lido em `estado.ts` e repassado como prop
 * `configTeto` em `PainelCopiloto.tsx:383`) — é sempre um TETO, nunca uma
 * META (ver docblock de `FichaCliente` abaixo). `TETO_PADRAO` só é usado
 * quando `configTeto` é `null`/ausente (override desligado, ou sessão sem
 * o campo). */
const TETO_PADRAO = 5;

/** Piso da área fixa — decisão do dono, 18/09/2026 (mensagem do coordenador,
 * confirmando e substituindo a hipótese anterior do arquiteto de "abaixo de
 * 3 fixos, vira lista única" — ESSE caminho foi recusado e não é
 * implementado aqui). Com espaço para 1 item inteiro, a área fixa mostra 1 —
 * nunca 0 enquanto houver pelo menos 1 item que caiba, e nunca a lista
 * inteira despejada numa célula que só comporta uma linha.
 *
 * Por que 1, e não "vira lista única": com uma vaga só, quem fica é a
 * OBJEÇÃO MAIS URGENTE — e objeção é justamente o que não pode sair de
 * vista. Isso é coerente com a hierarquia de categoria que o servidor já
 * ordena (`rank_categoria`: objeção › dor › desejo › fato_decisor ›
 * patrimônio — objeção não tratada derruba a venda; dor é combustível, não
 * risco). O item[0] da lista ordenada É essa objeção quando ela existe. */
const PISO_ITENS_FIXOS = 1;

const ROTULO_CATEGORIA: Record<ItemFichaParaPainel["categoria"], string> = {
  objecao: "Objeção",
  dor: "Dor",
  desejo: "Desejo",
  fato_decisor: "Fato",
  patrimonio: "Patrimônio",
};

/** Tokens `--estado-*` (≥7:1, DS §12/Fase 8) — NUNCA `--verde`/`--ambar`/
 * `--vermelho` crus (4,5:1, insuficiente para texto pequeno de status). Cor
 * nunca é o único portador: todo item também tem o rótulo por extenso
 * (`ROTULO_CATEGORIA`) — a tela permanece legível em grayscale. */
const COR_CATEGORIA: Record<ItemFichaParaPainel["categoria"], string> = {
  objecao: "var(--estado-vermelho)",
  dor: "var(--estado-ambar)",
  desejo: "var(--estado-verde)",
  fato_decisor: "var(--estado-azul)",
  patrimonio: "var(--estado-neutro)",
};

/**
 * COL 3 — "Ficha do cliente" (Fase 12, F1, 18/09/2026). Recebe `itens` JÁ
 * ORDENADOS pelo servidor (`server/copiloto/ficha.ts::ordenarFicha` —
 * `rank_categoria` asc, `n` desc, `ultima_mencao_em` desc) — este componente
 * NÃO ORDENA NADA: a hierarquia objeção › dor › desejo › fato › patrimônio é
 * regra de negócio e mora no backend, nunca reproposta aqui.
 *
 * 🔴 ÁREA FIXA + ROLÁVEL, RECORTE MEDIDO NO DOM — não estimado, não por
 * proporção de altura de tela:
 *
 *   - `configTeto` (de `copiloto_sessao.ficha_teto_fixos`, já exposto pelo
 *     payload do polling) OU `TETO_PADRAO` é um TETO, NUNCA UMA
 *     META. O valor EFETIVO de itens fixos é `min(teto, cabeDeFato)`.
 *   - `cabeDeFato` é medido por `ResizeObserver` no CONTAINER RAIZ desta
 *     célula (o espaço que a COLUNA ancestral de fato concede à Ficha
 *     inteira) — por MUDANÇA DE TAMANHO/ESCALA (redimensionar janela,
 *     "Tamanho do texto" no shell), NUNCA por tick de polling. Cada item já
 *     renderizado tem sua altura real somada (via `getBoundingClientRect`)
 *     até estourar o espaço disponível; o teste é refeito toda vez que a
 *     lista de itens ou a geometria mudam — nunca uma conta em px estimada
 *     de cabeça.
 *
 *     🔴 Armadilha de geometria já registrada nesta base ("min-h-0 só
 *     funciona se um ancestral define a altura"): medir `clientHeight` do
 *     PRÓPRIO container dos itens fixos (`shrink-0`, que cresce livremente
 *     para caber o conteúdo) sempre daria "cabe tudo" — o elemento se
 *     redimensiona PARA o conteúdo, nunca o contrário. Por isso o container
 *     medido aqui (`raizRef`) é a RAIZ da célula inteira (`flex-1 min-h-0`,
 *     que de fato disputa espaço com o resto do mosaico via flexbox); o
 *     espaço disponível PARA A ÁREA FIXA é esse total menos a altura real da
 *     régua "── mais N ──" quando ela existe (medida também via ref, nunca
 *     estimada).
 *   - PROIBIDO `truncate`/`line-clamp`/`text-ellipsis`/`overflow:hidden` que
 *     corte linha, em QUALQUER conteúdo de dado (texto do item OU evidência)
 *     — item entra INTEIRO na área fixa ou não entra (vai para a rolável).
 *     Nunca um item cortado no meio da frase.
 *   - Entre fixa e rolável: linha-régua com CONTAGEM EXPLÍCITA
 *     (`── mais N · role para ver ──`) — número, nunca "…". Aparece sempre
 *     que houver item na rolável, inclusive quando a fixa tem só 1.
 *
 * Exemplo medido e citado no plano (fica aqui porque é o que impede alguém
 * de "consertar" isto depois, achando bug onde não há): em 768p com escala
 * de texto 18px, o valor efetivo pode ser 4 — e ISSO ESTÁ CORRETO. Não é bug
 * nem falha de `ResizeObserver`: são ~566px disponíveis contra ~590px que 5
 * itens exigiriam nessa escala. Mostrar os 5 ali cortaria o último, que é
 * exatamente o que o dono proibiu. O 5º item não some — vai para a área
 * rolável, e o contador diz quantos há.
 *
 * PISO (decisão do dono, 18/09, `PISO_ITENS_FIXOS` abaixo): com espaço para 1
 * item OU MENOS, a fixa ainda mostra 1 — o PRIMEIRO item sempre entra, mesmo
 * que sozinho estoure o espaço medido (`Math.max(cabem, PISO_ITENS_FIXOS)`).
 * Nunca "abaixo de N vira lista única" (caminho considerado e RECUSADO), e
 * nunca a área fixa some do DOM enquanto houver ao menos 1 item na lista
 * (`itens.length === 0` é o único caso em que ela não existe — ver o `if`
 * de estado vazio logo abaixo desta função).
 *
 * PÓS-SESSÃO (`sessaoEncerrada=true`): sem teto de fixos — tudo rolável,
 * rótulo vira "Ficha do cliente · sessão encerrada", animação de item novo
 * DESLIGADA (não há "novo" depois que a sessão acabou; `useRealceUmaVez`
 * nunca dispara aqui quando `sessaoEncerrada`).
 */
export function FichaCliente({
  itens,
  sessaoEncerrada,
  configTeto,
}: {
  itens: ItemFichaParaPainel[];
  sessaoEncerrada: boolean;
  /** Override de `copiloto_sessao.ficha_teto_fixos` — `null`/ausente usa
   * `TETO_PADRAO`. O payload de polling JÁ expõe a chave
   * (`FichaParaPainel.teto_fixos`, `types/copiloto.ts`) e `PainelCopiloto.tsx`
   * já repassa (`polling.ficha.teto_fixos`) — nenhuma pendência aqui. */
  configTeto?: number | null;
}) {
  const raizRef = useRef<HTMLDivElement>(null);
  const reguaRef = useRef<HTMLParagraphElement>(null);
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [cabeDeFato, setCabeDeFato] = useState<number | null>(null);

  const teto = sessaoEncerrada ? 0 : (configTeto ?? TETO_PADRAO);
  const efetivoOtimista = Math.min(teto, itens.length);
  // Só precisa saber SE haverá régua para medir a altura dela — o CONTEÚDO
  // exato ("mais N") só é decidido depois da medição, mas a régua aparece
  // sempre que a fixa não vai caber a lista inteira (mesmo antes de saber o
  // `cabeDeFato` final, que só pode ser menor ou igual ao otimista).
  const podeTerRegua = itens.length > efetivoOtimista;

  // Mede quantos itens CABEM DE FATO, item por item, pela altura REAL
  // renderizada (nunca estimativa) — dispara por ResizeObserver (mudança de
  // tamanho/escala do container RAIZ desta célula), NUNCA por tick de
  // polling. `useLayoutEffect` (não `useEffect`): a 1ª renderização mostra
  // otimisticamente até `teto` itens (`cabeDeFato` ainda `null`) para poder
  // MEDI-LOS — sem isso haveria dependência circular ("preciso saber quantos
  // cabem para renderizar, preciso renderizar para medir"). Medir ANTES do
  // navegador pintar o frame evita um flash visível de itens que seriam
  // cortados no frame seguinte (mesmo raciocínio de
  // `PainelTranscricao.tsx::useLayoutEffect` para o auto-scroll).
  //
  // 🔴 F-3 (Fable, rodada 2, 18/09): CATRACA que só descia. `itemRefs` só
  // recebia refs dos itens EXIBIDOS como fixos (`itensFixos`, fatiados por
  // `efetivo` = `cabeDeFato` já encolhido) — depois que o container
  // encolhia uma vez, `itemRefs.get(i)` para `i >= cabeDeFato` nunca tinha
  // entrada nenhuma (esse item nunca fora montado ali), e o `for` abaixo
  // dava `break` no primeiro `undefined`, ANTES de sequer tentar medir um
  // espaço maior. Ao crescer de novo (ex.: "Tamanho do texto" volta a
  // normal), `medir()` repetia o mesmo resultado pequeno para sempre — só
  // recarregar a página resetava `cabeDeFato` para `null`.
  //
  // Correção: as refs para medição vêm de um container-SOMBRA
  // (`sombraRef`), sempre renderizado com `efetivoOtimista` itens — o teto
  // OTIMISTA (nunca o `cabeDeFato` já encolhido) — fora do fluxo visual
  // (`absolute`, `invisible`, `aria-hidden`, sem interação). A área fixa
  // VISÍVEL continua fatiada por `efetivo`/`cabeDeFato`; só a MEDIÇÃO deixa
  // de depender do que está exibido, então uma medição nova sempre pode
  // subir de novo até o otimista, nunca fica presa no mínimo já visto.
  useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || teto === 0 || itens.length === 0) {
      setCabeDeFato(0);
      return;
    }

    function medir() {
      const alturaRegua = podeTerRegua ? (reguaRef.current?.getBoundingClientRect().height ?? 0) : 0;
      const disponivel = raiz!.clientHeight - alturaRegua;
      let usado = 0;
      let cabem = 0;
      for (let i = 0; i < itens.length && i < teto; i++) {
        const el = itemRefs.current.get(i);
        if (!el) break;
        const altura = el.getBoundingClientRect().height;
        const caberia = usado + altura <= disponivel;
        // PISO (decisão do dono, 18/09): o PRIMEIRO item sempre entra, mesmo
        // que sozinho já estoure o espaço medido — é a objeção mais urgente
        // (item[0] da lista ordenada pelo servidor), nunca uma célula vazia
        // com item disponível. A partir do 2º item em diante, só entra se
        // couber de fato (nunca corta linha).
        if (!caberia && cabem >= PISO_ITENS_FIXOS) break;
        usado += altura;
        cabem++;
      }
      setCabeDeFato(Math.max(cabem, PISO_ITENS_FIXOS));
    }

    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(raiz);
    return () => observer.disconnect();
    // `itens.length`/`teto`/`podeTerRegua` de propósito nas deps: uma lista
    // maior/menor ou um teto novo exige remedir mesmo sem o container ter
    // mudado de tamanho — mas a MEDIÇÃO em si nunca roda em tick de timer.
  }, [itens.length, teto, podeTerRegua]);

  if (itens.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {sessaoEncerrada && <p className="shrink-0 text-rotulo font-semibold text-tinta-fraca">Sessão encerrada</p>}
        <p className="text-sm text-tinta-suave">Nenhum fato relevante identificado ainda nesta sessão.</p>
      </div>
    );
  }

  const efetivo = cabeDeFato ?? efetivoOtimista;
  const itensFixos = itens.slice(0, efetivo);
  const itensRolaveis = itens.slice(efetivo);
  // F-3: base da medição — SEMPRE o teto otimista, nunca `efetivo`/
  // `cabeDeFato` já encolhido. É esta lista (não `itensFixos`) que alimenta
  // o container-sombra abaixo, para a catraca poder subir de novo.
  const itensParaMedir = itens.slice(0, efetivoOtimista);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* 🔴 Fase 13 (D-5) — o rótulo "Ficha do cliente" SAIU: esta folha passou
       * a viver dentro de uma aba que já se chama "Ficha" (`AbasColuna3`), e
       * repetir o nome ~20 px abaixo do rótulo da aba é o mesmo fato duas
       * vezes numa célula de 28% de largura. O que SOBREVIVE é só o que a
       * aba não diz: "Sessão encerrada" — o aviso de por que não há mais
       * item novo nem área fixa. Na sessão ao vivo, nenhuma linha aqui
       * (≈23 px devolvidos ao conteúdo). */}
      {sessaoEncerrada && <p className="shrink-0 text-rotulo font-semibold text-tinta-fraca">Sessão encerrada</p>}

      {/* `raizRef` é o que participa de verdade do flex da COLUNA ancestral
       * (`flex-1 min-h-0`) — é o `clientHeight` DELE, não do container de
       * itens (que é `shrink-0` e sempre cresceria "para caber"), que dá o
       * espaço disponível real. */}
      <div ref={raizRef} className="relative flex min-h-0 flex-1 flex-col gap-1.5">
        {/* Container-SOMBRA de medição (F-3, 18/09): SEMPRE monta até
         * `efetivoOtimista` itens — nunca fatiado por `cabeDeFato` — para
         * `itemRefs` ter uma entrada por índice candidato, mesmo depois de
         * o container ter encolhido uma vez. `absolute` + `invisible` tira
         * do fluxo visual e da pintura; `aria-hidden` tira da árvore de
         * acessibilidade (é puramente instrumental, o conteúdo real já
         * está na área fixa/rolável abaixo). `pointer-events-none` porque
         * nunca deve ser alvo de clique/toque.
         *
         * 🔴 F3-1 (Fable, rodada 3, 18/09): `absolute` SEM `relative` no
         * ancestral e SEM `inset-x-0` deixava o bloco medir na largura do
         * primeiro ancestral posicionado — no caso, a VIEWPORT (nenhum
         * ancestral entre esta div e `<body>` tinha `position` diferente de
         * `static`; conferido em `Coluna.tsx`/`ConduzirSessaoApp`/`AppShell`,
         * nenhum é `relative`). A sombra então tinha ~1536px de largura para
         * quebrar linha, contra os ~28% da COL 3 dos itens visíveis — uma
         * evidência de 120 chars cabia em 1 linha na sombra e 2 na coluna
         * real, subestimando a altura medida e sobre-contando quantos itens
         * cabiam. `relative` aqui (raiz JÁ é o container medido, `raizRef`)
         * + `inset-x-0` na sombra fixam a MESMA largura em ambas — a sombra
         * só pode medir mais estreito ou igual ao espaço real, nunca mais
         * largo. */}
        {teto > 0 && (
          <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 -z-10 flex shrink-0 flex-col gap-1.5">
            {itensParaMedir.map((item, i) => (
              <ItemFicha
                key={`sombra-${item.categoria}-${item.texto}`}
                item={item}
                sessaoEncerrada={sessaoEncerrada}
                somenteMedicao
                medirRef={(el) => {
                  if (el) itemRefs.current.set(i, el);
                  else itemRefs.current.delete(i);
                }}
              />
            ))}
          </div>
        )}

        {/* Área FIXA — só existe no DOM com pelo menos 1 item cabendo
         * (piso). Com `teto===0` (sessão encerrada) não é renderizada —
         * precedente `BlocoCuidado`: "nunca um card vazio dizendo nada".
         * `shrink-0`: o conteúdo em si nunca é cortado por overflow — quem
         * decide QUANTOS itens entram aqui é a medição acima, nunca CSS. */}
        {teto > 0 && (
          <div className="flex shrink-0 flex-col gap-1.5">
            {itensFixos.map((item) => (
              <ItemFicha key={`${item.categoria}-${item.texto}`} item={item} sessaoEncerrada={sessaoEncerrada} />
            ))}
          </div>
        )}

        {itensRolaveis.length > 0 && (
          <>
            {/* Régua com CONTAGEM EXPLÍCITA — número, nunca "…". Declara o
             * que existe em vez de esconder. */}
            <p ref={reguaRef} aria-hidden="true" className="shrink-0 text-center text-legenda text-tinta-fraca">
              ── mais {itensRolaveis.length} · role para ver ──
            </p>
            <div
              role="region"
              aria-label={`Mais ${itensRolaveis.length} itens da ficha do cliente`}
              tabIndex={TAB_INDEX_ROLAVEL}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="flex flex-col gap-1.5 pr-1">
                {itensRolaveis.map((item) => (
                  <ItemFicha key={`${item.categoria}-${item.texto}`} item={item} sessaoEncerrada={sessaoEncerrada} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Um item da Ficha — categoria (cor de estado + rótulo por extenso, nunca só
 * cor) + texto do fato + evidência (citação literal). F7 "sistema vivo":
 * item novo pulsa UMA vez e assenta (`entrar-insight`), nunca em sessão
 * encerrada (não há "novo" depois que a sessão acabou — `useRealceUmaVez`
 * recebe `ativo=false` nesse caso, então nunca dispara).
 *
 * Sem `truncate`/`line-clamp`/`overflow:hidden` que corte linha — o item
 * entra inteiro ou vai para a rolável (decisão de QUEM entra é do pai,
 * `FichaCliente`; este componente nunca corta o próprio conteúdo).
 */
function ItemFicha({
  item,
  sessaoEncerrada,
  medirRef,
  somenteMedicao = false,
}: {
  item: ItemFichaParaPainel;
  sessaoEncerrada: boolean;
  /** Só passado pelos itens da área FIXA — é como `FichaCliente` mede a
   * altura real de cada um via `getBoundingClientRect`. Itens da rolável não
   * precisam disso (não entram na conta do que cabe). */
  medirRef?: (el: HTMLElement | null) => void;
  /** F-3 (18/09): `true` só para as cópias do container-SOMBRA de medição —
   * `invisible`, nunca vistas de verdade, então o pulso "item novo" não deve
   * disparar ali (seria CSS animation rodando à toa, sem efeito visível). */
  somenteMedicao?: boolean;
}) {
  const destacar = useRealceUmaVez(!sessaoEncerrada && !somenteMedicao, `${item.categoria}-${item.texto}`, 240);
  const cor = COR_CATEGORIA[item.categoria];

  return (
    <div
      ref={medirRef}
      // `border-l-2` — custo vertical zero, cor de estado sem gastar altura
      // (a régua da tela travada: altura é o recurso escasso). Geometria
      // constante: a borda já existe desde o primeiro render, largura nunca
      // varia.
      className={`rounded-controle border border-l-2 border-linha px-2.5 py-2 ${destacar ? "anim-entrar-insight" : ""}`}
      style={{ borderLeftColor: cor }}
    >
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {/* "Forte" = peso e caixa, NUNCA tamanho (custa 0px) — nenhum texto
         * aqui passa de `text-sm`. */}
        <span className="text-legenda font-bold uppercase tracking-wide" style={{ color: cor }}>
          {ROTULO_CATEGORIA[item.categoria]}
        </span>
        <span className="text-sm text-tinta">{item.texto}</span>
      </p>
      <p className="mt-1 text-legenda italic text-tinta-fraca">&ldquo;{item.evidencia}&rdquo;</p>
      <p className="mt-1 text-legenda text-tinta-fraca">
        {item.n > 1 ? `Dito ${item.n}× · ` : ""}
        {formatarHora(item.ultima_mencao_em)}
      </p>
    </div>
  );
}
