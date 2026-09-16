"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buscarFicha360, type Agendamento, type Ficha360 } from "@/lib/api";
import { buscarRoteiroAtivo, buscarSims, listarOfertas, ErroSessao, type EstadoSims } from "@/components/sessao/api";
import type { Oferta, RoteiroVersao } from "@/types/roteiro";
import type { PrecoCroqui } from "@/types/cenario";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { PainelCopiloto } from "@/components/sessao/PainelCopiloto";
import { usePollingCopiloto } from "@/components/sessao/copiloto/usePollingCopiloto";
import { resumoAusentesLinhaFina } from "@/components/sessao/copiloto/ApresentacaoComparacaoDecisores";
import { PainelBot } from "@/components/sessao/copiloto/PainelBot";
import { formatarData, formatarHora } from "@/lib/formatar";
import type { BlocoAtualResolvido } from "@/types/copiloto";

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

function SeloPresenca({ agendamentos }: { agendamentos: Agendamento[] }) {
  const ag = agendamentoRelevante(agendamentos);
  if (!ag || ag.presenca_confirmada_em === undefined) return null;
  if (ag.presenca_confirmada_em) {
    const via = ag.presenca_confirmada_via === "equipe" ? " pela equipe" : ag.presenca_confirmada_via === "link" ? " pelo cliente" : "";
    return (
      <Selo
        tom="verde"
        icone={
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 10.5l3.6 3.5 7.4-8" />
          </svg>
        }
      >
        Presença confirmada{via} · {formatarData(ag.presenca_confirmada_em)}
      </Selo>
    );
  }
  return <Selo tom="neutro">Aguardando confirmação de presença</Selo>;
}

export function ConduzirSessaoApp({ jornadaId }: { jornadaId: string }) {
  const [estado, setEstado] = useState<EstadoCarga>({ fase: "carregando" });
  const [indiceLocal, setIndice] = useState(0);
  const [tentativa, setTentativa] = useState(0);
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
    <div className="flex w-full flex-col gap-2 pb-4">
      <Cabecalho ficha={estado.ficha} jornadaId={jornadaId} roteiro={estado.roteiro} />

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
      <LinhaFinaRoteiro
        sessaoId={sessaoId}
        indiceAtual={indice}
        blocosRoteiro={estado.roteiro.definicao.blocos}
        irPara={irPara}
        polling={polling}
      />

      <PainelCopiloto
        sessaoId={sessaoId}
        indiceAtual={indice}
        blocosRoteiro={estado.roteiro.definicao.blocos}
        irPara={irPara}
        polling={polling}
        sessaoEncerrada={sessaoEncerrada}
        aoEncerrar={() => setEncerradaManualmente(true)}
      />
    </div>
  );
}

/**
 * Fase 12, Fatia B — a linha fina que substitui a primeira dobra inteira.
 * Densa, uma linha, hierarquia por POSIÇÃO (nunca card/ícone/fonte grande —
 * regra da casa, achado de 15/09 "Marcio quer denso e chapado"):
 *
 *   Agora: Radiografia patrimonial · Falta Cleison na sala   [Corrigir parte ▾]
 *
 * Fonte de cada pedaço:
 *  - `Agora: <título>` — `bloco_atual_resolvido`, do MESMO `polling` que
 *    `ConduzirSessaoApp` eleva e passa por prop (correção do achado do Fable
 *    de 16/09: "um só poller" — antes esta função instanciava uma 2ª cópia
 *    do hook, dobrando a requisição a cada tick).
 *  - `· Falta <nome> na sala` — `resumoAusentesLinhaFina` (já existente),
 *    some por completo quando não há ausente.
 *  - Erro de sala (`meeting_not_found` etc.) — `PainelBot` continua
 *    existindo (pedir o bot é OPERAÇÃO), mas fica fora da vista; só o
 *    `aoMudarEstado` dele alimenta o aviso aqui, para o erro NUNCA ficar
 *    mudo mesmo com o quadro fora da tela.
 */
function LinhaFinaRoteiro({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
  polling,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro: { id: string; titulo: string }[];
  irPara: (indice: number) => void;
  polling: ReturnType<typeof usePollingCopiloto>;
}) {
  const [codigoErroBot, setCodigoErroBot] = useState<string | undefined>(undefined);

  const resolvido = polling.blocoAtualResolvido;
  const rotuloAgora = rotuloBlocoAtual(resolvido);
  const ausentes = resumoAusentesLinhaFina(polling.comparacaoDecisores);
  // Defeito 2 do Fable: "Fixado até" só existe enquanto o SERVIDOR confirmar
  // `origem === "fixado_manualmente"` com uma `fixacao_expira_em` — nada de
  // estado local ecoando o clique para sempre. Passados os 300s, o próximo
  // tick troca `origem` para `"inferido"`/`"indisponivel"` e a frase some
  // sozinha, sem carimbar um horário do passado.
  const fixadoAte = resolvido?.origem === "fixado_manualmente" ? resolvido.fixacao_expira_em : null;

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-controle border border-linha bg-papel-elevado px-3 py-1.5 text-sm">
      <p className="text-tinta">
        <span className="font-bold">Agora:</span> {rotuloAgora}
        {ausentes && <span className="text-tinta-suave"> · {ausentes}</span>}
        {fixadoAte && <span className="text-tinta-fraca"> · Fixado por você até {formatarHora(fixadoAte)}</span>}
      </p>

      <AvisoSalaInvalidaLinhaFina codigoErro={codigoErroBot} />

      <CorrigirParte indiceAtual={indiceAtual} blocosRoteiro={blocosRoteiro} aoEscolher={irPara} />

      {/* `PainelBot` continua existindo para o `aoMudarEstado` alimentar o
       * aviso acima — fora da vista (pedir o bot é OPERAÇÃO, não CONDUÇÃO,
       * comentário de topo de `PainelBot.tsx`), nunca removido do DOM: um
       * `display:none` aqui bastaria para `offsetParent` provar ausência
       * visual sem deixar de rodar o efeito que pede o bot. */}
      <div className="hidden">
        <PainelBot sessaoId={sessaoId} aoMudarEstado={setCodigoErroBot} />
      </div>
    </div>
  );
}

/**
 * 🔴 Trava do plano: `origem === "indisponivel"` ou `bloco_id === null`
 * NUNCA vira "Parte 0" — índice inválido virando 0 seria dado inventado
 * (CLAUDE.md). Isolada nesta função para trocar em 1 linha se o dono um dia
 * preferir "manter a última parte conhecida" em vez de "ainda
 * identificando…".
 */
function rotuloBlocoAtual(resolvido: BlocoAtualResolvido | null): string {
  if (!resolvido || resolvido.origem === "indisponivel" || resolvido.bloco_id === null || !resolvido.titulo) {
    return "ainda identificando…";
  }
  return resolvido.titulo;
}

/**
 * Erro de sala (`sala_invalida`, ex. `meeting_not_found`) não pode ficar
 * mudo só porque `PainelBot` saiu da vista (comentário do plano) —
 * `role="alert"` sóbrio, sem duplicar a mensagem completa de `PainelBot`
 * (que seria vista de novo se a advogada abrir a Ficha 360).
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
 * O script existe em 4 versões no material da Dra. Elaine e nenhuma foi
 * carimbada como oficial (BLOQUEIO B15, ARQUITETURA-FASE-2 §7). A versão 4
 * está ativa por escolha técnica, não por decisão dela — a tela precisa
 * dizer isso, sóbrio, sem alarme.
 */
function Cabecalho({ ficha, jornadaId, roteiro }: { ficha: Ficha360; jornadaId: string; roteiro?: RoteiroVersao }) {
  return (
    <CabecalhoPagina
      rotulo="Conduzir sessão"
      titulo={ficha.pessoa.nome}
      descricao="Roteiro da Sessão de Viabilidade, uma parte por vez. Fala, ação, o que nunca dizer e o que observar."
      acoes={
        <Link href={`/jornadas/${jornadaId}`} className="nao-imprimir">
          <Botao variante="secundario">Ver ficha completa</Botao>
        </Link>
      }
      meta={
        <>
          <SeloPresenca agendamentos={ficha.agendamentos} />
          {roteiro && (
            <>
              <Selo tom="neutro">
                Roteiro: {roteiro.titulo} · versão {roteiro.versao}
              </Selo>
              <span className="nao-imprimir">Nenhuma das 4 versões do material foi carimbada como oficial pela Dra. Elaine; esta é a mais extensa e está ativa por escolha do time técnico.</span>
            </>
          )}
        </>
      }
    />
  );
}
