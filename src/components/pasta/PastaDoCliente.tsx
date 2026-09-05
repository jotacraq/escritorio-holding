"use client";

import type { ReactNode } from "react";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
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
 * não ficou muito visual"): a grade uniforme de cartões idênticos virou uma
 * LINHA DE JORNADA vertical. Os 3 momentos são nós numerados numa espinha à
 * esquerda (verde+check = concluído · laranja da marca = há trabalho aqui
 * agora · fantasma = futuro), cada item tem um ícone de identidade próprio
 * num selo tingido pelo estado, e o peso visual varia com a urgência:
 * `falta` ganha borda de destaque âmbar e texto de ação forte, `pronto` fica
 * compacto e calmo, `ainda_nao` vira cartão-fantasma tracejado — presente e
 * legível (nada é escondido), mas visivelmente "ainda não materializado".
 * Estado NUNCA é só cor: sempre glifo + texto (daltonismo/leitor de tela).
 *
 * Reforço da regra de segurança (não é redundância, é a garantia de que a
 * camada visual não reabre o que `derivarPasta` já fechou): este componente
 * SÓ itera `itens` — nunca lê `CATALOGO_PASTA` nem reconstrói a lista
 * completa dos 14. Um item de patrimônio para quem não pode ver
 * simplesmente não está no array — não existe card cinza "bloqueado" em
 * lugar nenhum deste arquivo.
 */

/**
 * Os 3 momentos amplos do plano do arquiteto. Mapeamento de
 * `ChaveItemPasta` decidido ao ler `catalogo.ts`/`derivar.ts`:
 * - "Antes da sessão": tudo que é preparação (Formulário, Ligação, Links,
 *   Briefing) mais o próprio agendamento da Sessão (`sessao` cobre tanto
 *   "agendar" quanto "realizar" — ela é o evento-gonzo entre antes/durante,
 *   e como todo pré-requisito de "na sessão"/"depois" é `sessao_realizada`,
 *   faz mais sentido ancorar o cartão de agendamento em "antes").
 * - "Na sessão": os dois artefatos que só existem por causa do evento em si
 *   (Transcrição, Análise da Sessão) — não são preparação nem produto final.
 * - "Depois da sessão": tudo que só o faz sentido consumir depois que a SV
 *   aconteceu (Diagnóstico, Relatório, Croqui, Material) mais o que não tem
 *   relação de pré-requisito com a sessão em si, mas semanticamente pertence
 *   ao dossiê final do caso (Patrimônio, Familiares, Documentos) — mantido
 *   junto do plano do arquiteto em vez de um 4º momento "Patrimônio", porque
 *   a Fase 2 é sobre PARAR de esconder itens atrás de grupo, não recriar um
 *   grupo novo com outro nome.
 */
const MOMENTOS: { id: string; titulo: string; chaves: ChaveItemPasta[] }[] = [
  { id: "antes", titulo: "Antes da sessão", chaves: ["formulario", "ligacao", "links", "briefing", "sessao"] },
  { id: "durante", titulo: "Na sessão", chaves: ["transcricao", "analise_sessao"] },
  {
    id: "depois",
    titulo: "Depois da sessão",
    chaves: ["diagnostico_sv", "relatorio_sv", "croqui", "material", "patrimonio", "familiares", "documentos"],
  },
];

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
 * - `ainda_nao`: cartão-fantasma — borda tracejada, sem elevação, tinta
 *   rebaixada mas legível (contraste preservado; nada de `opacity` no texto).
 */
const ESTILO_ESTADO: Record<EstadoItemPasta, { cartao: string; selo: string; texto: string; titulo: string }> = {
  pronto: {
    cartao: "border-linha bg-papel-elevado",
    selo: "bg-verde-fraco text-[color:var(--verde)]",
    texto: "text-[color:var(--verde)]",
    titulo: "text-tinta",
  },
  em_revisao: {
    cartao: "border-linha-forte bg-papel-elevado",
    selo: "bg-ambar-fraco text-[color:var(--ambar)]",
    texto: "text-[color:var(--ambar)]",
    titulo: "text-tinta",
  },
  falta: {
    cartao: "border-linha-forte border-l-[3px] border-l-ambar-borda bg-papel-elevado",
    selo: "bg-ambar-fraco text-[color:var(--ambar)]",
    texto: "text-[color:var(--ambar)]",
    titulo: "text-tinta",
  },
  ainda_nao: {
    cartao: "border-dashed border-linha bg-transparent",
    selo: "border border-dashed border-linha-forte bg-transparent text-tinta-fraca",
    texto: "text-tinta-fraca",
    titulo: "text-tinta-suave",
  },
};

/**
 * Ícone de identidade por artefato — o que quebra a monotonia de 14 caixas
 * idênticas. Decorativo (`aria-hidden` no `<svg>` que os envolve): o nome do
 * item continua sendo o texto do cartão, o ícone nunca é o único sinal.
 */
const TRACOS_ITEM: Record<ChaveItemPasta, ReactNode> = {
  formulario: (
    <>
      <rect x="5" y="2.75" width="10" height="14.5" rx="1.5" />
      <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
    </>
  ),
  ligacao: (
    <path
      fill="currentColor"
      stroke="none"
      d="M6.8 3.1c.6-.6 1.6-.5 2 .2l1.1 1.7c.4.6.3 1.4-.2 1.9l-.7.7c.6 1.2 1.6 2.2 2.8 2.8l.7-.7c.5-.5 1.3-.6 1.9-.2l1.7 1.1c.7.4.8 1.4.2 2l-.8.8c-.6.6-1.5.9-2.3.6-4-1.2-6.2-3.4-7.4-7.4-.3-.8 0-1.7.6-2.3l.4-.3z"
    />
  ),
  links: (
    <>
      <path d="M8.5 6.8l1-1a2.9 2.9 0 014.1 4.1l-1.6 1.6" />
      <path d="M11.5 13.2l-1 1a2.9 2.9 0 01-4.1-4.1l1.6-1.6" />
      <path d="M8.3 11.7l3.4-3.4" />
    </>
  ),
  briefing: (
    <>
      <path d="M10 3.5l1.3 3.7 3.7 1.3-3.7 1.3L10 13.5 8.7 9.8 5 8.5l3.7-1.3L10 3.5z" />
      <path d="M15 13l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6L15 13z" />
    </>
  ),
  sessao: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8.5h13M7 2.75v3M13 2.75v3" />
    </>
  ),
  transcricao: <path d="M4.5 5.5h11M4.5 9h11M4.5 12.5h7M4.5 16h4" />,
  analise_sessao: (
    <>
      <path d="M4 16.5h12" />
      <path d="M6.5 13.5V10M10 13.5V6.5M13.5 13.5V8.5" />
    </>
  ),
  diagnostico_sv: (
    <>
      <rect x="4.5" y="4" width="11" height="13.5" rx="1.5" />
      <rect x="8" y="2.5" width="4" height="3" rx="1" />
      <path d="M7 11.5h1.6l1.2-2.4 1.6 4.4 1.2-2H14" />
    </>
  ),
  relatorio_sv: (
    <>
      <rect x="5" y="2.75" width="10" height="14.5" rx="1.5" />
      <path d="M7.5 10.5l1.8 1.8 3.2-3.6" />
    </>
  ),
  croqui: (
    <>
      <path d="M4 16l.9-3.2 7.9-7.9a1.55 1.55 0 012.3 2.3l-7.9 7.9L4 16z" />
      <path d="M11.6 6.1l2.3 2.3" />
    </>
  ),
  material: (
    <path d="M3.5 6.5V5.5A1.5 1.5 0 015 4h3.2l1.6 2H15a1.5 1.5 0 011.5 1.5V14A1.5 1.5 0 0115 15.5H5A1.5 1.5 0 013.5 14V6.5z" />
  ),
  patrimonio: (
    <>
      <path d="M3.5 8L10 3.75 16.5 8" />
      <path d="M5.5 8.5v5M10 8.5v5M14.5 8.5v5" />
      <path d="M4 16.25h12" />
    </>
  ),
  familiares: (
    <>
      <circle cx="7.5" cy="6.75" r="2.25" />
      <path d="M3.5 15.5a4 4 0 018 0" />
      <circle cx="13.75" cy="8" r="1.75" />
      <path d="M12.9 12.9a3.3 3.3 0 013.6 2.6" />
    </>
  ),
  documentos: (
    <>
      <rect x="7" y="5.5" width="8.5" height="11.5" rx="1.5" />
      <path d="M4.5 14V4.5A1.5 1.5 0 016 3h6" />
    </>
  ),
};

function IconeItem({ chave }: { chave: ChaveItemPasta }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TRACOS_ITEM[chave]}
    </svg>
  );
}

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
 * Status visual do nó de cada momento na espinha da jornada:
 * - `concluido`: todos os acionáveis do momento estão prontos (e existe ao
 *   menos um acionável) — nó verde com check.
 * - `atual`: há trabalho acionável aqui agora — nó laranja da marca. Pode
 *   haver mais de um momento "atual" ao mesmo tempo (ex.: Patrimônio pode
 *   ser preenchido antes da sessão) — é sinal honesto, não posição única.
 * - `futuro`: tudo ainda é `ainda_nao` — nó fantasma.
 */
function statusDoMomento(itensDoMomento: ItemPasta[]): "concluido" | "atual" | "futuro" {
  const acionaveis = itensDoMomento.filter((i) => i.estado !== "ainda_nao");
  if (acionaveis.length === 0) return "futuro";
  if (acionaveis.every((i) => i.estado === "pronto")) return "concluido";
  return "atual";
}

const ESTILO_NO: Record<ReturnType<typeof statusDoMomento>, string> = {
  concluido: "border-transparent bg-[color:var(--verde)] text-[color:var(--papel)]",
  atual: "border-transparent bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]",
  futuro: "border-linha-forte bg-papel-elevado text-tinta-fraca",
};

function CartaoItem({ item, aoAbrirGaveta, sinaisSessao }: { item: ItemPasta; aoAbrirGaveta: (chave: ChaveItemPasta) => void; sinaisSessao?: SinaisSessaoPasta }) {
  const estilo = ESTILO_ESTADO[item.estado];
  const clicavel = item.estado !== "ainda_nao";
  const emGaveta = ITENS_EM_GAVETA.has(item.chave);
  const href = clicavel && !emGaveta ? caminhoItemPasta(item.chave) : undefined;
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
  //
  // Fase 5 (lei de texto §2): cartão `ainda_nao` não é acionável, então a nota
  // que explica POR QUE ainda não é hora sai do fluxo e vira `title`. Eram até
  // 3 linhas de prosa por cartão-fantasma, e são 9 desses numa jornada nova —
  // a maior fonte de texto da Ficha. O estado ("Ainda não é hora") continua
  // escrito, com glifo próprio: nada de informação se perde de relance.
  const descricao = item.estado === "ainda_nao" ? undefined : (item.nota ?? (item.estado === "pronto" ? undefined : acao));
  const explicacao = item.estado === "ainda_nao" ? item.nota ?? undefined : undefined;

  const conteudo = (
    <>
      <div className="flex items-start gap-3" title={explicacao ?? tituloDoCartao}>
        <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-controle ${estilo.selo}`}>
          <IconeItem chave={item.chave} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className={`text-[15px] font-bold leading-snug ${estilo.titulo}`} title={item.titulo}>
            {item.rotulo}
          </p>
          <p className={`inline-flex items-center gap-1.5 text-xs font-bold ${estilo.texto}`}>
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

  const classeBase = `flex min-h-[44px] flex-col gap-2 rounded-controle border p-3.5 text-left transition-all ${estilo.cartao}`;

  if (!clicavel) {
    // `ainda_nao`: não navega — mas continua no DOM como elemento estático,
    // não como link/botão morto (regra de teclado: nada focável que não faz
    // nada). A nota já explica o "porquê" (`derivar.ts` sempre popula `nota`
    // para os itens que ficam em `ainda_nao`).
    return <div className={`${classeBase} cursor-default`}>{conteudo}</div>;
  }

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

/** Cor de cada segmento da barra de progresso (decorativa — a frase ao lado carrega a mesma informação). */
const COR_SEGMENTO: Record<Exclude<EstadoItemPasta, "ainda_nao">, string> = {
  pronto: "bg-[color:var(--verde)]",
  em_revisao: "bg-[color:var(--ambar)]",
  falta: "bg-linha-forte",
};

export function PastaDoCliente({
  itens,
  aoAbrirGaveta,
  sinaisSessao,
}: {
  itens: ItemPasta[];
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
  /** Presença/sala/ligação IA para o cartão "Sessão" (Fase 4). Opcional: sem ele, o cartão fica como antes. */
  sinaisSessao?: SinaisSessaoPasta;
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

  const momentosVisiveis = MOMENTOS.map((momento) => ({
    ...momento,
    itens: itens.filter((i) => momento.chaves.includes(i.chave)),
  })).filter((momento) => momento.itens.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5 rounded-controle border border-linha-forte bg-papel-elevado px-4 py-3">
        {/* Número primeiro (§2): "3 de 7 prontos", não "Você já tem 3 de 7
            itens desta fase". */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-tinta">
            <span className="font-bold">{prontos}</span> de <span className="font-bold">{total}</span> prontos
          </p>
          {aindaNao > 0 && (
            <p className="text-xs text-tinta-fraca" title="Estes itens dependem da Sessão de Viabilidade acontecer.">
              {aindaNao} depois da sessão
            </p>
          )}
        </div>
        {/* Barra segmentada: um segmento por item acionável, na ordem da
            jornada — verde pronto, âmbar em revisão, trilho vazio falta.
            Decorativa (`aria-hidden`): a frase acima já diz o mesmo. */}
        {total > 0 && (
          <div aria-hidden="true" className="flex gap-1">
            {itensAcionaveis.map((item) => (
              <span
                key={item.chave}
                title={`${item.rotulo} — ${ROTULO_ESTADO[item.estado]}`}
                className={`h-1.5 min-w-2 flex-1 rounded-full ${COR_SEGMENTO[item.estado as Exclude<EstadoItemPasta, "ainda_nao">]}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* A espinha da jornada: 3 momentos como nós numa linha vertical. */}
      <ol className="flex flex-col">
        {momentosVisiveis.map((momento, indice) => {
          const ultimo = indice === momentosVisiveis.length - 1;
          const status = statusDoMomento(momento.itens);
          const acionaveisDoMomento = momento.itens.filter((i) => i.estado !== "ainda_nao");
          const prontosDoMomento = acionaveisDoMomento.filter((i) => i.estado === "pronto").length;
          return (
            <li
              key={momento.id}
              aria-labelledby={`momento-${momento.id}`}
              className={`relative pl-12 sm:pl-14 ${ultimo ? "" : "pb-8"}`}
            >
              {!ultimo && <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-11 w-px bg-linha-forte" />}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-full border text-sm font-bold ${ESTILO_NO[status]}`}
              >
                {status === "concluido" ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
                  </svg>
                ) : (
                  indice + 1
                )}
              </span>
              <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 id={`momento-${momento.id}`} className="text-lg font-bold leading-tight text-tinta">
                  {momento.titulo}
                </h2>
                <span className="text-xs font-medium text-tinta-fraca">
                  {acionaveisDoMomento.length === 0
                    ? "depois da sessão"
                    : `${prontosDoMomento} de ${acionaveisDoMomento.length} ${acionaveisDoMomento.length === 1 ? "pronto" : "prontos"}`}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {momento.itens.map((item) => (
                  <CartaoItem key={item.chave} item={item} aoAbrirGaveta={aoAbrirGaveta} sinaisSessao={sinaisSessao} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
