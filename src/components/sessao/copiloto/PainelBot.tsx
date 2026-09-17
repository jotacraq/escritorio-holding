"use client";

import { useState } from "react";
import { ErroSessao, pedirBotCopiloto } from "@/components/sessao/api";
import type { DetalhesSalaInvalidaBot } from "@/types/copiloto";
import { Quadro } from "@/components/ui/Quadro";
import { Botao } from "@/components/ui/Botao";

// ---------------------------------------------------------------------------
// Fatia 4 (docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2, §5, §6.2.2, §8,
// §12) — o bot na sala (Recall.ai). `PainelBot` pede o bot via
// `POST .../copiloto/bot`.
//
// Fase 12, Fatia B (tela vira leitura): `PainelBot` deixa de ser um dos
// blocos da primeira dobra — pedir o bot é OPERAÇÃO (antes de/preparando a
// sessão), não CONDUÇÃO ao vivo. Extraído para arquivo próprio, corpo
// intacto, para o cabeçalho de `ConduzirSessaoApp.tsx` consumir. O erro
// `sala_invalida` continua tratado aqui — a linha fina do topo (ver
// `ConduzirSessaoApp.tsx`) lê o mesmo `codigoErro` para avisar "não entrou
// na sala" sem que a advogada precise abrir este quadro para descobrir.
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
  // Bot autenticado no Zoom (17/09/2026) — a conta ainda não foi autorizada
  // (Admin → Integrações → Zoom). Distinto de `sala_invalida`: aqui o link
  // está certo, falta é a autorização OAuth do lado do sistema.
  zoom_nao_autorizado: {
    titulo: "A conta Zoom ainda não foi autorizada",
    descricao: "Peça para a equipe técnica autorizar o Zoom em Admin → Integrações antes de pedir o bot nesta sala.",
    podeTentarDeNovo: false,
  },
};

/** Sub-códigos do Zoom para reunião com bot (§ zoom-signed-in-bots +
 * medidos/documentados do lado do Recall) — cada um com instrução do que
 * fazer, nunca "erro ao iniciar" genérico. Mapa próprio (não
 * `MENSAGENS_RECUSA_BOT`) porque estes chegam DENTRO de `sala_invalida`,
 * como `detalhes.sub_codigo` — mesmo canal de `meeting_not_found`. */
const SUB_CODIGOS_ZOOM: Record<string, { titulo: string; descricao: string }> = {
  meeting_requires_sign_in: {
    titulo: "A reunião exige participante autenticado",
    descricao:
      "A conta Zoom desta reunião exige login. Se a conta Zoom do sistema ainda não foi autorizada, peça para a equipe técnica fazer isso em Admin → Integrações; se já foi, confira se a credencial ainda é válida.",
  },
  zoom_local_recording_disabled: {
    titulo: "A gravação local está desativada nesta conta Zoom",
    descricao: "Peça para o administrador da conta Zoom da reunião habilitar a gravação local, ou ative a permissão de gravação para o bot na configuração da conta.",
  },
  zoom_bot_in_waiting_room: {
    titulo: "O bot ficou preso na sala de espera",
    descricao: "Alguém precisa admitir o bot manualmente na sala de espera do Zoom, ou desative a sala de espera para esta reunião.",
  },
  zoom_local_recording_request_disabled_by_host: {
    titulo: "O anfitrião desativou o pedido de gravação local",
    descricao: "Peça para o anfitrião da reunião permitir gravação local para participantes, ou aprove o pedido de gravação manualmente durante a chamada.",
  },
};

/** O `sub_codigo` é o detalhe que mais importa (§4.2.2): `meeting_not_found`
 * é link de sala errado, o defeito mais provável em produção (falha em
 * ~200ms na sonda do Recall, zero consumo). A advogada resolve em 10
 * segundos conferindo o link — "erro ao iniciar o bot" genérico faria ela
 * chamar suporte à toa. `sub_codigo` desconhecido é mostrado CRU (nunca
 * engolido): o backend não mapeia todos os códigos do fornecedor. */
export function mensagemSalaInvalida(detalhes: unknown): { titulo: string; descricao: string } {
  const d = (detalhes ?? {}) as Partial<DetalhesSalaInvalidaBot>;
  if (d.sub_codigo === "meeting_not_found") {
    return {
      titulo: "Não encontrei uma reunião nesse link",
      descricao: "Confira o link da sala na Ficha da jornada — é o motivo mais comum deste aviso. Depois de corrigir, peça o bot de novo.",
    };
  }
  if (d.sub_codigo && SUB_CODIGOS_ZOOM[d.sub_codigo]) {
    return SUB_CODIGOS_ZOOM[d.sub_codigo];
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
 *
 * `aoMudarEstado` (Fase 12, Fatia B): notifica o pai (a linha fina do topo
 * de `ConduzirSessaoApp.tsx`) do código de erro corrente — é como a linha
 * fina sabe mostrar "não entrou na sala" sem duplicar a lógica de leitura
 * do erro em dois lugares.
 *
 * `compacto` (Fase 12, Fatia C — "convidar o bot" visível na linha fina):
 * MESMO estado, MESMO `pedir()`, MESMAS mensagens de recusa — só a moldura
 * muda, de `Quadro` (título "Bot na sala", pensado para um mosaico de
 * cartões) para um fragmento inline que cabe ao lado de "Agora: <parte>".
 * Nenhuma lógica nova: é a razão de existir desta prop, em vez de reescrever
 * o pedido do bot dentro de `ConduzirSessaoApp.tsx`.
 */
export function PainelBot({ sessaoId, aoMudarEstado, compacto = false }: { sessaoId: string; aoMudarEstado?: (codigoErro: string | undefined) => void; compacto?: boolean }) {
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
      aoMudarEstado?.(undefined);
    } catch (e) {
      setResposta(null);
      setErro(e);
      aoMudarEstado?.(e instanceof ErroSessao ? e.codigo : undefined);
    } finally {
      setPedindo(false);
    }
  }

  const codigoErro = erro instanceof ErroSessao ? erro.codigo : undefined;

  // Estado NORMAL: bot não configurado hoje (default) — não é erro. Sem
  // clique nenhum a advogada não usa este quadro (ele nasce assim que a
  // tela abre, não é resposta a uma ação dela) — então não ocupa espaço
  // permanente na grade; vira `null` (regra do Marcio, 14/09: quadro
  // vazio na sessão inteira não merece lugar fixo).
  if (codigoErro === "audio_ao_vivo_desligado" || codigoErro === "provedor_audio_nao_configurado") {
    return null;
  }

  // Estado NORMAL: idempotência — já existe bot pedido para esta sessão.
  if (codigoErro === "bot_ja_pedido") {
    if (compacto) {
      return (
        <p role="status" className="text-tinta-suave">
          Bot já pedido
        </p>
      );
    }
    return (
      <Quadro rotulo="Bot na sala">
        <p role="status" className="text-sm text-tinta-suave">
          Já existe um bot pedido para esta sessão — não é possível pedir um segundo.
        </p>
      </Quadro>
    );
  }

  // No modo compacto a mensagem de recusa longa já tem casa própria (o
  // aviso da linha fina, alimentado por `aoMudarEstado`) — repeti-la aqui
  // duplicaria o mesmo erro duas vezes na mesma linha. Só "tentar de novo"
  // fica junto do botão; o texto completo mora em `AvisoSalaInvalidaLinhaFina`
  // (`ConduzirSessaoApp.tsx`).
  if (compacto) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Botao type="button" variante="primario" tamanho="compacto" carregando={pedindo} onClick={() => void pedir()}>
          Convidar o bot
        </Botao>
        {!pedindo && !erro && resposta && (
          <p role="status" className="text-tinta-suave">
            Bot pedido — entra na sala em instantes
          </p>
        )}
        {!pedindo && erro !== null && (
          <Botao type="button" variante="fantasma" tamanho="compacto" onClick={() => void pedir()}>
            Tentar de novo
          </Botao>
        )}
      </div>
    );
  }

  return (
    <Quadro rotulo="Bot na sala">
      <div className="flex flex-col gap-2.5">
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
    </Quadro>
  );
}

export function MensagemRecusaBot({
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
