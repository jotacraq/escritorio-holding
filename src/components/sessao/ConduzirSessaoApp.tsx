"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarFicha360, type Agendamento, type Ficha360 } from "@/lib/api";
import { buscarRoteiroAtivo, buscarSims, listarOfertas, ErroSessao, type EstadoSims } from "@/components/sessao/api";
import { linkSalaValido, gravarLinkSala } from "@/components/ficha360/api-sessao";
import { useFocoAoAbrir } from "@/components/ficha360/useFocoAoAbrir";
import type { Oferta, RoteiroVersao } from "@/types/roteiro";
import type { PrecoCroqui } from "@/types/cenario";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Botao } from "@/components/ui/Botao";
import { Entrada } from "@/components/ui/Campo";
import { PainelCopiloto } from "@/components/sessao/PainelCopiloto";
import { usePollingCopiloto } from "@/components/sessao/copiloto/usePollingCopiloto";
import { resumoAusentesLinhaFina } from "@/components/sessao/copiloto/ApresentacaoComparacaoDecisores";
import { PainelBot } from "@/components/sessao/copiloto/PainelBot";
import { useTelaCheia } from "@/components/sessao/copiloto/useTelaCheia";
import { formatarData, formatarHora } from "@/lib/formatar";
import type { EstadoBotCopiloto } from "@/types/copiloto";
import type { PapelEquipe } from "@/types/banco";
import { BarraPartes } from "@/components/sessao/copiloto/BarraPartes";
import { useRealceUmaVez } from "@/components/sessao/copiloto/useRealceUmaVez";

type EstadoCarga =
  | { fase: "carregando" }
  | { fase: "erro"; erro: unknown }
  | { fase: "sem-sessao"; ficha: Ficha360 }
  | { fase: "sem-roteiro"; ficha: Ficha360 }
  | { fase: "pronto"; ficha: Ficha360; roteiro: RoteiroVersao; sims: EstadoSims; ofertas: Oferta[]; preco: PrecoCroqui | null };

/**
 * `presenca_confirmada_em/_via` (0051) chegam em `Ficha360.agendamentos`
 * (`select("*")`), mas `src/lib/api.ts` (travado nesta onda) ainda não tipa
 * os campos. Leitura estreita: `undefined` = a coluna não existe neste banco
 * (migration não aplicada) → não mostra nada, não inventa; `null` =
 * aguardando; string = confirmada.
 */
type AgendamentoComPresenca = Agendamento & { presenca_confirmada_em?: string | null; presenca_confirmada_via?: string | null };

function agendamentoRelevante(agendamentos: Agendamento[]): AgendamentoComPresenca | null {
  if (agendamentos.length === 0) return null;
  const ativos = agendamentos.filter((a) => a.status === "agendado" || a.status === "confirmado");
  const lista = (ativos.length > 0 ? ativos : agendamentos).slice().sort((a, b) => b.inicio_em.localeCompare(a.inicio_em));
  return lista[0] as AgendamentoComPresenca;
}

/**
 * Pedido 3 (17/09): "economizar espaço aí em cima" — o selo com chip+data
 * saiu; vira um PONTO discreto na mesma linha do nome, com o detalho inteiro
 * só no `title` (mesmo padrão que `Selo` já documenta: "o detalhe longo vive
 * aqui, nunca num `<p>` ao lado"). Cor é reforço, nunca o único sinal — por
 * isso o `title` carrega a frase por extenso para quem não distingue cor.
 */
function PontoPresenca({ agendamentos }: { agendamentos: Agendamento[] }) {
  const ag = agendamentoRelevante(agendamentos);
  if (!ag || ag.presenca_confirmada_em === undefined) return null;
  if (ag.presenca_confirmada_em) {
    const via = ag.presenca_confirmada_via === "equipe" ? " pela equipe" : ag.presenca_confirmada_via === "link" ? " pelo cliente" : "";
    const detalhe = `Presença confirmada${via} · ${formatarData(ag.presenca_confirmada_em)}`;
    return (
      <span title={detalhe} className="inline-flex items-center gap-1 text-legenda text-[color:var(--verde)]">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 10.5l3.6 3.5 7.4-8" />
        </svg>
        <span className="sr-only">{detalhe}</span>
      </span>
    );
  }
  return (
    <span title="Aguardando confirmação de presença" className="inline-flex items-center gap-1 text-legenda text-tinta-fraca">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3 shrink-0" fill="currentColor">
        <circle cx="10" cy="10" r="4" />
      </svg>
      <span className="sr-only">Aguardando confirmação de presença</span>
    </span>
  );
}

export function ConduzirSessaoApp({
  jornadaId,
  usuarioLogado = null,
}: {
  jornadaId: string;
  /** Fase 12, Fatia 7 — resolvido pelo SERVER COMPONENT (`page.tsx`,
   * `usuarioAtual()`), nunca buscado aqui: descer por prop até
   * `PainelTranscricao` evita a query dupla por montagem que rodava a cada
   * troca de aba Transcrição↔Inventário. Só os 2 campos que a folha precisa
   * (nome, papel) — nunca a linha inteira de `perfis_equipe`. `null` no
   * default cobre o fallback de testes unitários que montam este componente
   * sem passar a prop (ela nasce opcional de propósito). */
  usuarioLogado?: { nome: string | null; papel: PapelEquipe | null } | null;
}) {
  const [estado, setEstado] = useState<EstadoCarga>({ fase: "carregando" });
  const [indiceLocal, setIndice] = useState(0);
  const [tentativa, setTentativa] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { ativa: telaCheiaAtiva, alternar: alternarTelaCheia } = useTelaCheia();
  // Defeito 2 do Fable (16/09): "Fixado até" tem que sumir quando a fixação
  // expira de verdade. Some assim que o SERVIDOR (`resolvido.origem`) parar
  // de dizer `"fixado_manualmente"` — nunca por timer local, que mentiria
  // sobre o instante exato em que o servidor voltou a decidir sozinho.
  const [encerradaManualmente, setEncerradaManualmente] = useState(false);

  // Busca PURA: devolve o próximo estado, não o grava — o efeito abaixo só
  // faz setState em continuação (`.then/.catch`), o padrão de `useRecurso`.
  const carregar = useCallback(async (): Promise<{ estado: EstadoCarga; indice: number }> => {
    const ficha = await buscarFicha360(jornadaId);
    if (!ficha.sessao) return { estado: { fase: "sem-sessao", ficha }, indice: 0 };
    const sessaoId = ficha.sessao.id;

    let roteiro: RoteiroVersao;
    try {
      roteiro = await buscarRoteiroAtivo("sessao_viabilidade");
    } catch (e) {
      if (e instanceof ErroSessao && e.status === 404) return { estado: { fase: "sem-roteiro", ficha }, indice: 0 };
      throw e;
    }

    const [sims, ofertasResposta] = await Promise.all([buscarSims(sessaoId), listarOfertas(jornadaId)]);

    // Fase 12, Fatia B: o `sessionStorage` do índice manual SAIU (era o
    // "ponteiro manual encarnado" concorrendo com `bloco_atual_resolvido`,
    // que o SERVIDOR agora resolve — dois ponteiros brigando era o defeito-
    // raiz da Fase 12, Fatia 1). A tela sempre abre em 0; assim que o
    // polling da linha fina responder, `bloco_atual_resolvido` manda.
    return {
      estado: { fase: "pronto", ficha, roteiro, sims, ofertas: ofertasResposta.itens, preco: ofertasResposta.preco },
      indice: 0,
    };
  }, [jornadaId]);

  useEffect(() => {
    let vivo = true;
    carregar()
      .then((resultado) => {
        if (!vivo) return;
        setIndice(resultado.indice);
        setEstado(resultado.estado);
      })
      .catch((erro) => {
        if (vivo) setEstado({ fase: "erro", erro });
      });
    return () => {
      vivo = false;
    };
  }, [carregar, tentativa]);

  const tentarNovamente = useCallback(() => {
    setEstado({ fase: "carregando" });
    setTentativa((t) => t + 1);
  }, []);

  const total = estado.fase === "pronto" ? estado.roteiro.definicao.blocos.length : 0;
  const sessaoId = estado.fase === "pronto" ? estado.ficha.sessao!.id : null;

  // Defeito 3 do Fable (16/09): "um só poller". `usePollingCopiloto` sobe
  // para cá — `LinhaFinaRoteiro` e `PainelCopiloto` passam a LER o mesmo
  // estado por prop, em vez de cada um instanciar o hook (2 timers, 2
  // requisições a cada tick, custo de IA em dobro). `sessaoId ?? ""` é
  // seguro: o efeito interno do hook só dispara o 1º ciclo depois de
  // `POLLING_MS_EM_FOCO_INICIAL`, e a troca para o id real (quando a sessão
  // carrega) reinicia os cursores — mesmo contrato de antes.
  const polling = usePollingCopiloto(sessaoId ?? "", indiceLocal, !sessaoId || encerradaManualmente);
  const encerradaPorDuracaoMaxima = polling.ciclo?.resultado === "sessao_encerrada_por_duracao_maxima";
  const sessaoEncerrada = encerradaManualmente || encerradaPorDuracaoMaxima;
  const resolvido = polling.blocoAtualResolvido;

  // Defeito 1 do Fable: o SERVIDOR é a fonte, a tela reflete. O índice
  // exibido é DERIVADO — `bloco_atual_resolvido.indice` quando o servidor
  // já tem veredito (fixação manual confirmada ou inferência), e só então
  // cai no eco local. Sem isto, a linha "Agora: X" (servidor) e o
  // `<select>` "Corrigir: Y" (tela) discordavam na mesma linha.
  //
  // Derivar em vez de sincronizar por efeito é o que mata o `setState`
  // dentro de `useEffect` (react-hooks/set-state-in-effect): não existe
  // segundo render para alinhar os dois, nem janela em que a tela mostra
  // um valor que o servidor já contradisse. `indiceLocal` sobrevive só
  // como ECO OTIMISTA do clique, para o `<select>` não esperar o tick —
  // e é ele, não o derivado, que vai ao hook: o parâmetro só alimenta o
  // contexto do pedido sob demanda, e passar o derivado criaria laço
  // (resolvido → indice → hook → resolvido).
  //
  // Reincidência do Fable (16/09, "cliquei e voltou"): `resolvido` já existe
  // no meio da sessão (não é só o instante antes da 1ª resposta) — então
  // `resolvido?.indice ?? indiceLocal` sempre vencia para o servidor, e o
  // eco otimista nunca aparecia na prática; o `<select>` revertia por até 8s
  // (o tempo da IA em `virada_bloco`) a cada clique. Correção: enquanto
  // `polling.indiceFixacaoPendente` não é `null` (fixação enviada, servidor
  // ainda não confirmou NEM contradisse — ver o hook), ELE vence; depois que
  // o servidor se pronuncia (ou o teto do hook estoura), o hook mesmo zera a
  // pendência e a derivação volta a cair em `resolvido?.indice`.
  const indice = polling.indiceFixacaoPendente ?? resolvido?.indice ?? indiceLocal;

  // "Corrigir parte" (o ÚNICO caminho de correção desta tela desde que as
  // setas do teclado saíram — recurso fantasma: mudavam só a tela, nunca
  // fixavam no servidor). Fixa de verdade; o eco otimista agora vem de
  // `polling.indiceFixacaoPendente` (gravado pelo próprio hook dentro de
  // `fixarBlocoManualmente`), não mais de `setIndice` aqui — `indiceLocal`
  // segue existindo só como fallback para antes da 1ª resposta do servidor.
  const irPara = useCallback(
    (novoIndice: number) => {
      if (!Number.isInteger(novoIndice) || novoIndice < 0 || novoIndice >= total) return;
      setIndice(novoIndice);
      polling.fixarBlocoManualmente(novoIndice);
    },
    [total, polling.fixarBlocoManualmente],
  );

  const blocoAtual = useMemo(() => {
    if (estado.fase !== "pronto") return null;
    return estado.roteiro.definicao.blocos[indice] ?? null;
  }, [estado, indice]);

  // Pedido 1 (16/09): "o botão de inserir o link do meet esteja visível [...]
  // caso não tenha o link, informe para enviar". A gravação usa a MESMA rota
  // e validação da Ficha 360 (`gravarLinkSala`/`linkSalaValido`,
  // `@/components/ficha360/api-sessao`) — sem duplicar a regra de negócio.
  // O sucesso NÃO recarrega a tela: o `link_sala` devolvido pelo servidor
  // substitui só esse campo dentro da `ficha` já carregada — é escrita de
  // servidor refletida no estado que a tela já mantém, não um segundo estado
  // local competindo com ele.
  const aoAtualizarLinkSala = useCallback(
    async (linkNovo: string) => {
      const { sessao } = await gravarLinkSala(jornadaId, linkNovo);
      setEstado((atual) => (atual.fase === "pronto" ? { ...atual, ficha: { ...atual.ficha, sessao } } : atual));
    },
    [jornadaId],
  );

  if (estado.fase === "carregando") {
    return (
      <div className="flex flex-col gap-bloco" aria-busy="true">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Carregando a sessão…" />
        <EsqueletoFicha />
      </div>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="flex flex-col gap-bloco">
        <CabecalhoPagina rotulo="Conduzir sessão" titulo="Sessão de Viabilidade" />
        <EstadoErro erro={estado.erro} tentarNovamente={tentarNovamente} titulo="Não foi possível carregar a sessão" />
      </div>
    );
  }

  if (estado.fase === "sem-sessao" || estado.fase === "sem-roteiro") {
    const semRoteiro = estado.fase === "sem-roteiro";
    return (
      <div className="flex flex-col gap-bloco">
        <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} />
        <EstadoVazio
          ilustracao="agenda"
          titulo={semRoteiro ? "Nenhum roteiro ativo para Sessão de Viabilidade" : "Nenhuma Sessão de Viabilidade registrada para esta jornada"}
          descricao={
            semRoteiro
              ? // Correção de 15/09: o texto antigo dizia que o Admin não tinha
                // aba de roteiros e mandava a equipe técnica mexer direto no
                // banco — isso deixou de ser verdade na Fase 7 r3, quando
                // "Formulário e roteiros" (aba `formularios`) ganhou o botão
                // "Ativar esta" (`RoteirosSecao.tsx`, BLOQUEIO B15).
                "Não existe versão ativa do roteiro da Sessão de Viabilidade. A tela não improvisa o script — ative uma versão em Admin → Formulário e roteiros."
              : "Sem uma sessão criada não há o que conduzir aqui — nada é improvisado. Registre a sessão na ficha da jornada."
          }
          acao={
            <Link href={semRoteiro ? "/admin#formularios" : `/jornadas/${jornadaId}`}>
              <Botao variante="primario">{semRoteiro ? "Abrir Admin → Formulário e roteiros" : "Abrir ficha da jornada"}</Botao>
            </Link>
          }
        />
      </div>
    );
  }

  if (!blocoAtual || !sessaoId) return null;

  return (
    // F7 (18/09) — o ancestral que ancora a geometria da tela travada. Antes,
    // `PainelCopiloto.tsx` tentava adivinhar "o que sobra da viewport" com
    // `max-h-[calc(100vh-14.5rem)]` — uma subtração de constante nunca
    // re-medida com precisão E que não acompanha `--fator-escala` (só o
    // `font-size` da raiz reage à escala de texto; `vh` não). Agora é
    // `grid` com `h-full`: cabeçalho, linha fina e rodapé pedem `auto` (a
    // altura real do conteúdo deles); só a linha do mosaico
    // (`minmax(0,1fr)`, dentro de `PainelCopiloto`) recebe o que sobra —
    // sem número mágico, sem 2ª conta de altura para divergir da 1ª.
    //
    // F-2 (18/09/2026, rodada 2 do Fable): `h-[100dvh]` direto aqui
    // ignorava que, no modo NORMAL, este `<div>` é filho do `<main>` do
    // `AppShell` — que reserva espaço para o cabeçalho `sticky` do mobile e
    // para o padding próprio. `h-[100dvh]` competia por 100% da viewport
    // por cima do que o `AppShell` já tinha reservado, e a página rolava.
    // Agora o ancestral (`<main>`, via `globals.css`) é quem define a
    // altura real disponível nos dois modos — `padding:0` sempre nesta
    // rota, e `height:100dvh` só quando `.modo-tela-cheia-sessao` esconde
    // cabeçalho/lateral — e este `<div>` só herda com `h-full`, uma
    // conta só, no lugar certo, em vez de duas contas (uma aqui, outra no
    // `<main>`) podendo divergir.
    //
    // 🔴 `grid-row` EXPLÍCITO em cada filho (não a ordem de quem está
    // presente): `Cabecalho` é CONDICIONAL (some em tela cheia) — com
    // `grid-rows-[auto_auto_minmax(0,1fr)_auto]` posicionando só por ordem
    // de fonte, a ausência de `Cabecalho` empurraria `LinhaFinaRoteiro` para
    // a linha 1 e `PainelCopiloto` para a linha 2 (`auto`, nunca `1fr`) —
    // o mosaico perderia a única linha que cresce, e a tela voltaria a
    // rolar por página. Fixar a linha de cada um por número resolve nos
    // dois modos, sem depender de contagem de filhos.
    <div ref={containerRef} className={`grid h-full w-full grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-2 ${telaCheiaAtiva ? "modo-tela-cheia-sessao" : ""}`}>
      {/* Pedido 2 (16/09): "a tela fica cheia e a gente vai visualizando os
       * insights [...] esconder o cabeçalho da página e a navegação do
       * AppShell; os 3 blocos + a linha fina ocupam tudo". O `Cabecalho`
       * DESTA página (nome do cliente, "Ver ficha completa") some junto —
       * a lateral/topo do `AppShell` (fora desta árvore) são apagados por
       * CSS via `.modo-tela-cheia-sessao` (`globals.css`, mesmo padrão de
       * `:has()` de `.largura-cheia`). O botão de tela cheia continua
       * acessível dentro de `LinhaFinaRoteiro`, que nunca some. */}
      {!telaCheiaAtiva && (
        <div className="row-start-1">
          <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} roteiro={estado.roteiro} />
        </div>
      )}

      {/*
       * Fase 12, Fatia B — "a tela vira leitura" (pedido do Marcio, 16/09):
       * "a tela hoje está poluída com diversas informações que não são
       * úteis [...] os detalhes vemos depois, no resumo da sessão [...]
       * preciso que essa tela seja intuitiva". Tudo que era PLACAR/CONSULTA
       * ocasional saiu daqui — renasce na Ficha 360 (Fatia 2): a barra de 12
       * partes clicáveis, a `<nav>` fixa "Anterior/Próxima", os 4 SIMs
       * (decisão do dono, 16/09: consentimento de gravação NÃO é requisito
       * — sai sem substituto), a vigilância ao vivo, a anotação da parte, o
       * perfil de consulta, os atalhos de teclado, o briefing estratégico e
       * a oferta.
       *
       * No lugar de tudo isso: UMA linha fina no topo (`LinhaFinaRoteiro`,
       * abaixo) — "Agora: <título> · <ausentes>" + o `<select>` "Corrigir
       * parte". As setas de teclado SAÍRAM (achado do Fable, 16/09): mudavam
       * só a tela, nunca chamavam `fixarBlocoManualmente` — o servidor
       * ignorava, e a correção continuava presa no ponteiro antigo. O
       * `<select>` "Corrigir parte" é o único caminho de correção agora, e
       * ele fixa de verdade.
       */}
      <div className="row-start-2">
        <LinhaFinaRoteiro
          sessaoId={sessaoId}
          indiceAtual={indice}
          blocosRoteiro={estado.roteiro.definicao.blocos}
          irPara={irPara}
          polling={polling}
          linkSala={estado.ficha.sessao?.link_sala ?? null}
          aoAtualizarLinkSala={aoAtualizarLinkSala}
          telaCheiaAtiva={telaCheiaAtiva}
          aoAlternarTelaCheia={() => void alternarTelaCheia(containerRef.current)}
        />
      </div>

      {/* `row-start-3` + `min-h-0`: é o item de grid que RECEBE o `1fr` —
       * sem `min-h-0` aqui, o filho (`PainelCopiloto`, que já é `grid
       * min-h-0 flex-1` por dentro) não consegue encolher abaixo do
       * conteúdo, e o `minmax(0,1fr)` da linha 3 não tem efeito prático
       * (mesma armadilha de geometria já registrada nesta base). */}
      <div className="row-start-3 min-h-0">
        <PainelCopiloto
          sessaoId={sessaoId}
          indiceAtual={indice}
          blocosRoteiro={estado.roteiro.definicao.blocos}
          irPara={irPara}
          polling={polling}
          sessaoEncerrada={sessaoEncerrada}
          aoEncerrar={() => setEncerradaManualmente(true)}
          usuarioLogado={usuarioLogado}
        />
      </div>
    </div>
  );
}

/**
 * Fase 12, Fatia B/C — a linha fina que substitui a primeira dobra inteira.
 * Densa, uma linha, hierarquia por POSIÇÃO (nunca card/ícone/fonte grande —
 * regra da casa, achado de 15/09 "Marcio quer denso e chapado"):
 *
 *   Agora: Radiografia patrimonial · Falta Cleison na sala  [Convidar o bot] [⛶]   [Corrigir parte ▾]
 *
 * Fonte de cada pedaço:
 *  - `Agora: <título>` — `bloco_atual_resolvido`, do MESMO `polling` que
 *    `ConduzirSessaoApp` eleva e passa por prop (correção do achado do Fable
 *    de 16/09: "um só poller" — antes esta função instanciava uma 2ª cópia
 *    do hook, dobrando a requisição a cada tick).
 *  - `· Falta <nome> na sala` — `resumoAusentesLinhaFina` (já existente),
 *    some por completo quando não há ausente.
 *  - Ação do link/bot (Fatia C, pedido do Marcio 16/09: "o botão de inserir
 *    o link do meet esteja visível [...] para o bot solicitar entrada") —
 *    `AcaoSalaLinhaFina`, três estados: sem link → colar; com link sem bot
 *    pedido → `PainelBot` REVELADO (`compacto`, sem duplicar a lógica dele);
 *    bot já pedido → frase sóbria, sem convite a clicar de novo.
 *  - Erro de sala (`meeting_not_found` etc.) — o mesmo `PainelBot` fica fora
 *    da vista quando ainda não há link (não adianta convidar a pedir um bot
 *    sem sala); só o `aoMudarEstado` dele alimenta o aviso aqui, para o erro
 *    NUNCA ficar mudo mesmo com o `PainelBot` completo fora da tela.
 *  - Botão de tela cheia (Fatia C) — `useTelaCheia`, sempre visível, nunca
 *    escondido mesmo dentro do próprio modo (é o único jeito de sair sem
 *    depender de `Esc`).
 */
function LinhaFinaRoteiro({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
  polling,
  linkSala,
  aoAtualizarLinkSala,
  telaCheiaAtiva,
  aoAlternarTelaCheia,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro: { id: string; titulo: string }[];
  irPara: (indice: number) => void;
  polling: ReturnType<typeof usePollingCopiloto>;
  linkSala: string | null;
  aoAtualizarLinkSala: (linkNovo: string) => Promise<void>;
  telaCheiaAtiva: boolean;
  aoAlternarTelaCheia: () => void;
}) {
  const [codigoErroBotClique, setCodigoErroBotClique] = useState<string | undefined>(undefined);
  // 🔴 CORREÇÃO (Fable, achado 1): `codigoErroBotClique` só existe quando um
  // CLIQUE nesta montagem falhou de verdade (`PainelBot`, via
  // `aoMudarEstadoBot`) — cobre "sala_invalida" e qualquer outro código que
  // a rota devolva ao pedir o bot. `polling.bot.estado === "erro"` é OUTRO
  // FATO, sem relação de causa com "não entrou na sala": olhe
  // `bot/route.ts` (~285-330) e `estado.ts` — o servidor só grava
  // `estado: "erro"` depois que o bot JÁ ESTÁ NA SALA e a retentativa de
  // encerrá-lo falhou (retenção indefinida ou vínculo órfão). Deduzir
  // "sala_invalida" a partir disso seria dado inventado (CLAUDE.md) na
  // situação de maior risco: o bot pode estar gravando com retenção
  // indefinida enquanto a tela diz "não entrou". Os dois fatos nunca se
  // misturam: `codigoErroBotClique` para o erro de CLIQUE, `polling.bot`
  // lido direto (sem tradução) para a pendência de encerramento.
  const codigoErroBot = codigoErroBotClique;

  const resolvido = polling.blocoAtualResolvido;
  const ausentes = resumoAusentesLinhaFina(polling.comparacaoDecisores);
  // Defeito 2 do Fable: "Fixado até" só existe enquanto o SERVIDOR confirmar
  // `origem === "fixado_manualmente"` com uma `fixacao_expira_em` — nada de
  // estado local ecoando o clique para sempre. Passados os 300s, o próximo
  // tick troca `origem` para `"inferido"`/`"indisponivel"` e a frase some
  // sozinha, sem carimbar um horário do passado.
  const fixadoAte = resolvido?.origem === "fixado_manualmente" ? resolvido.fixacao_expira_em : null;

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-controle border border-linha bg-papel-elevado px-3 py-1.5 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {/* Fase 12, Fatia 4 — substitui o antigo "Agora: <título>" solto por
         * andamento das partes (posição, nunca "cobertura"; ver comentário
         * de topo de `BarraPartes.tsx`). */}
        <BarraPartes resolvido={resolvido} totalBlocos={blocosRoteiro.length} />
        <p className="text-tinta">
          {ausentes && <span className="text-tinta-suave">{ausentes}</span>}
          {fixadoAte && <span className="text-tinta-fraca">{ausentes ? " · " : ""}Fixado por você até {formatarHora(fixadoAte)}</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AvisoSalaInvalidaLinhaFina codigoErro={codigoErroBot} />

        <AcaoSalaLinhaFina linkSala={linkSala} aoAtualizarLinkSala={aoAtualizarLinkSala} sessaoId={sessaoId} polling={polling} aoMudarEstadoBot={setCodigoErroBotClique} />

        <BotaoTelaCheia ativa={telaCheiaAtiva} aoAlternar={aoAlternarTelaCheia} />

        <CorrigirParte indiceAtual={indiceAtual} blocosRoteiro={blocosRoteiro} aoEscolher={irPara} />
      </div>
    </div>
  );
}

/**
 * Fase 12, Fatia 5b — "Convidar o bot" vira ESTADO. Antes desta fatia, a
 * linha fina delegava cegamente ao eco otimista de `PainelBot` (o `resposta`
 * daquele componente é só "eu cliquei e o POST desta aba respondeu 200") —
 * reabrir a tela ou o próprio `PainelBot` desmontando perdia essa memória, e
 * não existia distinção entre "bot ainda entrando" e "bot já está na sala",
 * que é fato do SERVIDOR (`polling.bot`, `EstadoBotCopiloto`, já elevado ao
 * mesmo `usePollingCopiloto` único desta tela — zero rota/query nova).
 *
 * Mapa de estados (mesma posição da linha, nunca dois controles concorrendo):
 *
 *   `bot` nulo + link       → `[Convidar o bot]` — delega a `PainelBot`
 *                              REVELADO (compacto); é o único caminho que
 *                              ainda faz o POST de verdade.
 *   `bot.estado==="aguardando"` → "● Bot entrando…" (texto, sem CTA — já foi
 *                              pedido, novo clique duplicaria o pedido).
 *   `bot.estado==="ativo"`      → "● Bot na sala" (texto + ponto verde, token
 *                              que o projeto já usa para presença/OK).
 *   `bot.estado==="erro"`       → 🔴 CORREÇÃO (Fable, achado 1): este estado
 *                              só existe quando o bot JÁ ESTÁ NA SALA e o
 *                              servidor NÃO CONSEGUIU tirá-lo de lá
 *                              (`bot/route.ts` ~285-330, `estado.ts`
 *                              ~114-130) — nunca "não entrou na sala". Texto
 *                              âmbar de pendência, `role="alert"` (único
 *                              estado do bot que exige ação dela AGORA), SEM
 *                              CTA "Convidar o bot"/"Tentar de novo": a rota
 *                              recusa qualquer novo pedido nesta sessão com
 *                              409 `sessao_ja_encerrada` (~154) — um botão
 *                              aqui seria um CTA morto.
 *   `bot.estado==="encerrado"`  → "Bot encerrado" + `[Convidar o bot]` de novo
 *                              se ainda houver link (decisão do dono, aberta:
 *                              cobre o caso comum de reabrir a tela depois do
 *                              fim; um servidor que recuse pedido duplicado
 *                              devolveria `bot_ja_pedido`, que `PainelBot` já
 *                              trata como estado sóbrio).
 *
 * 🔴 NÃO desenha "desde HH:MM": `EstadoBotCopiloto` não carrega carimbo de
 * hora nenhum — inventar a partir do primeiro tick em que a tela viu
 * `aguardando`/`ativo` mentiria ao recarregar a página no meio da sessão
 * (decisão em aberto com o dono).
 *
 * O eco otimista do PRÓPRIO clique (`PainelBot`, `useState` local "eu acabei
 * de pedir") só aparece enquanto `polling.bot` ainda não tem opinião sobre
 * ESTE pedido (`null`, ou `encerrado` de um bot anterior) — assim que o
 * servidor confirma `aguardando`/`ativo`/`erro`, a linha passa a mostrar
 * SÓ a leitura do servidor, nunca as duas fontes ao mesmo tempo.
 */
function AcaoSalaLinhaFina({
  linkSala,
  aoAtualizarLinkSala,
  sessaoId,
  polling,
  aoMudarEstadoBot,
}: {
  linkSala: string | null;
  aoAtualizarLinkSala: (linkNovo: string) => Promise<void>;
  sessaoId: string;
  polling: ReturnType<typeof usePollingCopiloto>;
  aoMudarEstadoBot: (codigoErro: string | undefined) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O campo só ganha foco quando o formulário APARECE (clique em "Colar link
  // da sala"/"Trocar link") — nunca na montagem da tela. Mesmo padrão de
  // `SessaoSala.tsx` (Ficha 360).
  const refEndereco = useFocoAoAbrir<HTMLInputElement>(editando);

  if (!linkSala && !editando) {
    return (
      <>
        <span className="text-[color:var(--vermelho)]">Sem link da sala</span>
        <Botao
          type="button"
          variante="secundario"
          tamanho="compacto"
          onClick={() => {
            setTexto("");
            setErro(null);
            setEditando(true);
          }}
        >
          Colar link da sala
        </Botao>
      </>
    );
  }

  if (editando) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const url = linkSalaValido(texto);
          if (!url) {
            setErro("Cole o link completo, começando com https://.");
            return;
          }
          setSalvando(true);
          setErro(null);
          try {
            await aoAtualizarLinkSala(url);
            setEditando(false);
          } catch {
            setErro("Não foi possível salvar. Confira a internet e tente de novo.");
          } finally {
            setSalvando(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="link-sala-linha-fina">
          Endereço da sala (Zoom, Meet ou Teams)
        </label>
        <Entrada
          ref={refEndereco}
          id="link-sala-linha-fina"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="https://…"
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? "link-sala-linha-fina-erro" : undefined}
          className="!min-h-11 w-56 !py-1"
        />
        <Botao type="submit" variante="primario" tamanho="compacto" carregando={salvando}>
          Salvar
        </Botao>
        <Botao type="button" variante="fantasma" tamanho="compacto" onClick={() => setEditando(false)} disabled={salvando}>
          Cancelar
        </Botao>
        {erro && (
          <p id="link-sala-linha-fina-erro" role="alert" className="w-full text-[color:var(--vermelho)]">
            {erro}
          </p>
        )}
      </form>
    );
  }

  return (
    <>
      <a
        href={linkSala!}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-1 text-tinta-suave underline underline-offset-2 hover:text-[color:var(--acento,var(--latao))]"
      >
        <IconeLinkExterno />
        Abrir sala
      </a>
      <EstadoBotLinhaFina sessaoId={sessaoId} bot={polling.bot} aoMudarEstadoBot={aoMudarEstadoBot} />
      <Botao
        type="button"
        variante="fantasma"
        tamanho="compacto"
        icone={<IconeTrocarLink />}
        onClick={() => {
          setTexto(linkSala ?? "");
          setErro(null);
          setEditando(true);
        }}
      >
        Trocar link
      </Botao>
    </>
  );
}

/* Ícones como AFFORDANCE em botões/cabeçalhos — pedido do dono (17/09):
 * "ícones em botões e cabeçalhos são desejados". SVG inline 16px, mesmo
 * padrão de `IconeAcao`/`IconeAlerta` (`PainelCopiloto.tsx`) — sem
 * dependência nova (a armadilha do `lucide-react` quebrando build no
 * Windows não se aplica: zero import de barrel). */
const IconeLinkExterno = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 3H3v10h10V9.5M9 3h4v4M13 3 7 9" />
  </svg>
);
const IconeTrocarLink = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 6H4a2 2 0 0 0 0 4h1M9.5 10H12a2 2 0 0 0 0-4h-1M5.5 8h5" />
  </svg>
);

/** F7 (17/09) — ponto de status do bot pulsa UMA vez a cada mudança de
 * `bot.estado` (chave = o próprio estado) — "gatilho visual para auxiliar o
 * advogado" pedido pelo dono. `useRealceUmaVez` é o mesmo hook do resto da
 * tela (`copiloto/useRealceUmaVez.ts`); extraído em componente próprio
 * porque `EstadoBotLinhaFina` tem 4 retornos antecipados (`if`) e hooks não
 * podem morar depois de um `return` condicional. */
function PontoStatusBot({ estado, cor }: { estado: string; cor: string }) {
  // 320 casa com `@keyframes pulsar-uma-vez` (globals.css).
  const pulsar = useRealceUmaVez(true, estado, 320);
  return (
    <span
      aria-hidden="true"
      className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${pulsar ? "anim-pulsar-uma-vez" : ""}`}
      style={{ backgroundColor: cor }}
    />
  );
}

/**
 * Resolve o mapa de estados do bot (Fatia 5b) — a MESMA posição da linha,
 * nunca dois controles concorrendo. `bot` é sempre a leitura mais recente do
 * SERVIDOR (`polling.bot`, `EstadoPollingCopiloto.bot` já usa `??` para não
 * apagar um `ativo` visto por um tick isolado sem opinião — ver comentário
 * do campo em `usePollingCopiloto.ts`).
 *
 * `null`/`"encerrado"` são os dois ÚNICOS casos em que ainda faz sentido
 * oferecer o CTA de pedir o bot — delegado a `PainelBot` (compacto), que
 * segue sendo o único lugar que faz o POST de verdade e carrega o próprio
 * eco otimista do clique (`resposta`/`erro`/`pedindo`). Esse eco só fica
 * visível enquanto o SERVIDOR não tem opinião ainda sobre o pedido — assim
 * que o próximo tick do polling confirma `aguardando`/`ativo`, esta função
 * para de renderizar `PainelBot` e passa a mostrar só a leitura do servidor.
 * `"erro"` NUNCA delega a `PainelBot` (ver comentário no próprio `if`
 * abaixo) — a rota recusa qualquer novo pedido nesta sessão.
 */
function EstadoBotLinhaFina({
  sessaoId,
  bot,
  aoMudarEstadoBot,
}: {
  sessaoId: string;
  bot: EstadoBotCopiloto | null;
  aoMudarEstadoBot: (codigoErro: string | undefined) => void;
}) {
  if (!bot || bot.estado === "encerrado") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {bot?.estado === "encerrado" && (
          <span className="text-tinta-suave">
            <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-[color:var(--tinta-fraca)] align-middle" />
            Bot encerrado
          </span>
        )}
        <PainelBot sessaoId={sessaoId} aoMudarEstado={aoMudarEstadoBot} compacto />
      </div>
    );
  }

  if (bot.estado === "aguardando") {
    return (
      <p role="status" className="text-tinta-suave">
        <PontoStatusBot estado={bot.estado} cor="var(--ambar)" />
        Bot entrando…
      </p>
    );
  }

  if (bot.estado === "ativo") {
    return (
      <p role="status" className="text-tinta-suave">
        <PontoStatusBot estado={bot.estado} cor="var(--acento,var(--latao))" />
        Bot na sala
      </p>
    );
  }

  // 🔴 CORREÇÃO (Fable, achado 1): `estado === "erro"` NUNCA significa "não
  // entrou na sala" — significa o oposto: o bot ENTROU e o servidor NÃO
  // CONSEGUIU tirá-lo de lá (retenção indefinida ou vínculo órfão;
  // `bot/route.ts` ~285-330). Texto factual, na redação do próprio 409 do
  // servidor ("encerre a reunião agora ou remova manualmente o
  // participante"), `role="alert"` (é o único estado do bot que exige ação
  // dela AGORA). SEM `PainelBot`/CTA "Convidar o bot": a rota recusa
  // qualquer novo pedido nesta sessão com 409 `sessao_ja_encerrada` (~154)
  // — um botão aqui seria um CTA morto, clique sem efeito.
  return (
    <p role="alert" className="text-[color:var(--ambar)]">
      <PontoStatusBot estado={bot.estado} cor="var(--ambar)" />
      Bot com pendência de encerramento — remova o participante do bot da sala ou encerre a reunião agora.
    </p>
  );
}

const ICONE_TELA_CHEIA_ENTRAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" />
  </svg>
);
const ICONE_TELA_CHEIA_SAIR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
  </svg>
);

/**
 * Pedido 2 (16/09) — "tinha que ter um comando de tela cheia [...] segundo
 * monitor, a gente vai visualizando os insights, erros e acertos". Discreto,
 * na linha fina — nunca um botão grande de CTA. O ESTADO vem de
 * `useTelaCheia` (confirmado por `fullscreenchange`), então sair pela tecla
 * `Esc` também deixa o rótulo/ícone corretos, sem depender deste clique.
 */
function BotaoTelaCheia({ ativa, aoAlternar }: { ativa: boolean; aoAlternar: () => void }) {
  return (
    <Botao type="button" variante="fantasma" tamanho="compacto" onClick={aoAlternar} aria-pressed={ativa} title={ativa ? "Sair da tela cheia" : "Tela cheia"}>
      {ativa ? ICONE_TELA_CHEIA_SAIR : ICONE_TELA_CHEIA_ENTRAR}
      <span className="sr-only">{ativa ? "Sair da tela cheia" : "Entrar em tela cheia"}</span>
    </Botao>
  );
}

/**
 * Erro de sala (`sala_invalida`, ex. `meeting_not_found`) não pode ficar
 * mudo só porque `PainelBot` saiu da vista (comentário do plano) —
 * `role="alert"` sóbrio, sem duplicar a mensagem completa de `PainelBot`
 * (que seria vista de novo se a advogada abrir a Ficha 360).
 *
 * 🔴 CORREÇÃO (Fable, achado 1): só lê `codigoErroBotClique` (erro de um
 * CLIQUE nesta montagem) — nunca `polling.bot.estado`. O caso do bot
 * `estado==="erro"` vindo do servidor é outro fato (bot preso na sala, não
 * fora dela) e tem aviso próprio em `EstadoBotLinhaFina`, nunca este.
 */
function AvisoSalaInvalidaLinhaFina({ codigoErro }: { codigoErro: string | undefined }) {
  if (codigoErro !== "sala_invalida") return null;
  return (
    <p role="alert" className="text-[color:var(--vermelho)]">
      Não entrou na sala — confira o link da reunião.
    </p>
  );
}

/**
 * `[Corrigir parte ▾]` — `<select>` pequeno, NUNCA botão (o plano pede
 * explicitamente um controle de escolha, não uma ação disparada às cegas).
 * Alvo de toque `min-h-11` (44px) mesmo sendo visualmente pequeno — lição
 * registrada: "link de 11px embaixo de número de 30px não é alvo".
 */
function CorrigirParte({
  indiceAtual,
  blocosRoteiro,
  aoEscolher,
}: {
  indiceAtual: number;
  blocosRoteiro: { id: string; titulo: string }[];
  aoEscolher: (indice: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-tinta-suave">
      <span className="sr-only">Corrigir a parte atual do roteiro</span>
      {/*
       * Defeito 1(b) do Fable (16/09): "escolher a parte 0 numa tela recém-
       * aberta não disparava `onChange`" — o `<select>` já nascia com
       * `value={0}` (fallback antes do servidor responder), e o DOM só
       * dispara `change` quando o VALOR muda; escolher a opção já selecionada
       * é um no-op nativo do navegador, não um bug deste handler.
       *
       * `key={indiceAtual}` remonta o `<select>` do ZERO sempre que o índice
       * vem de fora (troca de bloco, resposta do servidor) — a instância nova
       * nunca "lembra" que o usuário já tinha essa opção marcada, então a
       * PRIMEIRA escolha dele, seja qual for (inclusive a 0), sempre parte de
       * um estado sem seleção prévia do ponto de vista do navegador e
       * dispara `onChange` normalmente.
       */}
      <select
        key={indiceAtual}
        defaultValue={indiceAtual}
        onChange={(evento) => aoEscolher(Number(evento.target.value))}
        className="min-h-11 max-w-[14rem] rounded-controle border border-linha-forte bg-papel px-2 text-sm text-tinta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--foco)]"
      >
        {blocosRoteiro.map((bloco, i) => (
          <option key={bloco.id} value={i}>
            Corrigir: {String(i).padStart(2, "0")} — {bloco.titulo}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Pedido do dono (17/09, captura de tela em produção): "economizar espaço aí
 * em cima [...] muito direta [...] o sistema não precisa ficar botando esses
 * comentários a mais". O cabeçalho antigo (`CabecalhoPagina` com rótulo + h1
 * + descrição + meta) gastava ~150px em 4 linhas antes de qualquer conteúdo
 * útil. Aqui é UMA linha: nome + roteiro à esquerda, "Ver ficha completa" à
 * direita — `<h1>` continua existindo (único da tela, regra de a11y), só que
 * dentro da mesma linha visual, sem rótulo acima nem descrição abaixo.
 *
 * O aviso de governança (BLOQUEIO B15, ARQUITETURA-FASE-2 §7: nenhuma das 4
 * versões do material foi carimbada como oficial pela Dra. Elaine) NÃO some —
 * é fato real, não enfeite. Não há hoje, na Ficha 360, um lugar que já exiba
 * a versão do roteiro (`grep` confirma: este era o único ponto da UI que a
 * mostrava) e este componente é o único de que sou dono nesta tarefa — mover
 * para dentro da Ficha exigiria tocar `ficha360/**`, fora do escopo. Optei
 * pelo mecanismo que `Selo.tsx` já documenta como padrão da casa ("o detalhe
 * longo vive aqui, nunca num `<p>` ao lado"): o `title` do próprio selo do
 * roteiro carrega a frase inteira — continua consultável (hover/foco), só
 * não ocupa mais uma linha permanente na tela ao vivo. Divergência do plano
 * registrada aqui; ver relatório de entrega para a proposta ao arquiteto.
 */
function Cabecalho({ ficha, jornadaId, roteiro }: { ficha: Ficha360; jornadaId: string; roteiro?: RoteiroVersao }) {
  const avisoGovernanca = "Nenhuma das 4 versões do material foi carimbada como oficial pela Dra. Elaine; esta é a mais extensa e está ativa por escolha do time técnico.";
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-subtitulo font-bold text-tinta">
        <span className="truncate">{ficha.pessoa.nome}</span>
        <PontoPresenca agendamentos={ficha.agendamentos} />
        {roteiro && (
          <>
            {/* F6 (17/09) — separador `·` vira `›` (mesmo vocabulário da
             * referência do dono), sem marca/logo à esquerda do nome
             * (decisão do plano). */}
            <span aria-hidden="true" className="text-tinta-fraca">
              ›
            </span>
            <span title={avisoGovernanca} className="text-sm font-medium text-tinta-suave">
              {roteiro.titulo} v{roteiro.versao}
            </span>
            <span className="sr-only">{avisoGovernanca}</span>
          </>
        )}
      </h1>
      <Link href={`/jornadas/${jornadaId}`} className="nao-imprimir shrink-0">
        <Botao variante="secundario" tamanho="compacto" icone={<IconeAbrirExterno />}>
          Ver ficha completa
        </Botao>
      </Link>
    </header>
  );
}

/* ⚠️ DIVERGÊNCIA DO PLANO (F6): o plano pedia ↗ à DIREITA do texto — `Botao`
 * só tem `icone` (sempre à ESQUERDA, prop única, usada por ~30 chamadores).
 * Criar uma 2ª prop (`iconeDepois`) só para este botão seria introduzir um
 * 2º padrão de ícone no componente global por causa de UM caso — optei por
 * manter o ícone à esquerda (mesma posição de "Abrir sala"/"Trocar link",
 * F2) em vez de duplicar a API do `Botao`. Reversível se o dono quiser a
 * posição exata da referência. */
const IconeAbrirExterno = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 3H3v10h10V9.5M9 3h4v4M13 3 7 9" />
  </svg>
);
