"use client";

import type { ReactNode } from "react";
import { SESSAO_POR_ITEM, type ChaveItemPasta } from "@/lib/pasta/catalogo";
import { ORDEM_SESSOES, ROTULO_SESSAO, type ChaveSessao } from "@/lib/pasta/trilho";
import type { EstadoItemPasta, ItemPasta } from "@/lib/pasta/derivar";
import { ACAO_POR_ITEM_PASTA, ITENS_EM_GAVETA, TITULO_ACAO_ITEM_PASTA, caminhoItemPasta } from "@/lib/pasta/rotas";
import { Selo } from "@/components/ui/Selo";

/** A mesma frase do `ui/Selo#SeloIA` — aqui ela vive no `title`, não no fluxo. */
const FRASE_SELO_IA = "Gerado por IA — insumo do advogado, não parecer";
import { SeloPresenca } from "@/components/agenda/SeloPresenca";

/**
 * Fase 4 (agente H) — sinais da Sessão que a Pasta reflete no cartão
 * `sessao` além do estado derivado: presença (fato 0051), sala e ligação por
 * IA. `undefined` = a Ficha ainda não carrega o campo (sem informação).
 */
export interface SinaisSessaoPasta {
  proximaSessaoEm: string | null;
  /** `undefined` = coluna ausente no payload; `null` = ainda não confirmou. */
  presencaConfirmadaEm: string | null | undefined;
  presencaConfirmadaVia?: string | null;
  temLinkSala: boolean | null;
  ligacaoIaStatus: string | null;
}

const ROTULO_LIGACAO_IA: Record<string, { rotulo: string; tom: "azul" | "latao" | "verde" | "ambar" | "vermelho" | "neutro" }> = {
  na_fila: { rotulo: "IA vai ligar", tom: "azul" },
  discando: { rotulo: "IA discando", tom: "azul" },
  em_ligacao: { rotulo: "IA em ligação", tom: "latao" },
  concluida: { rotulo: "IA ligou", tom: "verde" },
  sem_resposta: { rotulo: "IA: não atendeu", tom: "ambar" },
  falhou: { rotulo: "IA: falhou", tom: "vermelho" },
  cancelada: { rotulo: "IA: cancelada", tom: "neutro" },
};

/**
 * "A Pasta do Cliente" (Fase 2 do plano, `brain/Diário/2026-09-04.md`) — a
 * tela que vira a RAIZ da Ficha 360, substituindo `ChecklistPendencias` +
 * primeira aba do primeiro grupo como conteúdo padrão de `/jornadas/[id]`
 * (sem hash). Onde antes 9 dos 14 artefatos ficavam invisíveis fora do grupo
 * de abas ativo (`Abas.tsx`, `abasVisiveis = grupoAtivo.abas`), aqui os itens
 * visíveis para o papel (já filtrados por `derivarPasta`) aparecem todos de
 * uma vez.
 *
 * Redesenho visual (pedido do Marcio, 04/09/2026 — "reorganize esses cards,
 * não ficou muito visual"; revisto em 16/09 — direção "clean e convencional",
 * ver `docs/DESIGN-SYSTEM.md` nota T1): os itens acionáveis (`pronto` /
 * `em_revisao` / `falta`) formam a grade de cartões, e o peso visual varia com
 * a urgência: `falta` ganha borda de destaque âmbar e texto de ação forte,
 * `pronto` fica compacto e calmo. Os itens `ainda_nao` SAÍRAM do grid: viram
 * uma linha de texto só, por grupo ("3 itens ainda não — Patrimônio,
 * Documentos, Croqui"), com a razão no `title` — nada some, só deixa de
 * ocupar espaço de cartão acionável. Estado NUNCA é só cor: sempre glifo +
 * texto (daltonismo/leitor de tela).
 *
 * Reforço da regra de segurança (não é redundância, é a garantia de que a
 * camada visual não reabre o que `derivarPasta` já fechou): este componente
 * SÓ itera `itens` — nunca lê `CATALOGO_PASTA` nem reconstrói a lista
 * completa dos 14. Um item de patrimônio para quem não pode ver
 * simplesmente não está no array — não existe card cinza "bloqueado" em
 * lugar nenhum deste arquivo.
 */

/**
 * Fase 6 — os grupos da Pasta deixaram de ser "Antes / Na / Depois da sessão"
 * e passaram a ser **as três sessões que são a espinha do produto**:
 * Sessão de Viabilidade · Croqui estrutural · Entrega da holding.
 *
 * A lista `MOMENTOS` hardcoded que vivia aqui morreu: o agrupamento agora sai
 * de `SESSAO_POR_ITEM` (`lib/pasta/catalogo.ts`), a MESMA constante que o
 * trilho usa via `SESSAO_POR_PASSO`. Eram duas listas que podiam divergir —
 * e a tela e o trilho passariam a contar histórias diferentes sobre a mesma
 * jornada. Agora é uma fonte só.
 *
 * A sessão 3 (Entrega da holding) não tem item de Pasta hoje: ela é servida
 * por `execucao_marcos` (o cartão "O que o sistema fez"), não por artefato.
 * Um grupo sem item simplesmente não é renderizado — nada de caixa vazia.
 */
const GRUPOS_SESSAO: { id: ChaveSessao; titulo: string; chaves: ChaveItemPasta[] }[] = ORDEM_SESSOES.map((sessao) => ({
  id: sessao,
  titulo: ROTULO_SESSAO[sessao],
  chaves: (Object.keys(SESSAO_POR_ITEM) as ChaveItemPasta[]).filter((chave) => SESSAO_POR_ITEM[chave] === sessao),
}));

const ROTULO_ESTADO: Record<EstadoItemPasta, string> = {
  pronto: "Pronto",
  em_revisao: "Em revisão",
  falta: "Falta",
  // Lei de texto §2: estado ≤ 4 palavras. "Ainda não é hora" aparecia até 9
  // vezes na mesma tela — 36 palavras para dizer o que o glifo tracejado e o
  // `title` do cartão já dizem.
  ainda_nao: "Ainda não",
};

/**
 * Peso visual por estado — a hierarquia É a informação:
 * - `falta` (o único alarme real, `derivar.ts`): borda de destaque âmbar à
 *   esquerda + texto de ação em tinta forte.
 * - `em_revisao`: âmbar, sem o destaque de borda — atenção, não alarme.
 * - `pronto`: verde, calmo e compacto (sem descrição redundante).
 * - `ainda_nao`: não entra mais nesta grade — vira linha de texto no grupo
 *   (ver `LinhaAindaNao` mais abaixo).
 */
const ESTILO_ESTADO: Record<Exclude<EstadoItemPasta, "ainda_nao">, { cartao: string; texto: string; titulo: string }> = {
  pronto: {
    cartao: "border-linha bg-papel-elevado",
    texto: "text-[color:var(--verde)]",
    titulo: "text-tinta",
  },
  em_revisao: {
    cartao: "border-linha-forte bg-papel-elevado",
    texto: "text-[color:var(--ambar)]",
    titulo: "text-tinta",
  },
  falta: {
    cartao: "border-linha-forte border-l-[3px] border-l-ambar-borda bg-papel-elevado",
    texto: "text-[color:var(--ambar)]",
    titulo: "text-tinta",
  },
};

/** Glifo por estado — forma distinta por estado, nunca só cor. */
const TRACOS_ESTADO: Record<EstadoItemPasta, ReactNode> = {
  pronto: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  em_revisao: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.2v4l2.6 1.5" />
    </>
  ),
  falta: <path d="M4 10h11.5M10.5 4.5L16 10l-5.5 5.5" />,
  ainda_nao: <circle cx="10" cy="10" r="6.75" strokeDasharray="2.4 3.1" />,
};

function IconeEstado({ estado }: { estado: EstadoItemPasta }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TRACOS_ESTADO[estado]}
    </svg>
  );
}

/**
 * Status de cada momento — usado só para decidir qual `<details>` abre
 * sozinho (T3, 16/09/2026 removeu o nó visual da espinha; `TrilhoDaFicha`,
 * sticky no topo, já é quem desenha posição e estado dos 3 momentos):
 * - `concluido`: todos os acionáveis do momento estão prontos.
 * - `atual`: há trabalho acionável aqui agora.
 * - `futuro`: tudo ainda é `ainda_nao`.
 */
function statusDoMomento(itensDoMomento: ItemPasta[]): "concluido" | "atual" | "futuro" {
  const acionaveis = itensDoMomento.filter((i) => i.estado !== "ainda_nao");
  if (acionaveis.length === 0) return "futuro";
  if (acionaveis.every((i) => i.estado === "pronto")) return "concluido";
  return "atual";
}

/**
 * `CartaoItem` só recebe itens ACIONÁVEIS (`pronto` / `em_revisao` / `falta`)
 * — `ainda_nao` saiu do grid e virou `LinhaAindaNao` (ver abaixo).
 */
function CartaoItem({
  item,
  aoAbrirGaveta,
  sinaisSessao,
}: {
  item: ItemPasta & { estado: Exclude<EstadoItemPasta, "ainda_nao"> };
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
  sinaisSessao?: SinaisSessaoPasta;
}) {
  const estilo = ESTILO_ESTADO[item.estado];
  const emGaveta = ITENS_EM_GAVETA.has(item.chave);
  const href = !emGaveta ? caminhoItemPasta(item.chave) : undefined;
  const acao = ACAO_POR_ITEM_PASTA[item.chave];
  // O nome inteiro do artefato e a frase inteira do verbo saíram do fluxo
  // (§2/§9.2, `catalogo.ts` e `rotas.ts`) — reaparecem aqui, e só aqui, como
  // `title`: quem procura "POP 03", "IR" ou "Diagnóstico da SV" ainda acha.
  const tituloDoCartao = item.titulo ?? TITULO_ACAO_ITEM_PASTA[item.chave];
  const extrasSessao = item.chave === "sessao" && sinaisSessao && sinaisSessao.proximaSessaoEm ? sinaisSessao : null;
  const ligacaoIa = item.chave === "sessao" && sinaisSessao?.ligacaoIaStatus ? ROTULO_LIGACAO_IA[sinaisSessao.ligacaoIaStatus] : null;

  // `pronto` sem nota fica sem descrição de propósito: "Pronto · Concluído."
  // é redundância — cartão feito merece ser compacto, não ocupar o mesmo
  // espaço de um cartão que ainda pede trabalho.
  const descricao = item.nota ?? (item.estado === "pronto" ? undefined : acao);

  const conteudo = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5" title={tituloDoCartao}>
        <p className={`text-sm font-bold leading-snug ${estilo.titulo}`} title={item.titulo}>
          {item.rotulo}
        </p>
        <p className={`inline-flex items-center gap-1.5 text-legenda font-bold ${estilo.texto}`}>
          <IconeEstado estado={item.estado} />
          {ROTULO_ESTADO[item.estado]}
        </p>
        {descricao && (
          <p
            className={`text-sm leading-snug ${item.estado === "falta" ? "font-medium text-tinta" : "text-tinta-suave"}`}
            title={descricao === acao ? TITULO_ACAO_ITEM_PASTA[item.chave] : undefined}
          >
            {descricao}
          </p>
        )}
      </div>
      {/* Fase 5: a frase inteira do `SeloIA` ("Gerado por IA — insumo do
          advogado, não parecer") aparecia CINCO vezes nesta tela — 45 das 222
          palavras da Ficha. Aqui o cartão é um ponteiro, não o conteúdo de IA:
          o rótulo fica, curto, e a frase inteira vai para o `title`. Nas telas
          onde o conteúdo gerado É o conteúdo (Briefing, Análise da Sessão,
          Material), o `SeloIA` completo continua intocado. */}
      {item.procedencia === "gerado_ia" && (
        <Selo tom="neutro" title={FRASE_SELO_IA} className="self-start">
          IA
        </Selo>
      )}
      {(extrasSessao || ligacaoIa) && (
        <div className="flex flex-wrap gap-1.5">
          {extrasSessao && <SeloPresenca presencaConfirmadaEm={extrasSessao.presencaConfirmadaEm} inicioEm={extrasSessao.proximaSessaoEm!} via={extrasSessao.presencaConfirmadaVia} />}
          {extrasSessao && extrasSessao.temLinkSala !== null && (
            <Selo tom={extrasSessao.temLinkSala ? "verde" : "ambar"}>{extrasSessao.temLinkSala ? "Sala pronta" : "Sem link da sala"}</Selo>
          )}
          {ligacaoIa && <Selo tom={ligacaoIa.tom}>{ligacaoIa.rotulo}</Selo>}
        </div>
      )}
    </>
  );

  const classeBase = `flex min-h-11 flex-col gap-1 rounded-controle border px-3 py-2 text-left transition-all ${estilo.cartao}`;
  const classeClicavel = `${classeBase} hover:-translate-y-0.5 hover:border-[color:var(--latao)] hover:shadow-[var(--sombra-cartao)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao)]`;

  if (emGaveta) {
    // Camada 2 (Gaveta): item de uma das 5 chaves migradas — abre o painel
    // lateral em vez de navegar por hash. `<button>`, não `<a href="#...">`,
    // porque não há navegação real: o estado da gaveta vive no componente
    // pai (`page.tsx`), que decide o `<Gaveta>` a renderizar por
    // `item.chave`.
    return (
      <button type="button" onClick={() => aoAbrirGaveta(item.chave)} className={classeClicavel}>
        {conteudo}
      </button>
    );
  }

  return (
    <a
      href={href!}
      onClick={(evento) => {
        // `next/link`/navegação padrão de âncora só reescrevem
        // `window.location.hash` — não há garantia de que o Next App Router
        // dispare `hashchange` de forma síncrona quando o pathname não muda
        // (confirmado manualmente: só trocar o hash, mesmo por link nativo,
        // não acorda o listener de `ConteudoPastaOuAbas`/`Abas` a tempo).
        // Como o roteamento é 100% local (mesma página, troca de aba), a
        // navegação nativa do navegador já move o hash — só precisamos
        // garantir que o listener seja avisado, então evitamos qualquer
        // interceptação de framework e disparamos o evento nós mesmos.
        evento.preventDefault();
        window.location.hash = href!;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
      className={classeClicavel}
    >
      {conteudo}
    </a>
  );
}

/**
 * Item 4 (T3, 16/09/2026): cartão `ainda_nao` deixou de ser cartão. Numa
 * jornada nova são até 9 cartões-fantasma tracejados — ~650px de tela só
 * para dizer "ainda não é hora". Vira uma linha de texto por grupo: "3 itens
 * ainda não — Patrimônio, Documentos, Croqui", com a razão de cada um no
 * `title` (mesma cirurgia de `painel/Bloco.tsx` — hierarquia por posição).
 * Continua visível e legível: nada de `opacity` reduzindo contraste, só
 * deixa de ocupar espaço de cartão acionável.
 */
function LinhaAindaNao({ itens }: { itens: ItemPasta[] }) {
  if (itens.length === 0) return null;
  const titulo = itens.length === 1 ? `${itens.length} item ainda não` : `${itens.length} itens ainda não`;
  return (
    <p className="flex min-h-11 flex-wrap items-center gap-1.5 px-1 text-sm text-tinta-fraca">
      <IconeEstado estado="ainda_nao" />
      <span>
        {titulo} —{" "}
        {itens.map((item, indice) => (
          <span key={item.chave} title={item.nota ?? undefined}>
            {item.rotulo}
            {indice < itens.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    </p>
  );
}

export function PastaDoCliente({
  itens,
  aoAbrirGaveta,
  sinaisSessao,
  sessaoAtual,
}: {
  itens: ItemPasta[];
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
  /** Presença/sala/ligação IA para o cartão "Sessão" (Fase 4). Opcional: sem ele, o cartão fica como antes. */
  sinaisSessao?: SinaisSessaoPasta;
  /**
   * Qual das 3 sessoes esta acesa no trilho (`agruparPorSessao`). Fase 6: so
   * ela nasce ABERTA; as outras ficam recolhidas com o resumo. Sem ela
   * (jornada so com `null`, a borda do trilho sem passo aceso), a PRIMEIRA
   * que tiver trabalho abre - nunca todas, e nunca nenhuma por engano.
   */
  sessaoAtual?: ChaveSessao | null;
}) {
  // Contador honesto: o denominador é só o que já é "hora de fazer"
  // (pronto + em_revisao + falta) — `ainda_nao` fica de fora do total tanto
  // quanto do numerador. Contar "3 de 14" para um cliente que acabou de
  // preencher o Formulário faria parecer 11 pendências atrasadas, quando na
  // verdade 9 delas são "ainda não é hora" (dependem da Sessão de
  // Viabilidade acontecer). É a diferença entre "estou atrasado" e "estou no
  // caminho" (plano do arquiteto, Diário 2026-09-04).
  const itensAcionaveis = itens.filter((i) => i.estado !== "ainda_nao");
  const total = itensAcionaveis.length;
  const prontos = itensAcionaveis.filter((i) => i.estado === "pronto").length;
  const aindaNao = itens.length - total;

  const momentosVisiveis = GRUPOS_SESSAO.map((momento) => ({
    ...momento,
    itens: itens.filter((i) => momento.chaves.includes(i.chave)),
  })).filter((momento) => momento.itens.length > 0);

  // Sem sessao acesa, abre a primeira que tem trabalho a fazer. `-1` (tudo
  // pronto, ou tudo "ainda nao") deixa as tres recolhidas - que e a verdade.
  const indicePrimeiraComTrabalho = momentosVisiveis.findIndex((m) => statusDoMomento(m.itens) === "atual");

  return (
    <div className="flex flex-col gap-bloco">
      <div className="flex flex-col gap-1 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2">
        {/* Número primeiro (§2): "3 de 7 prontos", não "Você já tem 3 de 7
            itens desta fase". A barra segmentada decorativa saiu (T3,
            16/09/2026): dizia, com cor, exatamente o que esta frase já diz
            com texto — duas representações do mesmo fato na mesma dobra. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-tinta">
            <span className="font-bold">{prontos}</span> de <span className="font-bold">{total}</span> prontos
          </p>
          {aindaNao > 0 && (
            <p className="text-legenda text-tinta-fraca" title="Estes itens dependem da Sessão de Viabilidade acontecer.">
              {aindaNao} depois da sessão
            </p>
          )}
        </div>
      </div>

      {/* Os 3 momentos da jornada, cada um recolhível (`<details>`). A espinha
          vertical + nó numerado saiu (T3, 16/09/2026): o `TrilhoDaFicha`
          sticky no topo da página já desenha os 3 momentos com posição e
          estado — repeti-los aqui, 200px abaixo, era a mesma informação
          duas vezes. Sem o `pl-10` da espinha, a grade ganha largura útil. */}
      <div className="flex flex-col gap-bloco">
        {momentosVisiveis.map((momento) => {
          const acionaveisDoMomento = momento.itens.filter((i): i is ItemPasta & { estado: Exclude<EstadoItemPasta, "ainda_nao"> } => i.estado !== "ainda_nao");
          const aindaNaoDoMomento = momento.itens.filter((i) => i.estado === "ainda_nao");
          const prontosDoMomento = acionaveisDoMomento.filter((i) => i.estado === "pronto").length;
          const aberta = sessaoAtual ? momento.id === sessaoAtual : momento.id === momentosVisiveis[indicePrimeiraComTrabalho]?.id;
          const resumo =
            acionaveisDoMomento.length === 0
              ? "mais adiante"
              : `${prontosDoMomento} de ${acionaveisDoMomento.length} ${acionaveisDoMomento.length === 1 ? "pronto" : "prontos"}`;
          return (
            <details key={momento.id} open={aberta} aria-labelledby={`momento-${momento.id}`} className="group">
              <summary className="mb-item flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-item gap-y-0.5 marker:content-none">
                <h2 id={`momento-${momento.id}`} className="text-subtitulo font-bold leading-tight text-tinta">
                  {momento.titulo}
                </h2>
                <span className="flex items-center gap-item text-legenda font-medium text-tinta-fraca">
                  {resumo}
                  <span aria-hidden="true" className="group-open:hidden">ver</span>
                  <span aria-hidden="true" className="hidden group-open:inline">esconder</span>
                </span>
              </summary>
              {acionaveisDoMomento.length > 0 && (
                <div className="grid gap-item pb-item sm:grid-cols-2 xl:grid-cols-3">
                  {acionaveisDoMomento.map((item) => (
                    <CartaoItem key={item.chave} item={item} aoAbrirGaveta={aoAbrirGaveta} sinaisSessao={sinaisSessao} />
                  ))}
                </div>
              )}
              <LinhaAindaNao itens={aindaNaoDoMomento} />
            </details>
          );
        })}
      </div>
    </div>
  );
}
