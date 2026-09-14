import { APP_URL } from "@/lib/config-publica";
import { registrarErro } from "@/server/erros";

/**
 * Adaptador do Recall.ai — Fase 10, Fatia 4a (docs/ARQUITETURA-FASE-10.md
 * §4.2, §4.2.1, §4.2.2, §8). `fetch` cru com timeout explícito, no padrão de
 * `server/regua/email.ts` (sem SDK novo — mesmo motivo: não adicionar
 * dependência a um `package.json` compartilhado com os outros agentes desta
 * squad).
 *
 * Contrato MEDIDO na sonda real de 11/09/2026 — não documentação lida:
 *   - Base: `https://us-east-1.recall.ai/api/v1/`.
 *   - Header `Authorization: Token <chave>` — é `Token`, **NÃO** `Bearer`.
 *     Errar isto é 401 silencioso (o fornecedor não distingue "header
 *     ausente" de "esquema errado" na mensagem de erro).
 *   - `POST /bot/` respondeu 201 na primeira tentativa com o corpo exato
 *     documentado abaixo.
 *
 * 🔴 `retention` (§4.2.1) — o default do fornecedor é `forever`. Por isso
 * `retention` é PARÂMETRO OBRIGATÓRIO na assinatura de `pedirBot()`: omitir
 * é erro de TypeScript, não escolha de estilo. E a resposta é CONFERIDA
 * depois de criar — se vier `forever` mesmo assim, o bot é encerrado na hora
 * (chamando `encerrarBot` deste mesmo módulo) e o chamador recebe
 * `retencao_infinita_detectada`, nunca um bot "criado com sucesso".
 */

const BASE_URL = "https://us-east-1.recall.ai/api/v1";
const TIMEOUT_MS = 15_000;

export function recallConfigurado(): boolean {
  return Boolean(process.env.RECALL_API_KEY?.trim());
}

function cabecalhos(): Record<string, string> {
  // "Token", não "Bearer" — achado da sonda de 11/09. Ver comentário de topo.
  return {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export function copilotoWebhookConfigurado(): boolean {
  return Boolean(process.env.COPILOTO_WEBHOOK_SECRET?.trim());
}

/**
 * A URL exata a usar em `PedirBotParams.webhookUrl` — ÚNICA fonte desta
 * montagem, para o formato nunca divergir do que
 * `src/app/api/webhooks/copiloto/transcricao/route.ts` espera ler
 * (`?k=<segredo>`, comparado em tempo constante). `null` sem o secret
 * configurado — o CHAMADOR decide o que fazer (não pedir o bot, mostrar
 * pendência em Admin → Integrações), este módulo nunca monta URL sem
 * segredo por engano. */
export function montarWebhookUrlComSegredo(): string | null {
  const segredo = process.env.COPILOTO_WEBHOOK_SECRET?.trim();
  if (!segredo) return null;
  return `${APP_URL}/api/webhooks/copiloto/transcricao?k=${encodeURIComponent(segredo)}`;
}

/** O único formato de retenção que este módulo envia — nunca omitido (§4.2.1).
 * `deleção_imediata` não existe como opção do fornecedor na sonda; o valor
 * mais curto medido é `days` com `retention_days` explícito. */
export type RetencaoBot = { type: "days"; retention_days: number };

export interface PedirBotParams {
  sessaoId: string;
  linkSala: string;
  nomeBot: string;
  /** URL do NOSSO webhook — inclui o segredo compartilhado como query param.
   * Ver o comentário de topo de
   * `src/app/api/webhooks/copiloto/transcricao/route.ts` para a avaliação
   * completa (pedida pelo coordenador): o schema de `realtime_endpoints[]`
   * do Recall só aceita `type`/`url`/`events`/`metadata` — SEM campo de
   * headers customizados neste tipo de endpoint — então não é uma escolha
   * entre HMAC e query param, é entre query param e nada. Usar
   * `montarWebhookUrlComSegredo()` (deste módulo) para nunca montar essa URL
   * de outra forma. */
  webhookUrl: string;
  /** OBRIGATÓRIO — nunca tem default neste módulo. Ver §4.2.1. */
  retention: RetencaoBot;
  /** `copiloto_sessao.duracao_maxima_minutos`, convertido para segundos pelo
   * CHAMADOR — os defaults do fornecedor (`waiting_room_timeout` 1200s,
   * `noone_joined_timeout` 1200s, `silence_detection` 3600s) são tempo
   * cobrado e nunca são aceitos aqui sem valor nosso (§4.2.2). */
  automaticLeave: {
    waitingRoomTimeoutS: number;
    noOneJoinedTimeoutS: number;
    silenceDetectionS: number;
  };
  /** Lista de participantes que, se TODOS os restantes casarem, dispara a
   * saída do bot. Nunca inclui o próprio `nomeBot` (§4.2.2/B72) — decisão
   * nossa, nunca o default do fornecedor. */
  botDetectionMatches: string[];
}

export interface StatusChangeBot {
  code: string;
  sub_code: string | null;
  created_at: string;
}

export interface RespostaCriacaoBot {
  id: string;
  status_changes: StatusChangeBot[];
  recordings: unknown[];
  retention: { type: string; retention_days?: number } | null;
}

export type ResultadoPedirBot =
  | { situacao: "criado"; botId: string; statusChanges: StatusChangeBot[]; recordings: unknown[] }
  /** A sala não existe / o link é inválido — `joining_call` -> `fatal`
   * (`meeting_not_found`) em ~200ms na sonda, zero consumo. O `sub_code` TEM
   * de chegar ao chamador (§4.2.2): "erro ao iniciar" genérico não ajuda
   * ninguém a saber que o link colado está errado. */
  | { situacao: "sala_invalida"; subCodigo: string | null; codigo: string | null }
  /** A resposta veio com `retention.type==='forever'` apesar do pedido
   * explícito — o módulo TENTOU encerrar o bot (com retentativa) antes de
   * devolver. `encerramentoConfirmado` diz se a tentativa teve SUCESSO —
   * 🔴 achado 4 do Fable: antes desta correção, uma falha na 1ª (e única)
   * tentativa de encerrar deixava o bot na sala real, gravando com retenção
   * indefinida, enquanto o chamador seguia como se estivesse tudo resolvido.
   * Quando `encerramentoConfirmado===false`, o CHAMADOR (rota) tem de
   * devolver uma mensagem que reflita isso — nunca "o bot foi encerrado". */
  | { situacao: "retencao_infinita_detectada"; botId: string; encerramentoConfirmado: boolean }
  | { situacao: "falha_provedor"; detalhe: string }
  | { situacao: "nao_configurado" };

/**
 * Cria o bot na sala. Nunca aceita chamada sem `retention` (assinatura
 * obrigatória — ver `PedirBotParams`). Depois do 201, confere a retenção
 * EFETIVA devolvida: se vier `forever`, tenta encerrar o bot IMEDIATAMENTE
 * (com 1 retentativa — `encerrarBotComRetentativa`, achado 4 do Fable) e
 * marca `retencao_infinita_detectada` com `encerramentoConfirmado` refletindo
 * se a tentativa teve sucesso de verdade — o chamador (rota) é quem grava a
 * pendência e decide a mensagem exibida (fora deste módulo, que não conhece
 * o schema de pendências).
 *
 * 🔴 GATE JURÍDICO — RESPONSABILIDADE DO CHAMADOR, ANTES desta chamada
 * (errata §6.2.2 do plano). O áudio sai da sala no instante em que o bot
 * entra — ANTES de qualquer INSERT nosso. Este módulo não confere
 * `conferirGateCopiloto` (gate.ts) por desenho: fazer isso aqui dentro
 * esconderia a ordem real das operações de quem lê a rota que chama
 * `pedirBot()`. A rota que pedir o bot TEM de: (1) conferir o gate
 * (`server/copiloto/gate.ts::conferirGateCopiloto`), (2) só então chamar
 * `pedirBot()`, (3) gravar `sessoes_copiloto.gravacao_externa_id = botId`
 * — que é o INSERT/UPDATE sobre o qual a trigger `trg_copiloto_exige_decisao_bot_pedido`
 * (0093) atua como BACKSTOP. Pular o passo 1 e confiar só na trigger repete
 * o erro que a errata já documentou noutro caminho: a trigger dispara DEPOIS
 * do áudio já ter saído da sala.
 */
export async function pedirBot(params: PedirBotParams): Promise<ResultadoPedirBot> {
  if (!recallConfigurado()) return { situacao: "nao_configurado" };

  const corpo = {
    meeting_url: params.linkSala,
    bot_name: params.nomeBot,
    recording_config: {
      // 🔴 MEDIDO EM PRODUÇÃO (14/09/2026), corrige o §4.2 do plano, que assumia
      // `meeting_captions`. A legenda da própria plataforma NÃO serve: ela só
      // existe se alguém tiver ligado o CC na reunião — o bot grava minutos sem
      // produzir uma linha de texto, e o sintoma é SILÊNCIO, não erro.
      //
      // Comparação com a MESMA fala real, na mesma sala:
      //   assembly_ai_v3_streaming (só aceita `en`|`multi`, recusa `pt`):
      //     "mais tem dois filhos sou natural de trabalho da tijuca do rio de janeiro"
      //   deepgram_streaming pt-BR:
      //     "Meu nome é Márcio, sou natural da Tijuca, tenho 2 filhos,"
      //
      // Português dedicado acerta nome próprio, topônimo, pontuação e número.
      // Isso não é estética: a IA do copiloto tem de citar EVIDÊNCIA LITERAL do
      // que o cliente disse (§4.3), e esta transcrição vira o insumo do Agente
      // do Croqui ao consolidar. Transcrição ruim = citação que não casa.
      transcript: {
        provider: {
          deepgram_streaming: {
            model: "nova-2",
            language: "pt-BR",
            punctuate: true,
            smart_format: true,
          },
        },
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: params.webhookUrl,
          events: ["transcript.data", "participant_events.join", "participant_events.leave"],
        },
      ],
    },
    // §4.2.1 — SEMPRE explícito, nunca omitido: é o que impede o default
    // `forever` do fornecedor de se aplicar em silêncio.
    retention: params.retention,
    // §4.2.2 — valores NOSSOS, nunca os defaults (20min de sala de espera e
    // 1h de silêncio são tempo cobrado).
    automatic_leave: {
      waiting_room_timeout: params.automaticLeave.waitingRoomTimeoutS,
      noone_joined_timeout: params.automaticLeave.noOneJoinedTimeoutS,
      silence_detection: { timeout: params.automaticLeave.silenceDetectionS },
    },
    // §4.2.2/B72 — lista explícita e NOSSA; o nome do bot nunca entra aqui.
    bot_detection: { using_participant_events: { matches: params.botDetectionMatches } },
  };

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_URL}/bot/`, {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    registrarErro("copiloto/recall.pedirBot#rede", erro, { sessao_id: params.sessaoId });
    return { situacao: "falha_provedor", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  const corpoResposta = (await resposta.json().catch(() => null)) as RespostaCriacaoBot | null;

  if (!resposta.ok || !corpoResposta?.id) {
    registrarErro("copiloto/recall.pedirBot#http", new Error(`recall_${resposta.status}`), {
      sessao_id: params.sessaoId,
      status: resposta.status,
    });
    return { situacao: "falha_provedor", detalhe: `recall_${resposta.status}` };
  }

  // Sala inexistente: `status_changes` mais recente é `fatal`/`meeting_not_found`
  // (medido: ~200ms, zero consumo). O `sub_code` sobe ao chamador, nunca é
  // engolido — é o defeito mais provável em produção (§4.2.2).
  const ultimoStatus = corpoResposta.status_changes?.[corpoResposta.status_changes.length - 1] ?? null;
  if (ultimoStatus?.code === "fatal") {
    return { situacao: "sala_invalida", subCodigo: ultimoStatus.sub_code, codigo: ultimoStatus.code };
  }

  // §4.2.1 — conferência pós-criação: `forever` (mesmo pedido explicitamente
  // diferente) é defeito nosso se passar batido. Encerra na hora, COM
  // RETENTATIVA (achado 4 do Fable — ver `encerrarBotComRetentativa`).
  if (corpoResposta.retention?.type === "forever") {
    const encerramento = await encerrarBotComRetentativa(corpoResposta.id);
    registrarErro(
      "copiloto/recall.pedirBot#retencao_forever",
      new Error("Recall devolveu retention.type=forever apesar do pedido explícito"),
      { sessao_id: params.sessaoId, bot_id: corpoResposta.id, encerramento_confirmado: encerramento.sucesso },
    );
    return { situacao: "retencao_infinita_detectada", botId: corpoResposta.id, encerramentoConfirmado: encerramento.sucesso };
  }

  return {
    situacao: "criado",
    botId: corpoResposta.id,
    statusChanges: corpoResposta.status_changes ?? [],
    recordings: corpoResposta.recordings ?? [],
  };
}

export type ResultadoEncerrarBot =
  | { situacao: "encerrado" }
  /** 400 `bot_command_error` quando o bot já desligou — ESTADO ESPERADO,
   * medido na sonda, não falha (§4.2.2). NUNCA chama `registrarErro`: senão
   * a Fatia 4 enche `erros_servidor` de ruído toda vez que o bot sai sozinho
   * antes da advogada clicar "Encerrar". */
  | { situacao: "ja_tinha_saido" }
  | { situacao: "falha_provedor"; detalhe: string }
  | { situacao: "nao_configurado" };

/**
 * `POST /bot/<id>/leave_call/` — idempotente por desenho: chamar duas vezes
 * (ou chamar depois que o bot já saiu sozinho, ex.: `automatic_leave`) é
 * `400 bot_command_error`, tratado aqui como sucesso ("já saiu"), não como
 * erro. É este comportamento que faz o `encerrar.ts` da Fatia 3 poder chamar
 * o encerramento do bot sem se preocupar com a ordem de quem saiu primeiro.
 */
export async function encerrarBot(botId: string): Promise<ResultadoEncerrarBot> {
  if (!recallConfigurado()) return { situacao: "nao_configurado" };

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_URL}/bot/${encodeURIComponent(botId)}/leave_call/`, {
      method: "POST",
      headers: cabecalhos(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    registrarErro("copiloto/recall.encerrarBot#rede", erro, { bot_id: botId });
    return { situacao: "falha_provedor", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  if (resposta.ok) return { situacao: "encerrado" };

  if (resposta.status === 400) {
    const corpo = (await resposta.json().catch(() => null)) as { code?: string } | null;
    if (corpo?.code === "bot_command_error") {
      // Estado esperado — NÃO registrarErro (comentário de topo do tipo).
      return { situacao: "ja_tinha_saido" };
    }
  }

  registrarErro("copiloto/recall.encerrarBot#http", new Error(`recall_${resposta.status}`), { bot_id: botId, status: resposta.status });
  return { situacao: "falha_provedor", detalhe: `recall_${resposta.status}` };
}

export type ResultadoEncerrarBotComRetentativa =
  | { sucesso: true; situacao: "encerrado" | "ja_tinha_saido" }
  /** As DUAS tentativas falharam — falha DEFINITIVA. O bot pode continuar
   * na sala real. O CHAMADOR (rota) é quem decide o que fazer com isso —
   * este módulo só relata o fato, nunca esconde atrás de um retry mudo. */
  | { sucesso: false; detalhe: string };

/**
 * `encerrarBot()` com 1 RETENTATIVA — Fase 10, Fatia 4, achado 4 do Fable
 * (§4.2.1/§4.2.2, B76): "retention: forever + encerrarBot falhando = a
 * catástrofe do B76 tratada como uma linha de log". Antes desta correção,
 * uma falha isolada de rede/HTTP na 1ª chamada de `encerrarBot()` bastava
 * para o bot continuar na sala gravando com retenção infinita, e o
 * chamador seguia como se o encerramento tivesse funcionado.
 *
 * Esta função SEMPRE devolve um resultado EXPLÍCITO de sucesso ou falha
 * definitiva — nunca deixa a decisão para quem lê um `registrarErro` no
 * stdout. O `automatic_leave` de silêncio NÃO é rede de segurança aqui:
 * ele não dispara em reunião ATIVA (só em sala vazia/silenciosa) — não
 * salva o caso em que o bot está gravando conversa de verdade.
 */
export async function encerrarBotComRetentativa(botId: string): Promise<ResultadoEncerrarBotComRetentativa> {
  const primeira = await encerrarBot(botId);
  if (primeira.situacao === "encerrado" || primeira.situacao === "ja_tinha_saido") {
    return { sucesso: true, situacao: primeira.situacao };
  }

  // 1ª tentativa falhou (falha_provedor ou nao_configurado) — 1 retentativa,
  // não mais que isso: isto não é fila com backoff, é uma chamada síncrona
  // dentro de uma rota HTTP que a advogada está esperando responder.
  const segunda = await encerrarBot(botId);
  if (segunda.situacao === "encerrado" || segunda.situacao === "ja_tinha_saido") {
    return { sucesso: true, situacao: segunda.situacao };
  }

  const detalhe = segunda.situacao === "falha_provedor" ? segunda.detalhe : segunda.situacao;
  registrarErro("copiloto/recall.encerrarBotComRetentativa#falha_definitiva", new Error(`encerrarBot falhou 2x: ${detalhe}`), {
    bot_id: botId,
  });
  return { sucesso: false, detalhe };
}
