"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ErroSessao,
  buscarEstadoCopiloto,
  buscarPollingCopiloto,
  encerrarCopiloto,
  listarSegmentosCopiloto,
  pedirBotCopiloto,
  pedirSugestaoCopiloto,
  registrarDesfechoSugestaoCopiloto,
  registrarSegmentoManual,
} from "@/components/sessao/api";
import type {
  ComparacaoDecisoresPresentes,
  DesfechoCopiloto,
  DetalhesSalaInvalidaBot,
  InfoCicloCopiloto,
  RespostaSugestaoCopiloto,
  SegmentoCopiloto,
  SugestaoCopiloto,
  SugestaoCopilotoPolling,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";
import { useRecurso } from "@/hooks/useRecurso";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Campo, AreaTexto } from "@/components/ui/Campo";
import { formatarDataHora, formatarHora } from "@/lib/formatar";

/** `codigo` que as 3 rotas do copiloto devolvem em HTTP 409 quando
 * `copiloto_sessao.ativo=false` — fail-closed por AUSÊNCIA (chave ausente,
 * falha de leitura ou valor de outro tipo caem sempre em `false`, mesmo
 * padrão de `lerConfigAgente` da Fase 9). Por isso este estado NÃO é borda
 * rara: aparece em qualquer ambiente onde a migration 0091/config não
 * rodou — inclusive em desenvolvimento — e é tratado como estado normal da
 * tela, nunca como exceção. Testar só por `codigo`, nunca por `status`
 * sozinho (409 é usado para outras coisas na casa) nem pela string da
 * mensagem (muda). */
const CODIGO_COPILOTO_DESLIGADO = "copiloto_desligado";

function ehCopilotoDesligado(erro: unknown): erro is ErroSessao {
  return erro instanceof ErroSessao && erro.codigo === CODIGO_COPILOTO_DESLIGADO;
}

// ---------------------------------------------------------------------------
// Fatia 3 (docs/ARQUITETURA-FASE-10.md §4.1, §4.3, §6.1, §8, B71) — o ciclo
// automático deixa de esperar o botão e passa a rodar sozinho; a tela busca
// novidade por polling. `usePollingCopiloto` é o ÚNICO lugar que sabe de
// timer, cursor e foco da aba — o resto do componente só lê o resultado.
// ---------------------------------------------------------------------------

/** Ponto de partida do PRIMEIRO tick, antes de qualquer resposta do
 * servidor existir (§4.1) — mesmo default que `copiloto_sessao.polling_ms`
 * grava na 0091. A partir da primeira resposta, `resposta.polling` manda:
 * mudar a chave no banco agora muda esta tela, sem deploy (era a divergência
 * registrada na entrega anterior — corrigida pelo contrato novo do backend,
 * `ConfigPollingCopiloto`). */
const POLLING_MS_EM_FOCO_INICIAL = 3000;
const POLLING_MS_SEM_FOCO_INICIAL = 10000;

/** A partir de quantas falhas CONSECUTIVAS o polling vira aviso visível
 * (achado do Fable: falha silenciosa faz a tela parecer "sala calma" quando
 * na verdade o copiloto está surdo). 1-2 falhas seguidas continuam mudas —
 * B71 vale aqui: um soluço de rede não pode virar alarme no meio de uma
 * conversa sobre herança. 3 é o piso a partir do qual "transiente" deixa de
 * ser a explicação mais provável. */
const LIMIAR_FALHAS_PARA_AVISO = 3;

interface EstadoPollingCopiloto {
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
function usePollingCopiloto(sessaoId: string, indiceAtual: number, sessaoEncerrada: boolean) {
  const ESTADO_INICIAL: EstadoPollingCopiloto = {
    sugestoes: [],
    ciclo: null,
    encerrado: false,
    erro: null,
    falhasConsecutivas: 0,
    falhandoDesde: null,
    desligadoPeloKillSwitch: false,
  };
  const [estado, setEstado] = useState<EstadoPollingCopiloto>(ESTADO_INICIAL);
  const cursorSegmentoRef = useRef(0);
  const cursorSugestaoRef = useRef(0);
  const indiceAtualRef = useRef(indiceAtual);
  indiceAtualRef.current = indiceAtual;
  // O intervalo que o SERVIDOR mandou na última resposta (`resposta.polling`)
  // — começa no valor default antes da 1ª resposta existir, e é sobrescrito
  // a cada ciclo. Fica numa ref (não em `useState`) de propósito: mudar só
  // o número que o PRÓXIMO `setTimeout` vai usar não deve disparar
  // re-render nem recriar o efeito do zero — é o "reajusta no tick
  // seguinte, sem recriar o ciclo nem perder cursor" pedido no aceite.
  const intervaloRef = useRef({ emFocoMs: POLLING_MS_EM_FOCO_INICIAL, semFocoMs: POLLING_MS_SEM_FOCO_INICIAL });

  useEffect(() => {
    // Sessão nova: cursores voltam ao início, histórico de sugestões limpa,
    // e o intervalo volta ao ponto de partida — a config da sessão anterior
    // não deve vazar para a próxima até a 1ª resposta desta chegar.
    cursorSegmentoRef.current = 0;
    cursorSugestaoRef.current = 0;
    intervaloRef.current = { emFocoMs: POLLING_MS_EM_FOCO_INICIAL, semFocoMs: POLLING_MS_SEM_FOCO_INICIAL };
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
      try {
        const resposta = await buscarPollingCopiloto(sessaoId, {
          bloco: indiceAtualRef.current,
          desdeSegmento: cursorSegmentoRef.current,
          desdeSugestao: cursorSugestaoRef.current,
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
        setEstado((atual) => ({
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
        }));
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
        if (vivo && !encerradoNestaResposta && !paraDeVezPorKillSwitch) timerId = window.setTimeout(agendar, intervaloAtual());
      }
    }

    function intervaloAtual() {
      const { emFocoMs, semFocoMs } = intervaloRef.current;
      return document.visibilityState === "hidden" ? semFocoMs : emFocoMs;
    }

    function agendar() {
      void ciclo();
    }

    timerId = window.setTimeout(agendar, intervaloAtual());

    return () => {
      vivo = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
    // `indiceAtual` de propósito fora das deps: o polling não deve reiniciar
    // o timer a cada troca de bloco (perderia o ritmo dos 3s); o valor mais
    // recente já chega pela ref a cada ciclo (lido dentro do closure acima).
  }, [sessaoId, sessaoEncerrada]);

  return estado;
}

/**
 * Copiloto ao vivo — Fatia 1 + Fatia 2 (docs/ARQUITETURA-FASE-10.md §8). A
 * Fatia 1 é o estado determinístico puro, ZERO IA: o que falta no bloco,
 * SIMs pendentes, blocos não percorridos — vem pronto de
 * `GET /api/sessoes/[id]/copiloto`, é o servidor quem deriva, não esta tela
 * (para a Fatia 3, polling automático, reusar o mesmo payload sem trocar de
 * contrato — §2.4/C9).
 *
 * A Fatia 2 acrescenta o botão **"Me ajuda agora"**: a IA só roda sob
 * demanda, nunca sozinha (B71 — "nada pisca, nada toca, nada abre
 * sozinho"). Contrato em `@/types/copiloto` (`RespostaSugestaoCopiloto`,
 * `SugestaoCopiloto`). `visivel:false` é SUCESSO com confiança insuficiente
 * — a tela mostra um aviso sóbrio, nunca a sugestão. Cada código de recusa
 * (`copiloto_ia_nao_ativada`, `teto_ia_copiloto_atingido`,
 * `timeout_copiloto`, `copiloto_ao_vivo_bloqueado`, `recusa_ia`,
 * `saida_invalida`, `conteudo_proibido`) tem mensagem própria — nunca um
 * "tente novamente" genérico. Implementado em `SugestaoIA`/
 * `ApresentacaoSugestao` mais abaixo.
 *
 * **Desfecho (§5 do plano).** "Ir para lá" grava `desfecho='aceita'`,
 * "Ignorar" grava `desfecho='ignorada'` via
 * `POST .../sugestoes/[sugestaoId]/desfecho` — é o dado que, daqui a 20
 * sessões, dirá se o copiloto acerta. A gravação é TELEMETRIA, não a ação:
 * dispara em paralelo (`registrarDesfechoSemBloquear`), nunca bloqueia a
 * navegação/dispensa, nunca mostra erro — inclusive `desfecho_ja_registrado`
 * (409, duplo clique) é silencioso por design. Ciclo automático e polling
 * continuam fora daqui — isso é Fatia 3.
 *
 * C10: este painel só existe dentro da aba "Copiloto" da coluna direita —
 * quem monta as abas é `ConduzirSessaoApp.tsx`, com Briefing como default.
 * A aba **continua montada** mesmo com o copiloto desligado (decisão do
 * veredito do Fable): esconder a aba inteira deixaria a Dra. Elaine sem
 * saber se o recurso não existe ou está desligado por configuração.
 *
 * C12: o roteiro ativo (v4) nunca foi carimbado como oficial pela Dra. Elaine
 * (B15). O aviso do cabeçalho da sessão já diz isso — aqui ele é repetido,
 * sóbrio, porque quem só abre a aba Copiloto pode não ter visto o cabeçalho.
 *
 * **Kill-switch (`copiloto_sessao.ativo=false`).** É estado, não falha: cai
 * no `EstadoVazio` explicando o desligamento, nunca no `EstadoErro` com
 * "tentar de novo" — repetir a chamada não muda nada enquanto a chave
 * continuar `false`, e convidar a advogada a insistir numa ação que nunca
 * funciona é o oposto de guiar.
 */
export function PainelCopiloto({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  indiceAtual: number;
  /** `estado.roteiro.definicao.blocos` de `ConduzirSessaoApp.tsx`, na ordem —
   * é contra esta lista (não contra o payload do GET, que só traz os "não
   * percorridos") que o desvio sugerido resolve `bloco_id` em índice real
   * para navegar. Opcional: sem ela, a sugestão de desvio aparece só como
   * informação, sem o botão "Ir para lá". */
  blocosRoteiro?: { id: string }[];
  /** `ConduzirSessaoApp.tsx` — a mesma função que as setas do teclado chamam
   * (B70/§5 camada 3). Se ausente, o botão "Ir para" do desvio sugerido não
   * aparece — nunca navega sozinho e nunca falha silenciosamente. */
  irPara?: (indice: number) => void;
}) {
  const buscarEstado = useCallback(() => buscarEstadoCopiloto(sessaoId, indiceAtual), [sessaoId, indiceAtual]);
  const { dados: estado, carregando, erro, recarregar } = useRecurso(buscarEstado, [sessaoId, indiceAtual]);

  // Fatia 3: o ciclo passa a rodar sozinho e a tela busca novidade a cada
  // 3s — mas SÓ depois que a Fatia 1 já provou que o copiloto está ligado
  // (senão o polling ficaria martelando 409 em ambiente onde a migration/
  // config nem rodou). `sessaoEncerrada` para o timer de vez (§4.1: "para de
  // todo quando a sessão é encerrada") — inclui o encerramento MANUAL
  // (`EncerrarCopiloto`) e o AUTOMÁTICO por duração máxima
  // (`ciclo.resultado === "sessao_encerrada_por_duracao_maxima"`, calculado
  // logo abaixo): os dois param o timer da mesma forma, mas a MENSAGEM na
  // tela é diferente — a advogada precisa saber QUAL dos dois aconteceu.
  const [encerradaManualmente, setEncerradaManualmente] = useState(false);
  const podePollar = Boolean(estado) && !ehCopilotoDesligado(erro);
  const polling = usePollingCopiloto(sessaoId, indiceAtual, encerradaManualmente || !podePollar);
  const encerradaPorDuracaoMaxima = polling.ciclo?.resultado === "sessao_encerrada_por_duracao_maxima";
  const sessaoEncerrada = encerradaManualmente || encerradaPorDuracaoMaxima;

  if (carregando && !estado) return <EstadoCarregando rotulo="Carregando o copiloto…" />;

  if (erro) {
    if (ehCopilotoDesligado(erro)) return <CopilotoDesligado />;
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o copiloto" />;
  }

  if (!estado) return null;

  // (ii) do achado do Fable: o KILL-SWITCH foi virado em Admin NO MEIO da
  // sessão (o polling recebeu 409 `copiloto_desligado`, não a leitura
  // inicial). Cai no MESMO `CopilotoDesligado` da Fatia 1 — não existe um
  // segundo texto para o mesmo estado, e o polling já parou sozinho dentro
  // do hook (nunca reagenda depois de detectar isto).
  if (polling.desligadoPeloKillSwitch) return <CopilotoDesligado />;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-legenda text-tinta-fraca">
        Nenhuma das 4 versões do roteiro foi carimbada como oficial pela Dra. Elaine (ver aviso no topo da sessão) — o
        copiloto aponta com base na versão ativa hoje, não numa versão definitiva.
      </p>

      {!sessaoEncerrada && <AvisoPollingFalhando falhasConsecutivas={polling.falhasConsecutivas} falhandoDesde={polling.falhandoDesde} />}

      {encerradaPorDuracaoMaxima && (
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          O copiloto encerrou esta sessão automaticamente por ter passado do tempo máximo configurado — não é falha:
          a transcrição foi consolidada e nenhuma sugestão nova chega mais.
        </p>
      )}

      {encerradaManualmente && !encerradaPorDuracaoMaxima && (
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          O copiloto foi encerrado para esta sessão. A transcrição foi consolidada; nenhuma sugestão nova chega mais.
        </p>
      )}

      {!sessaoEncerrada && <GateBloqueado ciclo={polling.ciclo} />}

      {!sessaoEncerrada && (
        <SugestoesDoCiclo sessaoId={sessaoId} sugestoes={polling.sugestoes} blocosRoteiro={blocosRoteiro} irPara={irPara} />
      )}

      <SugestaoIA sessaoId={sessaoId} indiceAtual={indiceAtual} blocosRoteiro={blocosRoteiro} irPara={irPara} />

      {!sessaoEncerrada && <PainelBot sessaoId={sessaoId} />}

      {!estado.bloco_atual_id ? (
        <EstadoVazio compacto titulo="Sem roteiro ativo" descricao="Não há bloco atual para mostrar o que falta." />
      ) : (
        <FaltaNoBloco falta={estado.falta_no_bloco} />
      )}

      <SimsPendentes pendentes={estado.sims_pendentes} />
      <BlocosNaoPercorridos blocos={estado.blocos_nao_percorridos} />

      {/* Achado do Fable (Fatia 5): dois sinais DISTINTOS de "encerrado", os
       * dois precisam bloquear o registro manual — `sessaoEncerrada` é o
       * estado LOCAL desta aba (encerramento manual/por duração máxima
       * nesta mesma sessão de navegador); `estado.estado_copiloto` vem do
       * SERVIDOR e sobrevive a F5 (payload da Fatia 1, sempre presente).
       * Sem o segundo, recarregar a página depois de encerrar reabriria o
       * campo — texto digitado ali não entra mais em `transcricoes`
       * (re-encerrar é 409 `sessao_ja_encerrada`, não reconsolida) e o
       * expurgo da Fatia 5 o apaga aos 7 dias. Esta tela é CONVENIENCIA —
       * impede o erro; a trava de verdade é do backend (409 no POST, mais
       * o backstop do DELETE por `criado_em <= encerrado_em`). */}
      <RegistroManual sessaoId={sessaoId} sessaoEncerrada={sessaoEncerrada || estado.estado_copiloto === "encerrado"} />

      {!sessaoEncerrada && <EncerrarCopiloto sessaoId={sessaoId} aoEncerrar={() => setEncerradaManualmente(true)} />}
    </div>
  );
}

/** Rótulo humano de cada código de recusa (§ contrato). Cada código tem causa
 * distinta — nunca um "tente novamente" genérico: `timeout_copiloto` convida
 * a tentar de novo, `teto_ia_copiloto_atingido` diz explicitamente que não
 * adianta insistir hoje, `copiloto_ia_nao_ativada` aponta para Admin. */
const MENSAGENS_RECUSA: Record<string, { titulo: string; descricao: string; podeTentarDeNovo: boolean }> = {
  copiloto_ia_nao_ativada: {
    titulo: "Copiloto de IA ainda não ativado",
    descricao: "O prompt do copiloto está desligado por configuração. A equipe técnica liga isso em Admin — a sessão segue normalmente pelo roteiro.",
    podeTentarDeNovo: false,
  },
  teto_ia_copiloto_atingido: {
    titulo: "Limite de sugestões de hoje atingido",
    descricao: "Esta sessão (ou o dia) já usou o orçamento de chamadas de IA do copiloto. Não adianta tentar de novo agora — o roteiro determinístico continua disponível.",
    podeTentarDeNovo: false,
  },
  timeout_copiloto: {
    titulo: "A sugestão não chegou a tempo",
    descricao: "A IA não respondeu em 8 segundos. Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  copiloto_ao_vivo_bloqueado: {
    titulo: "Copiloto ao vivo bloqueado",
    descricao: "O copiloto de IA está bloqueado por configuração no servidor. Não é algo que se resolve tentando de novo — fale com a equipe técnica.",
    podeTentarDeNovo: false,
  },
  recusa_ia: {
    titulo: "A IA recusou responder desta vez",
    descricao: "Pode tentar de novo — às vezes é um caso isolado.",
    podeTentarDeNovo: true,
  },
  saida_invalida: {
    titulo: "A resposta da IA não pôde ser validada",
    descricao: "Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  conteudo_proibido: {
    titulo: "A sugestão foi descartada",
    descricao: "O conteúdo continha algo que o copiloto nunca deve mostrar (ex.: valor em reais). Nada foi exibido.",
    podeTentarDeNovo: false,
  },
};

function mensagemRecusa(erro: unknown): { titulo: string; descricao: string; podeTentarDeNovo: boolean } {
  if (erro instanceof ErroSessao && erro.codigo && MENSAGENS_RECUSA[erro.codigo]) {
    return MENSAGENS_RECUSA[erro.codigo];
  }
  return {
    titulo: "Não foi possível pedir a sugestão",
    descricao: erro instanceof ErroSessao ? erro.message : "Erro inesperado. Tente de novo em instantes.",
    podeTentarDeNovo: true,
  };
}

/**
 * (i)+(iii) do achado do Fable: falha PERSISTENTE do polling vira aviso
 * visível — nunca as duas primeiras (B71: um soluço de rede não é alarme no
 * meio de uma conversa sobre herança), sempre a partir da 3ª seguida (o
 * limiar em que "transiente" deixa de ser a explicação mais provável).
 *
 * A frase tem DOIS avisos, de propósito: "sem conexão" (o quê) e "a sessão
 * segue normalmente pelo roteiro" (o que NÃO aconteceu) — sem o segundo
 * período a advogada pode entender que perdeu a sessão inteira, quando só
 * perdeu o assistente. Mesmo princípio do B74 ("a tela mostra o estado
 * real"), aplicado ao canal que alimenta `GateBloqueado`/`SugestoesDoCiclo`:
 * elas ficariam mudas por falta de dado novo, não por silêncio da sala, e
 * sem este aviso a tela inteira mentiria por omissão.
 *
 * `role="status"` (não `alert`): é informação sobre a INFRAESTRUTURA, não
 * um bloqueio jurídico — `GateBloqueado` usa `alert` porque aquilo é uma
 * decisão que precisa de ação; isto aqui é "seguimos tentando", sem pedir
 * nada da advogada. Some sozinho no próximo sucesso (o hook zera a contagem).
 */
function AvisoPollingFalhando({ falhasConsecutivas, falhandoDesde }: { falhasConsecutivas: number; falhandoDesde: Date | null }) {
  if (falhasConsecutivas < LIMIAR_FALHAS_PARA_AVISO || !falhandoDesde) return null;
  return (
    <p role="status" className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3.5 py-2.5 text-sm text-tinta">
      <span className="mb-0.5 block font-bold text-[color:var(--ambar)]">Copiloto sem conexão desde {formatarHora(falhandoDesde.toISOString())}</span>
      A sessão segue normalmente pelo roteiro. Assim que a conexão voltar, o copiloto retoma sozinho.
    </p>
  );
}

/**
 * `ciclo.resultado === "bloqueado_pelo_gate"` (Fatia 3, §6.2.2/B71) — o gate
 * jurídico fechou NO MEIO da sessão (decisão jurídica ou consentimento
 * revogados). É DISTINTO de silêncio normal (`ciclo.resultado === null`,
 * que é o caso comum e não gera nenhum aviso): a advogada nunca pode
 * confundir "a sala está calma, nada para sugerir" com "o copiloto foi
 * calado por revogação". Aviso sóbrio, sempre visível enquanto durar —
 * não é um toast que some sozinho, porque a condição continua verdadeira a
 * cada novo polling até alguém religar a trava.
 */
function GateBloqueado({ ciclo }: { ciclo: InfoCicloCopiloto | null }) {
  if (!ciclo || ciclo.resultado !== "bloqueado_pelo_gate") return null;
  const motivo =
    ciclo.motivo_bloqueio === "sem_decisao_juridica"
      ? "O copiloto de IA está bloqueado por configuração no servidor."
      : ciclo.motivo_bloqueio === "sem_consentimento_titular"
        ? "O copiloto de IA está bloqueado por configuração no servidor para esta sessão."
        : "A trava jurídica do copiloto está fechada para esta sessão.";
  return (
    <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm text-tinta">
      <span className="mb-0.5 block font-bold text-[color:var(--vermelho)]">Copiloto de IA parado nesta sessão</span>
      {motivo} A transcrição por texto continua sendo registrada normalmente; nenhuma sugestão nova por IA vai aparecer
      enquanto isto não mudar.
    </p>
  );
}

/**
 * O AVISO DISCRETO da Fatia 3 (§8/B71): "nada pisca, nada toca, nada abre
 * sozinho". Cada sugestão que chega pelo polling (gatilho automático OU
 * "Me ajuda agora" registrado por outra aba) entra aqui FECHADA — só o
 * card-resumo aparece, sem animação, sem foco roubado, sem som. A Dra.
 * Elaine abre quando quiser, no seu tempo. Se ela está com uma sugestão
 * aberta e chega outra, a nova ESPERA fechada na lista — abrir uma nunca
 * fecha nem substitui outra.
 */
function SugestoesDoCiclo({
  sessaoId,
  sugestoes,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  sugestoes: SugestaoCopilotoPolling[];
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  // Cada sugestão nasce fechada e nasce "não dispensada" — os dois estados
  // moram aqui, por id, e nunca são resetados por uma sugestão nova chegar
  // (chegar sugestão B não fecha nem reabre a sugestão A).
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [dispensadas, setDispensadas] = useState<Record<string, boolean>>({});

  const pendentes = sugestoes.filter((s) => !dispensadas[s.sugestao_id]);
  if (pendentes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="text-legenda font-medium uppercase text-tinta-fraca">
        {pendentes.length === 1 ? "1 sugestão nova" : `${pendentes.length} sugestões novas`}
      </p>
      <ul className="flex flex-col gap-2">
        {pendentes.map((s) => (
          <li key={s.sugestao_id}>
            {abertas[s.sugestao_id] ? (
              <Cartao rotulo={ROTULO_GATILHO[s.gatilho]} titulo="Sugestão do copiloto" preenchimento="compacto">
                {!s.visivel || !s.sugestao ? (
                  <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
                    A IA analisou este momento, mas a confiança ficou abaixo do mínimo configurado — nada é mostrado
                    para não guiar com um palpite fraco.
                  </p>
                ) : (
                  <ApresentacaoSugestao
                    sessaoId={sessaoId}
                    sugestaoId={s.sugestao_id}
                    sugestao={s.sugestao}
                    blocosRoteiro={blocosRoteiro}
                    irPara={irPara}
                  />
                )}
                <div className="mt-2 flex justify-end">
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    onClick={() => setDispensadas((atual) => ({ ...atual, [s.sugestao_id]: true }))}
                  >
                    Dispensar
                  </Botao>
                </div>
              </Cartao>
            ) : (
              // O card fechado é o "aviso discreto": um botão sóbrio, sem
              // cor de alarme, sem badge pulsante — a Dra. Elaine decide
              // quando (e se) quer abrir.
              <Botao
                type="button"
                variante="secundario"
                tamanho="compacto"
                largo
                className="justify-between"
                onClick={() => setAbertas((atual) => ({ ...atual, [s.sugestao_id]: true }))}
              >
                <span>{ROTULO_GATILHO[s.gatilho]}</span>
                <span className="text-tinta-fraca">Ver sugestão</span>
              </Botao>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROTULO_GATILHO: Record<SugestaoCopilotoPolling["gatilho"], string> = {
  intervalo: "Sugestão automática",
  virada_bloco: "Sugestão ao mudar de parte",
  sob_demanda: "Sugestão pedida",
};

/**
 * Encerrar a sessão do copiloto (Fatia 3, §6.1, B71 "camada 1 de
 * confirmação"): é irreversível no sentido do plano — consolida a
 * transcrição em `transcricoes` e para o copiloto para sempre nesta sessão.
 * `ConfirmarAcao` deixa o efeito explícito por extenso, nunca "tem certeza?".
 * `sessao_ja_encerrada` (409, clique duplo) é tratado como sucesso silencioso
 * — a sessão já está no estado que o clique pedia.
 */
function EncerrarCopiloto({ sessaoId, aoEncerrar }: { sessaoId: string; aoEncerrar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);

  async function confirmar() {
    setProcessando(true);
    setErro(null);
    try {
      await encerrarCopiloto(sessaoId);
      aoEncerrar();
    } catch (e) {
      if (e instanceof ErroSessao && e.codigo === "sessao_ja_encerrada") {
        aoEncerrar();
      } else {
        setErro(e);
      }
    } finally {
      setProcessando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-linha pt-3">
      <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmando(true)} className="self-start">
        Encerrar copiloto desta sessão
      </Botao>
      {Boolean(erro) && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro instanceof ErroSessao ? erro.message : "Não foi possível encerrar o copiloto. Tente de novo."}
        </p>
      )}
      <ConfirmarAcao
        aberto={confirmando}
        titulo="Encerrar o copiloto desta sessão?"
        efeito="A transcrição registrada até agora é consolidada em um documento único desta sessão, e o copiloto para de buscar novidade e de sugerir — não é possível reativá-lo nesta mesma sessão depois."
        rotuloConfirmar="Encerrar"
        confirmando={processando}
        perigo
        aoConfirmar={() => void confirmar()}
        aoCancelar={() => setConfirmando(false)}
      />
    </div>
  );
}

/**
 * O botão "Me ajuda agora" e a apresentação da sugestão (Fase 10, Fatia 2).
 * B71: nada pisca, nada toca, nada abre sozinho — a sugestão só existe na
 * tela depois do clique explícito da Dra. Elaine, e fica onde apareceu até
 * ela pedir outra ou trocar de bloco/sessão (não há timer nem auto-refresh).
 */
function SugestaoIA({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [resposta, setResposta] = useState<RespostaSugestaoCopiloto | null>(null);
  const [erro, setErro] = useState<unknown>(null);

  async function pedir() {
    if (pedindo) return; // o botão não pode ser clicado duas vezes enquanto a IA responde
    setPedindo(true);
    setErro(null);
    try {
      const r = await pedirSugestaoCopiloto(sessaoId, indiceAtual);
      setResposta(r);
    } catch (e) {
      setResposta(null);
      setErro(e);
    } finally {
      setPedindo(false);
    }
  }

  return (
    <Cartao rotulo="Sugestão sob demanda" titulo="Me ajuda agora" preenchimento="compacto">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-tinta-suave">
          A IA só roda quando você pede. Ela lê o bloco atual, o briefing e o que foi dito — nunca aparece sozinha.
        </p>

        <Botao
          type="button"
          variante="primario"
          tamanho="compacto"
          carregando={pedindo}
          onClick={() => void pedir()}
          className="self-start"
          aria-describedby="copiloto-ia-nota"
        >
          Me ajuda agora
        </Botao>
        <span id="copiloto-ia-nota" className="sr-only">
          Pede à IA uma sugestão para o momento atual da sessão. Pode levar até 8 segundos.
        </span>

        {pedindo && (
          <p role="status" aria-live="polite" className="text-sm text-tinta-suave">
            Pensando… (até 8 segundos)
          </p>
        )}

        {!pedindo && erro !== null && (
          <MensagemRecusa erro={erro} aoTentarDeNovo={() => void pedir()} />
        )}

        {!pedindo && !erro && resposta && !resposta.visivel && (
          <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
            Sem sugestão confiável agora. A IA analisou, mas a confiança ficou abaixo do mínimo configurado — nada é
            mostrado para não guiar com um palpite fraco.
          </p>
        )}

        {!pedindo && !erro && resposta && resposta.visivel && resposta.sugestao && (
          <ApresentacaoSugestao
            sessaoId={sessaoId}
            sugestaoId={resposta.sugestao_id}
            sugestao={resposta.sugestao}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
          />
        )}
      </div>
    </Cartao>
  );
}

function MensagemRecusa({ erro, aoTentarDeNovo }: { erro: unknown; aoTentarDeNovo: () => void }) {
  const { titulo, descricao, podeTentarDeNovo } = mensagemRecusa(erro);
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm">
      <p className="font-bold text-[color:var(--vermelho)]">{titulo}</p>
      <p className="text-tinta">{descricao}</p>
      {podeTentarDeNovo && (
        <Botao variante="perigo" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

const ROTULO_TIPO: Record<TipoObservacaoCopiloto, string> = {
  fato: "Fato",
  hipotese: "Hipótese",
  inferencia: "Inferência",
  recomendacao: "Recomendação",
};

const TOM_TIPO: Record<TipoObservacaoCopiloto, "verde" | "azul" | "ambar" | "latao"> = {
  fato: "verde",
  hipotese: "azul",
  inferencia: "ambar",
  recomendacao: "latao",
};

/** Confiança sempre visível junto do que ela qualifica — nunca só o texto,
 * nunca só um número solto (regra da casa: tipo + confiança, sempre). */
function SeloConfianca({ confianca }: { confianca: number }) {
  return <Selo tom="neutro">confiança {Math.round(confianca * 100)}%</Selo>;
}

/** `evidencia` é citação literal do que o cliente disse — apresentada como
 * citação, visivelmente distinta da conclusão da IA. `rotulo` (opcional)
 * nomeia a citação quando ela aparece perto de outras coisas que também têm
 * aspas — pedido do Marcio (11/09): "pergunta", "motivo" e "evidência" são
 * três NATUREZAS diferentes, não três parágrafos parecidos; o rótulo é o que
 * deixa isso óbvio batendo o olho, sem precisar ler a frase inteira. */
function Evidencia({ texto, rotulo }: { texto: string; rotulo?: string }) {
  return (
    <blockquote className="border-l-2 border-linha-forte pl-2.5 text-sm italic text-tinta-suave">
      {rotulo && <span className="mb-0.5 block not-italic text-legenda font-medium uppercase tracking-wide text-tinta-fraca">{rotulo}</span>}
      &ldquo;{texto}&rdquo;
    </blockquote>
  );
}

/**
 * Todo campo de `SugestaoCopiloto` pode vir nulo — nulo é nulo, some, nunca
 * vira texto plausível. Cada bloco abaixo só renderiza se o dado existir.
 *
 * Hierarquia (pedido do Marcio, 11/09 — "muito sorrateira... precisa ser mais
 * objetivo"): a `proxima_pergunta.texto` é o ÚNICO elemento que a advogada
 * precisa achar em meio segundo, no meio da fala do cliente — é o herói,
 * card próprio com `realce="latao"` (cor de marca, não de alarme) e o
 * MESMO degrau tipográfico (`text-titulo`/`sm:text-display`) que
 * `BlocoRoteiro.tsx` usa para o título do bloco atual: o padrão já existe
 * na tela de sessão para "a coisa que se lê de relance". `motivo` e
 * `evidencia` moram dentro do MESMO card, mas menores e com rótulo próprio
 * — nunca like um 2º e 3º parágrafo do mesmo tamanho (era exatamente o
 * "ficou tudo junto" que o Marcio apontou). Todo o resto (falta no bloco,
 * desvio, observação) é apoio, abaixo, cada um com seu próprio peso — a
 * observação por último e mais discreta, porque é risco a considerar, não
 * ação a tomar.
 */
function ApresentacaoSugestao({
  sessaoId,
  sugestaoId,
  sugestao,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  /** `resposta.sugestao_id` — nível de `RespostaSugestaoCopiloto`, não de
   * `SugestaoCopiloto`. É o vínculo para `POST .../[sugestaoId]/desfecho`. */
  sugestaoId: string;
  sugestao: SugestaoCopiloto;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const nada =
    !sugestao.proxima_pergunta &&
    sugestao.falta_no_bloco.length === 0 &&
    !sugestao.observacao &&
    !sugestao.desvio_sugerido;

  if (nada) {
    return (
      <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
        A IA respondeu, mas não teve nada específico a apontar agora.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sugestao.proxima_pergunta && (
        <div className="rounded-cartao border border-linha border-l-4 border-l-[color:var(--latao-cta)] bg-papel px-3.5 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-[color:var(--latao)]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 fill-current">
              <path d="M10 1.5a5.5 5.5 0 0 0-3.2 9.98c.46.33.7.85.7 1.4v.62a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-.62c0-.55.24-1.07.7-1.4A5.5 5.5 0 0 0 10 1.5Zm-1.5 16a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-.5h-3v.5Z" />
            </svg>
            Pergunte agora
          </p>
          <p className="text-titulo font-bold leading-snug text-tinta sm:text-display">{sugestao.proxima_pergunta.texto}</p>
          {sugestao.proxima_pergunta.motivo && (
            <p className="mt-2 text-sm text-tinta-suave">
              <span className="font-medium text-tinta-fraca">Por quê: </span>
              {sugestao.proxima_pergunta.motivo}
            </p>
          )}
          {sugestao.proxima_pergunta.evidencia && (
            <div className="mt-2">
              <Evidencia texto={sugestao.proxima_pergunta.evidencia} rotulo="O cliente disse" />
            </div>
          )}
        </div>
      )}

      {sugestao.falta_no_bloco.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">A IA notou que falta</p>
          {/* Chips (pedido do Marcio, 11/09): o prompt v2 já entrega o item
              curto (3-6 palavras) — cabe em etiqueta, lê mais rápido que
              lista vertical e não compete em altura com a pergunta acima.
              A evidência de cada item, quando existe, continua como citação
              logo abaixo do grupo de chips (não dentro do chip — citação não
              cabe em pílula sem quebrar o formato). */}
          <ul className="flex flex-wrap gap-1.5">
            {sugestao.falta_no_bloco.map((item, i) => (
              <li key={i}>
                <Selo tom="neutro">{item.item}</Selo>
              </li>
            ))}
          </ul>
          {sugestao.falta_no_bloco
            .filter((item) => item.evidencia)
            .map((item, i) => (
              <Evidencia key={i} texto={item.evidencia as string} />
            ))}
        </div>
      )}

      {sugestao.desvio_sugerido && (
        <DesvioSugerido
          sessaoId={sessaoId}
          sugestaoId={sugestaoId}
          desvio={sugestao.desvio_sugerido}
          blocosRoteiro={blocosRoteiro}
          irPara={irPara}
        />
      )}

      {sugestao.observacao && (
        <div className="flex flex-col gap-1 border-t border-dashed border-linha pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Selo tom={TOM_TIPO[sugestao.observacao.tipo]}>{ROTULO_TIPO[sugestao.observacao.tipo]}</Selo>
            <SeloConfianca confianca={sugestao.observacao.confianca} />
          </div>
          <p className="text-sm text-tinta-suave">{sugestao.observacao.texto}</p>
          {sugestao.observacao.evidencia && <Evidencia texto={sugestao.observacao.evidencia} />}
        </div>
      )}
    </div>
  );
}

/** Dispara o registro do desfecho como telemetria pura: nunca bloqueia a UI,
 * nunca mostra erro. `desfecho_ja_registrado` (409) é caso normal (duplo
 * clique) e cai no mesmo `catch` silencioso — a advogada não pode ser punida
 * por uma métrica que não gravou, ela está em reunião com um cliente. */
function registrarDesfechoSemBloquear(sessaoId: string, sugestaoId: string, desfecho: DesfechoCopiloto) {
  void registrarDesfechoSugestaoCopiloto(sessaoId, sugestaoId, desfecho).catch(() => {
    /* telemetria — falha aqui nunca aparece na tela nem impede a ação já tomada */
  });
}

/**
 * `desvio_sugerido` é sugestão com botão, nunca ação executada (B70/B71). Se
 * a advogada clicar, quem navega é `irPara()` — a mesma função das setas do
 * teclado em `ConduzirSessaoApp.tsx`. "Ignorar" sempre ao lado. Cada clique
 * também grava o desfecho (§5 do plano) — telemetria disparada em paralelo,
 * nunca atrasando nem condicionando a navegação/dispensa.
 */
function DesvioSugerido({
  sessaoId,
  sugestaoId,
  desvio,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  sugestaoId: string;
  desvio: NonNullable<SugestaoCopiloto["desvio_sugerido"]>;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const [ignorado, setIgnorado] = useState(false);
  if (ignorado) return null;

  // O servidor já confere `bloco_id` contra o roteiro ativo antes de devolver
  // a sugestão — mas a navegação em si só acontece se a tela também conseguir
  // resolver o índice, contra a lista real do roteiro carregado aqui. Sem
  // isso, o botão "Ir para lá" nunca aparece — a sugestão continua visível
  // como informação, nunca navega com um índice inventado.
  const indiceAlvo = blocosRoteiro?.findIndex((b) => b.id === desvio.bloco_id) ?? -1;
  const podeNavegar = irPara && indiceAlvo >= 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-controle border border-linha bg-papel px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom="latao">Sugestão de desvio</Selo>
        <SeloConfianca confianca={desvio.confianca} />
      </div>
      <p className="text-sm text-tinta">{desvio.motivo}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {podeNavegar && (
          <Botao
            variante="secundario"
            tamanho="compacto"
            onClick={() => {
              irPara(indiceAlvo);
              setIgnorado(true);
              registrarDesfechoSemBloquear(sessaoId, sugestaoId, "aceita");
            }}
          >
            Ir para lá
          </Botao>
        )}
        <Botao
          variante="fantasma"
          tamanho="compacto"
          onClick={() => {
            setIgnorado(true);
            registrarDesfechoSemBloquear(sessaoId, sugestaoId, "ignorada");
          }}
        >
          Ignorar
        </Botao>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fatia 4 (docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2, §5, §6.2.2, §8,
// §12) — o bot na sala (Recall.ai). `PainelBot` pede o bot via
// `POST .../copiloto/bot`; `ApresentacaoComparacaoDecisores` mostra o fato
// participantes x decisores (camada 1 do §5, ZERO IA) quando o chamador
// tiver o dado — hoje NENHUMA rota de leitura devolve
// `ComparacaoDecisoresPresentes` (só `POST .../bot` foi entregue nesta
// rodada; `compararComDecisores` em `server/copiloto/participantes.ts`
// ainda não tem chamador HTTP). O componente é escrito pronto para reuso
// assim que essa rota existir — sem inventar uma chamada de rede que não
// existe (regra da casa: campo novo nasce vazio, a tela mostra vazio,
// nunca dado plausível).
// ---------------------------------------------------------------------------

/** Rótulo humano de cada código de recusa do bot (route.ts, comentário de
 * topo — mesma ordem das travas). Três categorias distintas de propósito:
 *  - ESTADO NORMAL, sem alarme (`bot_ja_pedido`, `audio_ao_vivo_desligado`,
 *    `provedor_audio_nao_configurado`) — tratados fora desta tabela, como
 *    `EstadoVazio`/`role=status`, nunca como `role=alert` vermelho;
 *  - erro transiente, pode tentar de novo (`falha_provedor_bot`,
 *    `servico_indisponivel`);
 *  - erro do LINK da sala (`sala_invalida`) — mensagem própria com o
 *    `sub_codigo`, montada em `mensagemSalaInvalida()`, não nesta tabela. */
const MENSAGENS_RECUSA_BOT: Record<string, { titulo: string; descricao: string; podeTentarDeNovo: boolean }> = {
  sessao_nao_encontrada: {
    titulo: "Sessão não encontrada",
    descricao: "Não foi possível localizar esta Sessão de Viabilidade.",
    podeTentarDeNovo: false,
  },
  sem_link_sala: {
    titulo: "Sem link de sala cadastrado",
    descricao: "Cole o link da reunião na Ficha antes de pedir o bot.",
    podeTentarDeNovo: false,
  },
  copiloto_ao_vivo_bloqueado: {
    titulo: "Copiloto ao vivo bloqueado",
    descricao:
      "O pedido do bot está bloqueado por configuração no servidor. Fale com a equipe técnica.",
    podeTentarDeNovo: false,
  },
  servico_indisponivel: {
    titulo: "O bot não está configurado no servidor",
    descricao: "Falta configuração técnica (chave do provedor ou segredo do webhook). A equipe técnica resolve isso em Admin → Integrações.",
    podeTentarDeNovo: false,
  },
  falha_provedor_bot: {
    titulo: "O provedor do bot não respondeu como esperado",
    descricao: "Pode tentar de novo — às vezes é um caso isolado.",
    podeTentarDeNovo: true,
  },
  retencao_infinita_detectada: {
    titulo: "O bot foi encerrado por segurança",
    descricao:
      "O fornecedor devolveu retenção indefinida do áudio, apesar do pedido explícito de prazo limitado — nenhum segmento foi gravado. Avise a equipe técnica antes de tentar de novo.",
    podeTentarDeNovo: false,
  },
};

/** O `sub_codigo` é o detalhe que mais importa (§4.2.2): `meeting_not_found`
 * é link de sala errado, o defeito mais provável em produção (falha em
 * ~200ms na sonda do Recall, zero consumo). A advogada resolve em 10
 * segundos conferindo o link — "erro ao iniciar o bot" genérico faria ela
 * chamar suporte à toa. `sub_codigo` desconhecido é mostrado CRU (nunca
 * engolido): o backend não mapeia todos os códigos do fornecedor. */
function mensagemSalaInvalida(detalhes: unknown): { titulo: string; descricao: string } {
  const d = (detalhes ?? {}) as Partial<DetalhesSalaInvalidaBot>;
  if (d.sub_codigo === "meeting_not_found") {
    return {
      titulo: "Não encontrei uma reunião nesse link",
      descricao: "Confira o link da sala na Ficha da jornada — é o motivo mais comum deste aviso. Depois de corrigir, peça o bot de novo.",
    };
  }
  if (d.sub_codigo) {
    return {
      titulo: "Não foi possível entrar na sala",
      descricao: `O provedor recusou com o código "${d.sub_codigo}". Confira o link da sala na Ficha; se persistir, informe a equipe técnica com este código.`,
    };
  }
  return {
    titulo: "Não foi possível entrar na sala",
    descricao: "O link pode estar errado ou a reunião não existe. Confira o link da sala na Ficha da jornada.",
  };
}

/**
 * Pedir o bot na sala (Fatia 4, B70/B71 aplicados ao áudio: a advogada pede,
 * nunca é automático). Três estados de recusa tratados como ESTADO, não
 * erro de alarme — `role=status`, nunca vermelho:
 *
 *  - `bot_ja_pedido`: idempotência, caso normal de clique duplo/reabrir a
 *    tela — mostra que o bot já foi pedido, sem convidar a "tentar de novo".
 *  - `audio_ao_vivo_desligado` / `provedor_audio_nao_configurado`: o ESTADO
 *    NORMAL hoje (defaults `audio_ao_vivo=false`, `provedor_audio='nenhum'`
 *    — a chave do provedor não está no servidor). Mesmo padrão do
 *    `CopilotoDesligado`: sóbrio, sem alarme, dizendo o que falta e quem
 *    decide — nunca um botão convidando a insistir numa ação que não vai
 *    funcionar até a configuração mudar.
 *
 * Todo o resto (`copiloto_ao_vivo_bloqueado`, `sala_invalida` com
 * `sub_codigo`, `servico_indisponivel`, `falha_provedor_bot`,
 * `retencao_infinita_detectada`) usa `role=alert` — são recusas de
 * verdade, cada uma com sua própria mensagem (nunca "erro ao iniciar"
 * genérico).
 */
function PainelBot({ sessaoId }: { sessaoId: string }) {
  const [pedindo, setPedindo] = useState(false);
  const [resposta, setResposta] = useState<{ botId: string } | null>(null);
  const [erro, setErro] = useState<unknown>(null);

  async function pedir() {
    if (pedindo) return;
    setPedindo(true);
    setErro(null);
    try {
      const r = await pedirBotCopiloto(sessaoId);
      setResposta({ botId: r.bot_id });
    } catch (e) {
      setResposta(null);
      setErro(e);
    } finally {
      setPedindo(false);
    }
  }

  const codigoErro = erro instanceof ErroSessao ? erro.codigo : undefined;

  // Estado NORMAL: bot não configurado hoje (default) — não é erro.
  if (codigoErro === "audio_ao_vivo_desligado" || codigoErro === "provedor_audio_nao_configurado") {
    return (
      <Cartao rotulo="Bot na sala" titulo="Transcrição ao vivo por bot" preenchimento="compacto">
        <EstadoVazio
          compacto
          ilustracao="pasta"
          titulo="Bot na sala não configurado"
          descricao="Falta a chave do provedor de transcrição no servidor (RECALL_API_KEY e COPILOTO_WEBHOOK_SECRET, em Admin → Integrações). Enquanto isso o copiloto funciona normalmente — o que muda é só quem escreve a transcrição: sem o bot, a fala é digitada aqui."
        />
      </Cartao>
    );
  }

  // Estado NORMAL: idempotência — já existe bot pedido para esta sessão.
  if (codigoErro === "bot_ja_pedido") {
    return (
      <Cartao rotulo="Bot na sala" titulo="Transcrição ao vivo por bot" preenchimento="compacto">
        <p role="status" className="text-sm text-tinta-suave">
          Já existe um bot pedido para esta sessão — não é possível pedir um segundo.
        </p>
      </Cartao>
    );
  }

  return (
    <Cartao rotulo="Bot na sala" titulo="Transcrição ao vivo por bot" preenchimento="compacto">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-tinta-suave">
          Um bot entra na sala como participante visível, grava e transcreve ao vivo para o copiloto — nunca sozinho,
          só quando você pedir.
        </p>

        <Botao type="button" variante="primario" tamanho="compacto" carregando={pedindo} onClick={() => void pedir()} className="self-start">
          Pedir bot na sala
        </Botao>

        {!pedindo && erro !== null && <MensagemRecusaBot erro={erro} codigo={codigoErro} aoTentarDeNovo={() => void pedir()} />}

        {!pedindo && !erro && resposta && (
          <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
            Bot pedido. Ele deve entrar na sala em instantes, visível para o cliente como participante.
          </p>
        )}
      </div>
    </Cartao>
  );
}

function MensagemRecusaBot({
  erro,
  codigo,
  aoTentarDeNovo,
}: {
  erro: unknown;
  codigo: string | undefined;
  aoTentarDeNovo: () => void;
}) {
  if (codigo === "sala_invalida") {
    const { titulo, descricao } = mensagemSalaInvalida(erro instanceof ErroSessao ? erro.detalhes : undefined);
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm">
        <p className="font-bold text-[color:var(--vermelho)]">{titulo}</p>
        <p className="text-tinta">{descricao}</p>
        <Botao variante="perigo" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      </div>
    );
  }

  const conhecida = codigo ? MENSAGENS_RECUSA_BOT[codigo] : undefined;
  const { titulo, descricao, podeTentarDeNovo } = conhecida ?? {
    titulo: "Não foi possível pedir o bot",
    descricao: erro instanceof ErroSessao ? erro.message : "Erro inesperado. Tente de novo em instantes.",
    podeTentarDeNovo: true,
  };
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm">
      <p className="font-bold text-[color:var(--vermelho)]">{titulo}</p>
      <p className="text-tinta">{descricao}</p>
      {podeTentarDeNovo && (
        <Botao variante="perigo" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

/**
 * A CAMADA 1 do §5 — fato, SEM IA. Participantes da sala x decisores que o
 * briefing esperava (`server/copiloto/participantes.ts::compararComDecisores`).
 * Apresentado como FATO com as duas fontes visíveis (exemplo do plano):
 * "O briefing esperava 2 decisores: Terezinha e Cleison. Na sala: Terezinha."
 *
 * `ausentes` != `ambiguos` — tratamento DISTINTO e deliberado:
 *  - `ausentes`: o nome não casou com NENHUM participante — é FATO, a tela
 *    afirma.
 *  - `ambiguos`: o nome casou com MAIS DE UM participante (ou de forma
 *    incerta) — a tela diz "não consegui conferir", NUNCA "ausente".
 *    Casamento por nome normalizado erra (apelido, nome composto,
 *    "Cleison" x "Cleison Roberto") — um falso "decisor ausente" faz a
 *    advogada agir errado com a família na frente dela. `ambiguos` recebe
 *    o mesmo cuidado que uma acusação: nunca afirmado sem certeza.
 *
 * Nome de pessoa real é texto puro (`{variável}` do JSX já escapa — React
 * nunca interpreta HTML de string; nenhum `dangerouslySetInnerHTML` aqui,
 * de propósito — nome de participante vem de fora e é entrada não confiável).
 */
export function ApresentacaoComparacaoDecisores({ comparacao }: { comparacao: ComparacaoDecisoresPresentes }) {
  const { decisores_esperados, participantes_presentes, ausentes, ambiguos } = comparacao;
  if (decisores_esperados.length === 0) return null;

  return (
    <Cartao rotulo="Decisores" titulo="Quem o briefing esperava x quem está na sala" preenchimento="compacto">
      <div className="flex flex-col gap-2 text-sm text-tinta">
        <p>
          O briefing esperava {decisores_esperados.length === 1 ? "1 decisor" : `${decisores_esperados.length} decisores`}:{" "}
          {decisores_esperados.join(", ")}. Na sala:{" "}
          {participantes_presentes.length > 0 ? participantes_presentes.join(", ") : "ninguém identificado ainda"}.
        </p>

        {ausentes.length > 0 && (
          <div className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3 py-2">
            <p className="font-bold text-[color:var(--ambar)]">{ausentes.length === 1 ? "Não entrou na sala:" : "Não entraram na sala:"}</p>
            <p className="text-tinta">{ausentes.join(", ")}</p>
          </div>
        )}

        {ambiguos.length > 0 && (
          <div className="rounded-controle border border-dashed border-linha-forte px-3 py-2">
            <p className="font-bold text-tinta-fraca">Não foi possível confirmar:</p>
            <p className="text-tinta-suave">{ambiguos.join(", ")} — o nome na sala não casou com confiança suficiente. Não trate como ausência.</p>
          </div>
        )}
      </div>
    </Cartao>
  );
}

/** Estado desligado por configuração — texto sóbrio, sem alarme, dizendo o
 * que é e quem liga. Mesmo padrão visual de `ConduzirSessaoApp` em
 * `sem-roteiro` (EstadoVazio com título + descrição, sem ação clicável aqui
 * porque ligar o copiloto é Admin → Parâmetros, fora do alcance desta tela). */
function CopilotoDesligado() {
  return (
    <EstadoVazio
      ilustracao="pasta"
      titulo="Copiloto desligado"
      descricao="O copiloto ao vivo está desligado por configuração (copiloto_sessao.ativo = false em Admin). A sessão segue normalmente pelo roteiro — ninguém precisa dele ligado para conduzir. Quem liga é a equipe técnica, em Admin."
    />
  );
}

function FaltaNoBloco({ falta }: { falta: { campos: { id: string; rotulo: string }[]; observar: string[] } }) {
  const semCampos = falta.campos.length === 0;
  const semObservar = falta.observar.length === 0;

  return (
    <Cartao rotulo="Neste bloco" titulo="O que falta" preenchimento="compacto">
      {semCampos && semObservar ? (
        <p className="text-sm text-tinta-suave">Este bloco não tem campo nem ponto de observação cadastrado no roteiro.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {falta.campos.length > 0 && (
            <div>
              <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">A preencher</p>
              <ul className="flex flex-col gap-1">
                {falta.campos.map((campo) => (
                  <li key={campo.id} className="flex items-start gap-1.5 text-sm text-tinta">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--ambar)]">
                      <circle cx="10" cy="10" r="4" />
                    </svg>
                    {campo.rotulo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {falta.observar.length > 0 && (
            <div>
              <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">Observar</p>
              <ul className="flex flex-col gap-1">
                {falta.observar.map((item, i) => (
                  <li key={i} className="text-sm text-tinta-suave">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}

function SimsPendentes({ pendentes }: { pendentes: { sim: string; rotulo: string }[] }) {
  const registrados = 4 - pendentes.length;
  return (
    <Cartao rotulo="Os 4 SIMs" titulo="SIMs pendentes" preenchimento="compacto" acao={<Selo tom={pendentes.length === 0 ? "verde" : "neutro"}>{registrados} de 4</Selo>}>
      {pendentes.length === 0 ? (
        <p className="text-sm text-tinta-suave">Os 4 SIMs já foram registrados.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {pendentes.map((p) => (
            <li key={p.sim} className="text-sm text-tinta">
              {p.rotulo}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function BlocosNaoPercorridos({ blocos }: { blocos: { id: string; titulo: string }[] }) {
  return (
    <Cartao rotulo="Roteiro" titulo="Blocos ainda não percorridos" preenchimento="compacto" acao={<Selo tom="neutro">{blocos.length}</Selo>}>
      {blocos.length === 0 ? (
        <p className="text-sm text-tinta-suave">Este é o último bloco do roteiro.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {blocos.map((bloco) => (
            <li key={bloco.id} className="text-sm text-tinta-suave">
              {bloco.titulo}
            </li>
          ))}
        </ol>
      )}
    </Cartao>
  );
}

function RegistroManual({ sessaoId, sessaoEncerrada }: { sessaoId: string; sessaoEncerrada: boolean }) {
  const buscarSegmentos = useCallback(() => listarSegmentosCopiloto(sessaoId), [sessaoId]);
  const { dados: resposta, carregando, erro, recarregar, setDados: setResposta } = useRecurso(buscarSegmentos, [sessaoId]);
  const segmentos = resposta?.itens ?? null;

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  async function enviar() {
    const valor = texto.trim();
    if (!valor) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const segmento = await registrarSegmentoManual(sessaoId, valor);
      setResposta((atual) => adicionarSegmento(atual, segmento));
      setTexto("");
    } catch (e) {
      if (ehCopilotoDesligado(e)) {
        setErroEnvio("O copiloto está desligado por configuração — este trecho não foi registrado.");
      } else {
        setErroEnvio(e instanceof ErroSessao ? e.message : "Não foi possível registrar o trecho. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  }

  // A leitura inicial de segmentos também pode bater no 409 (mesma trava,
  // caminho de leitura) — mesmo tratamento de estado, não de erro.
  if (!carregando && ehCopilotoDesligado(erro)) {
    return (
      <Cartao rotulo="Transcrição desta sessão" titulo="Digitar ou colar um trecho" preenchimento="compacto">
        <p className="text-sm text-tinta-suave">O copiloto está desligado por configuração — nenhum trecho pode ser registrado agora.</p>
      </Cartao>
    );
  }

  // Achado do Fable (Fatia 5): campo escondido/desabilitado quando a
  // sessao ja encerrou -- nao e sumico mudo, e ESTADO EXPLICITO (mesma
  // regra de CopilotoDesligado/GateBloqueado). Sem isto, texto
  // digitado aqui depois do encerramento nunca entra em transcricoes
  // (re-encerrar e 409 sessao_ja_encerrada, nao reconsolida) e o
  // expurgo da Fatia 5 o apaga aos 7 dias -- a advogada acharia que
  // registrou algo que evapora em silencio. Esta tela e CONVENIENCIA
  // (impede o ERRO); a trava de verdade e do backend (409 no POST,
  // backstop no DELETE por criado_em <= encerrado_em).
  if (sessaoEncerrada) {
    return (
      <Cartao rotulo="Transcrição desta sessão" titulo="Digitar ou colar um trecho" preenchimento="compacto">
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          Sessão encerrada — a transcrição já foi consolidada. Não é possível registrar novos trechos aqui.
        </p>
      </Cartao>
    );
  }

  return (
    <Cartao rotulo="Transcrição desta sessão" titulo="Digitar ou colar um trecho" preenchimento="compacto">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <Campo rotulo="Trecho da fala" ajuda="Fica registrado como transcrição desta sessão — não é o prontuário jurídico.">
          <AreaTexto
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Ex.: o cliente disse que o filho mais velho não pôde vir hoje…"
          />
        </Campo>
        {erroEnvio && (
          <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
            {erroEnvio}
          </p>
        )}
        <Botao type="submit" variante="primario" tamanho="compacto" carregando={enviando} disabled={!texto.trim()} className="self-start">
          Registrar trecho
        </Botao>
      </form>

      <div className="mt-3 border-t border-linha pt-3">
        {carregando && <EstadoCarregando rotulo="Carregando transcrição…" />}
        {!carregando && Boolean(erro) && (
          <p role="alert" className="flex flex-col items-start gap-1.5 text-legenda text-[color:var(--vermelho)]">
            Não foi possível carregar os trechos já registrados.
            <Botao variante="perigo" tamanho="compacto" onClick={recarregar}>
              Tentar de novo
            </Botao>
          </p>
        )}
        {!carregando && !erro && segmentos && segmentos.length === 0 && (
          <EstadoVazio compacto titulo="Nenhum trecho registrado ainda" descricao="O que for digitado ou colado acima aparece aqui, em ordem." />
        )}
        {!carregando && !erro && segmentos && segmentos.length > 0 && (
          <ul className="flex flex-col gap-2">
            {segmentos.map((segmento) => (
              <li key={segmento.id} className="rounded-controle border border-linha bg-papel px-3 py-2 text-sm text-tinta">
                <p className="mb-0.5 text-legenda text-tinta-fraca">{formatarDataHora(segmento.criado_em)}</p>
                <p>{segmento.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Cartao>
  );
}

/** Acrescenta o segmento recém-criado à resposta cacheada por `useRecurso`,
 * sem esperar a próxima leitura — mesma técnica de `setDados` usada por
 * `PainelSims`/`PainelBriefingSessao` (estado de servidor, não duplicado). */
function adicionarSegmento(
  atual: { itens: SegmentoCopiloto[]; proximo_cursor: number } | undefined,
  novo: SegmentoCopiloto,
): { itens: SegmentoCopiloto[]; proximo_cursor: number } {
  const itens = [...(atual?.itens ?? []), novo];
  return { itens, proximo_cursor: novo.ordem };
}
