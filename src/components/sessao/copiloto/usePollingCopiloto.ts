"use client";

import { useEffect, useRef, useState } from "react";
import { ErroSessao, buscarPollingCopiloto } from "@/components/sessao/api";
import type { BlocoAtualResolvido, ComparacaoDecisoresPresentes, InfoCicloCopiloto, SugestaoCopilotoPolling } from "@/types/copiloto";

/** `codigo` que as 3 rotas do copiloto devolvem em HTTP 409 quando
 * `copiloto_sessao.ativo=false` — fail-closed por AUSÊNCIA (chave ausente,
 * falha de leitura ou valor de outro tipo caem sempre em `false`, mesmo
 * padrão de `lerConfigAgente` da Fase 9). Por isso este estado NÃO é borda
 * rara: aparece em qualquer ambiente onde a migration 0091/config não
 * rodou — inclusive em desenvolvimento — e é tratado como estado normal da
 * tela, nunca como exceção. Testar só por `codigo`, nunca por `status`
 * sozinho (409 é usado para outras coisas na casa) nem pela string da
 * mensagem (muda). */
export const CODIGO_COPILOTO_DESLIGADO = "copiloto_desligado";

export function ehCopilotoDesligado(erro: unknown): erro is ErroSessao {
  return erro instanceof ErroSessao && erro.codigo === CODIGO_COPILOTO_DESLIGADO;
}

/** Ponto de partida do PRIMEIRO tick, antes de qualquer resposta do
 * servidor existir (§4.1) — mesmo default que `copiloto_sessao.polling_ms`
 * grava na 0091. A partir da primeira resposta, `resposta.polling` manda:
 * mudar a chave no banco agora muda esta tela, sem deploy (era a divergência
 * registrada na entrega anterior — corrigida pelo contrato novo do backend,
 * `ConfigPollingCopiloto`). */
const POLLING_MS_EM_FOCO_INICIAL = 3000;
const POLLING_MS_SEM_FOCO_INICIAL = 10000;

/** Defeito "cliquei e voltou" (Fable, 16/09): teto para o eco otimista de
 * `indiceFixacaoPendente` sem confirmação do servidor — cobre erro de rede
 * ou sessão encerrada no meio do caminho, quando NENHUMA resposta chega para
 * limpar a pendência pelo caminho normal. Generoso o bastante para não
 * cortar uma fixação legítima ainda em voo (o ciclo típico é 3-10s de
 * polling + até 8s de IA em `virada_bloco`), curto o bastante para não
 * parecer travado numa reunião ao vivo. */
const LIMITE_ECO_PENDENTE_MS = 15000;

export interface EstadoPollingCopiloto {
  /** Todas as sugestões novas já vistas pelo polling desde que a tela abriu,
   * na ordem de chegada — é a lista que `SugestoesDoCiclo` renderiza. Nunca
   * é limpa por reabrir a lista: só cresce (ou é substituída ao trocar de
   * sessão), porque "sugestão que a advogada ainda não abriu" precisa
   * continuar visível até ela mesma dispensar. */
  sugestoes: SugestaoCopilotoPolling[];
  ciclo: InfoCicloCopiloto | null;
  encerrado: boolean;
  erro: unknown;
  /** Falhas seguidas desde o último sucesso — zera a cada resposta boa. É a
   * base do aviso persistente (iii do achado do Fable): só vira visível a
   * partir de `LIMIAR_FALHAS_PARA_AVISO`, nunca na 1ª nem na 2ª. */
  falhasConsecutivas: number;
  /** Quando a SEQUÊNCIA atual de falhas começou (a 1ª falha, não a mais
   * recente) — é o "desde HH:MM" do aviso; recalculado do zero a cada
   * sucesso, para não mostrar um horário de uma falha antiga já superada. */
  falhandoDesde: Date | null;
  /** `true` quando a última falha foi `copiloto_desligado` (409) — kill-switch
   * virado em Admin NO MEIO da sessão. Distinto de falha transiente: aqui o
   * polling PARA (nunca reagenda), a tela cai no `CopilotoDesligado` já
   * existente, e não faz sentido metralhar o servidor de 409 em loop até o
   * fim da sessão (achado ii do Fable). */
  desligadoPeloKillSwitch: boolean;
  /** Snapshot mais recente de `EstadoCopilotoComPolling.comparacao_decisores`
   * (Fatia 4/§5) — alimenta o quadro 2 "ALERTA" do mosaico (mock do Marcio,
   * 14/09). Diferente de `sugestoes`, este campo NÃO acumula: cada resposta
   * do servidor já é o fato mais atual (quem está na sala agora), então o
   * valor é sempre SUBSTITUÍDO, nunca concatenado. `null` do servidor
   * também substitui — se a sala esvaziar, o alerta deve sumir, não travar
   * no último snapshot com gente que já saiu. */
  comparacaoDecisores: ComparacaoDecisoresPresentes | null;
  /** Fase 12, Fatia 1/B — snapshot mais recente de
   * `EstadoCopilotoComPolling.bloco_atual_resolvido`. Mesma regra de
   * substituição de `comparacaoDecisores`: é sempre o fato mais atual
   * segundo o SERVIDOR, nunca acumulado. `null` só antes da 1ª resposta —
   * a linha fina do topo (`ConduzirSessaoApp.tsx`) trata isso como
   * "ainda identificando…", igual a `origem === "indisponivel"`. */
  blocoAtualResolvido: BlocoAtualResolvido | null;
  /** Defeito "cliquei e voltou" (Fable, 16/09): índice que `fixarBlocoManualmente`
   * pediu e que o SERVIDOR ainda não confirmou de volta em `blocoAtualResolvido`
   * (`origem === "fixado_manualmente"` com o MESMO índice). Enquanto isto não é
   * `null`, quem chama (`ConduzirSessaoApp`) deve exibir este valor em vez do
   * derivado do servidor — é o eco otimista sobrevivendo ao meio da sessão, não
   * só ao instante em que `resolvido` ainda não existe. Limpo em 3 casos: (1)
   * o servidor confirma o mesmo índice; (2) o servidor manda outra `origem`/
   * índice depois da janela de fixação (o eco não pode ficar preso mostrando
   * algo que o servidor já contradisse); (3) `LIMITE_ECO_PENDENTE_MS` estoura
   * sem confirmação (erro de rede, sessão encerrada) — nunca fica pendurado
   * para sempre. */
  indiceFixacaoPendente: number | null;
}

/** Pedido de FIXAÇÃO MANUAL para o próximo ciclo (Fase 12, Fatia B — o
 * `<select>` "Corrigir parte" da linha fina). Fica em `ref` pelo mesmo
 * motivo de `intervaloRef`: não deve recriar o efeito/timer, só mudar o que
 * o PRÓXIMO tick envia. Consumido uma vez (o ciclo zera depois de enviar) —
 * a fixação em si passa a viver no SERVIDOR (`bloco_atual_resolvido`), não
 * fica reenviada a cada tick como se fosse o estado corrente da tela. */
interface FixacaoPendente {
  indice: number;
  fixadoEm: string;
}

/**
 * Faz o `GET /api/sessoes/[id]/copiloto` de 3 em 3 segundos (10 em 10 sem
 * foco), com cursor incremental — nunca refaz a lista inteira (§2.2/§4.1).
 * Para de todo quando `sessaoEncerrada=true` (a sessão foi encerrada por
 * este painel ou já chegou encerrada de outro lugar) — polling que continua
 * depois do fim é bug de custo e de bateria, não recurso.
 *
 * Uma requisição de cada vez: se uma chamada demorar mais que o intervalo,
 * a próxima só é agendada depois que a anterior terminar (nunca empilha).
 * Timer sempre limpo no unmount e ao trocar de sessão/encerrar.
 */
export function usePollingCopiloto(sessaoId: string, indiceAtual: number, sessaoEncerrada: boolean) {
  const ESTADO_INICIAL: EstadoPollingCopiloto = {
    sugestoes: [],
    ciclo: null,
    encerrado: false,
    erro: null,
    falhasConsecutivas: 0,
    falhandoDesde: null,
    desligadoPeloKillSwitch: false,
    comparacaoDecisores: null,
    blocoAtualResolvido: null,
    indiceFixacaoPendente: null,
  };
  const [estado, setEstado] = useState<EstadoPollingCopiloto>(ESTADO_INICIAL);
  const cursorSegmentoRef = useRef(0);
  const cursorSugestaoRef = useRef(0);
  const indiceAtualRef = useRef(indiceAtual);
  indiceAtualRef.current = indiceAtual;
  // Fixação manual pendente ("Corrigir parte") — consumida no PRÓXIMO tick e
  // então limpa; ver `FixacaoPendente` acima.
  const fixacaoPendenteRef = useRef<FixacaoPendente | null>(null);
  // Timer do teto de `LIMITE_ECO_PENDENTE_MS` — cancelado sempre que a
  // pendência é limpa por outro caminho (confirmação ou contradição do
  // servidor), para nunca disparar depois de já ter sido resolvida.
  const timeoutEcoPendenteRef = useRef<number | null>(null);
  // O intervalo que o SERVIDOR mandou na última resposta (`resposta.polling`)
  // — começa no valor default antes da 1ª resposta existir, e é sobrescrito
  // a cada ciclo. Fica numa ref (não em `useState`) de propósito: mudar só
  // o número que o PRÓXIMO `setTimeout` vai usar não deve disparar
  // re-render nem recriar o efeito do zero — é o "reajusta no tick
  // seguinte, sem recriar o ciclo nem perder cursor" pedido no aceite.
  const intervaloRef = useRef({ emFocoMs: POLLING_MS_EM_FOCO_INICIAL, semFocoMs: POLLING_MS_SEM_FOCO_INICIAL });
  // Disparo imediato do próximo ciclo, sem esperar o timer normal — usado só
  // por `fixarBlocoManualmente` (a advogada não deveria esperar até 10s
  // parada para ver o efeito do clique em "Corrigir parte"). Contador
  // simples (não booleano): incrementar sempre dispara o efeito abaixo, mesmo
  // que o valor anterior já fosse "verdadeiro" logicamente.
  const [disparoImediato, setDisparoImediato] = useState(0);
  const cicloRef = useRef<(() => Promise<void>) | null>(null);
  // Timer do ciclo NORMAL (não o do disparo imediato) — precisa ser
  // cancelável de fora do `useEffect` de baixo para `fixarBlocoManualmente`
  // não deixar dois ciclos concorrentes agendados ao mesmo tempo.
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Sessão nova: cursores voltam ao início, histórico de sugestões limpa,
    // e o intervalo volta ao ponto de partida — a config da sessão anterior
    // não deve vazar para a próxima até a 1ª resposta desta chegar.
    cursorSegmentoRef.current = 0;
    cursorSugestaoRef.current = 0;
    intervaloRef.current = { emFocoMs: POLLING_MS_EM_FOCO_INICIAL, semFocoMs: POLLING_MS_SEM_FOCO_INICIAL };
    fixacaoPendenteRef.current = null;
    if (timeoutEcoPendenteRef.current !== null) window.clearTimeout(timeoutEcoPendenteRef.current);
    timeoutEcoPendenteRef.current = null;
    setEstado(ESTADO_INICIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoId]);

  useEffect(() => {
    if (sessaoEncerrada) return; // encerrado por fora (manual, 409 sessao_ja_encerrada, ou por duração máxima) — não inicia polling novo
    let vivo = true;
    // `number`, explícito: é sempre `window.setTimeout`/`window.clearTimeout`
    // (nunca o `setTimeout` global do Node, que devolveria `Timeout`).
    let timerId: number | null = null;

    async function ciclo() {
      let encerradoNestaResposta = false;
      let paraDeVezPorKillSwitch = false;
      // Consome a fixação pendente UMA vez: se houver, o índice enviado é o
      // dela (não `indiceAtualRef`) e `fixado_em` acompanha — sem os dois
      // juntos a rota nunca trata como fixação (ver `route.ts`). Limpa antes
      // do `await` para um segundo clique durante a requisição em voo não
      // duplicar o envio.
      const fixacao = fixacaoPendenteRef.current;
      fixacaoPendenteRef.current = null;
      try {
        const resposta = await buscarPollingCopiloto(sessaoId, {
          bloco: fixacao ? fixacao.indice : indiceAtualRef.current,
          desdeSegmento: cursorSegmentoRef.current,
          desdeSugestao: cursorSugestaoRef.current,
          fixadoEm: fixacao?.fixadoEm,
        });
        if (!vivo) return;
        cursorSegmentoRef.current = resposta.proximo_cursor_segmento;
        cursorSugestaoRef.current = resposta.proximo_cursor_sugestao;
        // Reajusta o intervalo para o PRÓXIMO tick — nunca o tick que acabou
        // de rodar. Fail-safe já é do servidor (contrato: sempre preenchido
        // e válido), mas um `> 0` aqui é defesa em profundidade contra um
        // valor absurdo travar o polling num loop apertado.
        if (resposta.polling && resposta.polling.em_foco_ms > 0 && resposta.polling.sem_foco_ms > 0) {
          intervaloRef.current = { emFocoMs: resposta.polling.em_foco_ms, semFocoMs: resposta.polling.sem_foco_ms };
        }
        // O SERVIDOR encerrou a sessão sozinha por ter passado da duração
        // máxima (§4.4) — mesmo efeito do encerramento manual: para daqui
        // pra frente, sem reagendar. Decidido AQUI, dentro do próprio ciclo
        // — não delegado a um re-render do componente pai passar
        // `sessaoEncerrada=true` de volta, o que teria um atraso de um
        // ciclo de render e deixaria pelo menos mais um tick escapar.
        encerradoNestaResposta = resposta.ciclo.resultado === "sessao_encerrada_por_duracao_maxima";
        const blocoResolvidoNovo = resposta.bloco_atual_resolvido ?? null;
        setEstado((atual) => {
          // Defeito "cliquei e voltou": a pendência só sobrevive enquanto o
          // servidor ainda não se pronunciou sobre ELA especificamente. Se
          // esta resposta trouxe um `blocoAtualResolvido` (mesmo que de outro
          // ciclo, não deste `fixacao`), compara com a pendência ATUAL do
          // estado — nunca com a variável local `fixacao` deste ciclo, porque
          // a resposta que confirma pode chegar num ciclo POSTERIOR ao que
          // enviou o pedido (o pedido é assíncrono; a confirmação, também).
          let indiceFixacaoPendente = atual.indiceFixacaoPendente;
          if (indiceFixacaoPendente !== null && blocoResolvidoNovo) {
            const confirmou = blocoResolvidoNovo.origem === "fixado_manualmente" && blocoResolvidoNovo.indice === indiceFixacaoPendente;
            // Qualquer resposta do servidor que já tenha "opinião" formada
            // (fixado ou inferido, para qualquer índice) resolve a pendência:
            // se confirmou o MESMO índice, o eco cede lugar ao servidor sem
            // piscar (mesmo valor); se veio outra coisa, o servidor já
            // contradisse o clique (janela de fixação expirou, ou a rota
            // recusou o pedido) e o eco não pode continuar preso.
            if (confirmou || blocoResolvidoNovo.origem !== "indisponivel") indiceFixacaoPendente = null;
          }
          if (indiceFixacaoPendente === null && timeoutEcoPendenteRef.current !== null) {
            window.clearTimeout(timeoutEcoPendenteRef.current);
            timeoutEcoPendenteRef.current = null;
          }
          return {
            // A maioria das respostas vem vazia (§4.1: "não faça o estado
            // piscar a cada resposta vazia") — só acrescenta se houver algo
            // novo; `ciclo` sempre é atualizado (é como a tela sabe que "um
            // ciclo rodou", mesmo em silêncio normal).
            sugestoes: resposta.sugestoes_novas.length > 0 ? [...atual.sugestoes, ...resposta.sugestoes_novas] : atual.sugestoes,
            ciclo: resposta.ciclo,
            encerrado: encerradoNestaResposta,
            erro: null,
            // Sucesso zera a sequência de falhas — é o "some sozinho quando o
            // polling volta" do achado do Fable (i): a próxima falha, se
            // houver, começa a contar do zero, com um novo "desde HH:MM".
            falhasConsecutivas: 0,
            falhandoDesde: null,
            desligadoPeloKillSwitch: false,
            // Substitui sempre (nunca acumula) — é o fato mais atual de quem
            // está na sala agora, não um histórico de quem já esteve.
            comparacaoDecisores: resposta.comparacao_decisores,
            // Idem: o SERVIDOR já resolveu a precedência (fixação recente x
            // inferência x indisponível) — a tela só reflete, nunca deriva.
            blocoAtualResolvido: blocoResolvidoNovo ?? atual.blocoAtualResolvido,
            indiceFixacaoPendente,
          };
        });
      } catch (e) {
        if (!vivo) return;
        // (ii) `copiloto_desligado`: alguém virou o kill-switch em Admin NO
        // MEIO da sessão. Isto é FIM DE POLLING, não uma falha entre outras
        // — sem o corte aqui, cada tick seguinte bateria 409 de novo, para
        // sempre, até a sessão acabar (achado do Fable: "loop infinito de
        // 409 a cada 3 segundos"). A tela cai no `CopilotoDesligado` já
        // existente da Fatia 1 — não inventa um segundo texto para o mesmo
        // estado.
        paraDeVezPorKillSwitch = ehCopilotoDesligado(e);
        setEstado((atual) => ({
          ...atual,
          erro: e,
          desligadoPeloKillSwitch: paraDeVezPorKillSwitch,
          // (iii) 1-2 falhas seguidas continuam mudas — só a CONTAGEM sobe;
          // é o componente quem decide, comparando com o limiar, se vira
          // aviso visível. `falhandoDesde` marca a 1ª falha da sequência
          // atual, não é sobrescrito a cada nova falha da mesma sequência.
          falhasConsecutivas: paraDeVezPorKillSwitch ? atual.falhasConsecutivas : atual.falhasConsecutivas + 1,
          falhandoDesde: paraDeVezPorKillSwitch ? atual.falhandoDesde : (atual.falhandoDesde ?? new Date()),
        }));
      } finally {
        if (vivo && !encerradoNestaResposta && !paraDeVezPorKillSwitch) {
          timerId = window.setTimeout(agendar, intervaloAtual());
          timerRef.current = timerId;
        }
      }
    }

    function intervaloAtual() {
      const { emFocoMs, semFocoMs } = intervaloRef.current;
      return document.visibilityState === "hidden" ? semFocoMs : emFocoMs;
    }

    function agendar() {
      void ciclo();
    }

    cicloRef.current = ciclo;
    timerId = window.setTimeout(agendar, intervaloAtual());
    timerRef.current = timerId;

    return () => {
      vivo = false;
      cicloRef.current = null;
      if (timerId !== null) window.clearTimeout(timerId);
      timerRef.current = null;
      // Sessão trocou/encerrou/desmontou com uma fixação em voo: o teto de
      // `LIMITE_ECO_PENDENTE_MS` não deve disparar depois, contra um estado
      // que já foi resetado (ou contra um componente já desmontado).
      if (timeoutEcoPendenteRef.current !== null) window.clearTimeout(timeoutEcoPendenteRef.current);
      timeoutEcoPendenteRef.current = null;
    };
    // `indiceAtual` de propósito fora das deps: o polling não deve reiniciar
    // o timer a cada troca de bloco (perderia o ritmo dos 3s); o valor mais
    // recente já chega pela ref a cada ciclo (lido dentro do closure acima).
  }, [sessaoId, sessaoEncerrada]);

  // Reexecuta o ciclo IMEDIATAMENTE quando `fixarBlocoManualmente` pede —
  // não espera o timer normal (até 10s parado seria "cliquei e não vi nada").
  // Cancela o timer do ciclo normal agendado antes de disparar, para nunca
  // haver duas chamadas em voo ao mesmo tempo; o `finally` do `ciclo()`
  // reagenda o próximo tick normalmente depois desta resposta.
  useEffect(() => {
    if (disparoImediato === 0) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    void cicloRef.current?.();
  }, [disparoImediato]);

  /** "Corrigir parte" (linha fina do topo, `ConduzirSessaoApp.tsx`): marca a
   * fixação para o PRÓXIMO ciclo e dispara esse ciclo na hora, sem esperar o
   * timer normal. `fixadoEm` é sempre "agora" — quem decide por quanto tempo
   * a fixação vence a inferência é o SERVIDOR (`janela_fixacao_manual_segundos`).
   *
   * Defeito "cliquei e voltou" (Fable, 16/09): grava `indice` também em
   * `indiceFixacaoPendente` do estado — é o eco otimista que
   * `ConduzirSessaoApp` passa a preferir a `blocoAtualResolvido` enquanto o
   * servidor não confirma (`resolvido?.indice ?? indiceLocal` engolia o eco
   * assim que `resolvido` já existisse, no meio da sessão). Arma também um
   * teto de `LIMITE_ECO_PENDENTE_MS`: se nenhuma resposta futura confirmar OU
   * contradizer (erro de rede repetido, sessão encerrada no meio do clique),
   * a pendência se limpa sozinha — nunca fica presa exibindo um valor que o
   * servidor nunca aceitou. */
  function fixarBlocoManualmente(indice: number) {
    fixacaoPendenteRef.current = { indice, fixadoEm: new Date().toISOString() };
    if (timeoutEcoPendenteRef.current !== null) window.clearTimeout(timeoutEcoPendenteRef.current);
    timeoutEcoPendenteRef.current = window.setTimeout(() => {
      timeoutEcoPendenteRef.current = null;
      setEstado((atual) => (atual.indiceFixacaoPendente === indice ? { ...atual, indiceFixacaoPendente: null } : atual));
    }, LIMITE_ECO_PENDENTE_MS);
    setEstado((atual) => ({ ...atual, indiceFixacaoPendente: indice }));
    setDisparoImediato((n) => n + 1);
  }

  return { ...estado, fixarBlocoManualmente };
}
