import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";
import { aplicarEventoParticipante, resolverPapelNoJoin, normalizarParticipantesBrutos } from "./participantes";
import { extrairDecisoresEsperados } from "./estado";

/**
 * O EFEITO de cada evento do webhook do Recall.ai — Fase 10, Fatia 4b
 * (docs/ARQUITETURA-FASE-10.md §4.2, §6.2.1, §8). Extraído da rota
 * (`src/app/api/webhooks/copiloto/transcricao/route.ts`) pelo mesmo motivo de
 * `encerrar.ts`/`ciclo.ts`: a rota cuida de segurança (assinatura, rate
 * limit, idempotência do livro-razão), este módulo cuida do EFEITO no banco.
 *
 * 🔴 Vínculo pelo `id` do BOT (`gravacao_externa_id`), NUNCA pelo `sessao_id`
 * do corpo (§4.2/§6.2 do plano — encomendado explicitamente pelo Fable).
 * Cada função aqui recebe `botId`, resolve a sessão internamente, e devolve
 * `sessao_nao_encontrada` quando o id não casa com nenhuma linha — nunca
 * confia em qualquer id de sessão que o corpo do webhook possa trazer.
 *
 * `admin` é sempre `service_role`: é o mesmo caminho de escrita que
 * `origem='bot'` já exige na RLS de 0091 (só `service_role` grava `bot`) e
 * é o que a trigger `trg_copiloto_exige_decisao_segmentos_bot` (0093) audita
 * como backstop — o gate jurídico REAL desta fatia já rodou ANTES, no
 * instante de `pedirBot()` (a trigger `trg_copiloto_exige_decisao_bot_pedido`
 * sobre `gravacao_externa_id`, §6.2.2 da errata: "o áudio sai da sala antes
 * de qualquer INSERT nosso" — o gate mora no PEDIDO do bot, não na chegada
 * de cada segmento).
 *
 * 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5 — "o webhook do bot
 * continua entrando — a porta dos fundos"). A trava (a) da Fatia 5
 * (`POST .../copiloto/segmentos` recusando sessão `'encerrado'`/`'erro'`)
 * cobre só o caminho MANUAL. O webhook do bot resolvia a sessão só por
 * `gravacao_externa_id` — que a sessão encerrada MANTÉM — e inseria sem
 * checar nada além disso. CENÁRIO NORMAL, não anômalo: a última fala fica
 * em trânsito entre `marcarEncerrada` e o bot efetivamente sair da sala
 * (`encerrarBotComRetentativa`, chamado DEPOIS de marcar encerrada,
 * `encerrar.ts`) — um evento `transcript.data` chega pelo webhook nesse
 * intervalo e gravava segmento numa sessão já encerrada, órfão da
 * transcrição, alvo do expurgo da Fatia 5 mais cedo ou mais tarde.
 *
 * `resolverSessaoPorBotId` agora traz `transcricao_id` JUNTO (mesma query,
 * sem 2ª ida ao banco) — é o instante EXATO da consolidação
 * (`consolidar.ts`, chamado por `executarEncerramentoCopiloto` ANTES do
 * `UPDATE transcricao_id`): tudo que chega ANTES dele ainda tem chance de
 * entrar na transcrição (mesmo que não tenha entrado, porque a leitura dos
 * segmentos já rodou — mas o corte tem de ser conservador e OBSERVÁVEL, e
 * `transcricao_id` é o único sinal atômico que este módulo consegue ler);
 * DEPOIS dele, o segmento NUNCA mais entra em `transcricoes` — não faz
 * sentido gravá-lo. Usado só por `registrarSegmentoDoBot` (é fala perdida
 * que está em jogo); `registrarEventoParticipante` continua sem essa
 * checagem — presença na sala depois do encerramento não tem o mesmo risco
 * de integridade (não alimenta `transcricoes`, não é expurgada por idade).
 */

interface SessaoPorGravacaoExterna {
  sessao_id: string;
  transcricao_id: string | null;
}

/** Resolve `sessao_id` (+ `transcricao_id`, para o gate de consolidação) a
 * partir do id OPACO do bot — nunca o contrário. */
async function resolverSessaoPorBotId(admin: SupabaseClient, botId: string): Promise<SessaoPorGravacaoExterna | null> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .select("sessao_id, transcricao_id")
    .eq("gravacao_externa_id", botId)
    .maybeSingle<SessaoPorGravacaoExterna>();
  if (error) throw error;
  return data ?? null;
}

interface ErroPostgrest {
  code?: string;
}

/**
 * `transcript.data` → segmento `origem='bot'` (0091-b).
 *
 * 🔴 CORREÇÃO (achados 1 e 2 do Fable, revisão de Solidificação): `ordem`
 * NÃO É MAIS derivada de `start_timestamp`/`Date.now()`. Duas razões
 * medidas, não supostas:
 *
 *   1. **`Date.now()` estoura `int4`.** `ordem` é `int not null` (0091:119,
 *      teto 2.147.483.647). `Date.now()` hoje vale ~1,79 bilhão × 1000 (ms)
 *      — 833× o teto da coluna. TODA inserção pelo fallback falhava com
 *      `22003` (fora de faixa), não `23505` — o código antigo tratava só
 *      `23505` como "já existia" e deixava `22003` LANÇAR, virando 500, e o
 *      Recall reentregando em laço. E o fallback não era borda: dispara
 *      sempre que `transcript` vem preenchido sem `words` — formato que
 *      `extrairTextoTranscript` (route.ts) até PREFERE.
 *   2. **O caminho "primário" (`start_timestamp × 1000`) também não tinha
 *      garantia de caber**: o formato do timestamp (relativo à gravação ou
 *      epoch) NUNCA foi sondado (comentário de topo de `route.ts` admite
 *      isso) — se o Recall mandar epoch em segundos, a MESMA conta de ×1000
 *      estoura `int4` do mesmo jeito.
 *
 * A CORREÇÃO: `ordem` passa a ser `max(ordem)+1` POR SESSÃO — MESMO padrão
 * de `inserirSegmentoComRetentativa` (`segmentos/route.ts`, caminho manual da
 * Fatia 1). Nunca estoura `int4` numa sessão de 90 min (o contador começa em
 * 1 e sobe 1 por segmento). `start_timestamp`/`iniciadoMs` continuam
 * guardados na coluna `iniciado_ms` (dado real do provedor, útil para a
 * tela) — só deixam de ser a fonte de ORDENAÇÃO.
 *
 * 🔴 Colisão em `unique (sessao_id, ordem)` NÃO é mais tratada como
 * "reentrega idêntica, sem efeito" (achado 2 do Fable: essa premissa não
 * tinha lastro num contrato não medido — dois falantes com o mesmo instante,
 * ou parcial/final do mesmo trecho, colidiriam e o SEGUNDO evento, com
 * conteúdo DIFERENTE, seria engolido em silêncio, sem pendência nenhuma). A
 * dedupe REAL já é o livro-razão (`reservarEventoWebhook`, hash do corpo) —
 * chamado pela ROTA antes desta função. Uma colisão de `ordem` aqui dentro é
 * sempre CORRIDA (duas chamadas concorrentes calculando o mesmo `max+1`),
 * nunca reentrega — resolvida por RETENTATIVA (recalcula `max+1`, tenta de
 * novo), com teto de tentativas: esgotado, PROPAGA erro real (nunca finge
 * sucesso).
 */
export type ResultadoSegmentoBot =
  | { situacao: "gravado"; segmentoId: string }
  | { situacao: "sessao_nao_encontrada" }
  /** Texto vazio (silêncio transcrito) — ausência de fala, não erro. Nunca
   * consome uma `ordem` (nenhum INSERT é tentado). */
  | { situacao: "sem_efeito" }
  /** 🔴 CORREÇÃO (achado do coordenador — "a porta dos fundos"). A sessão já
   * tem `transcricao_id` preenchido: já foi consolidada. Este segmento NUNCA
   * entraria em `transcricoes` — gravá-lo criaria fala órfã, alvo do
   * expurgo da Fatia 5 mais cedo ou mais tarde, sem nunca ter sido lida por
   * ninguém. Situação ESPERADA (reentrega tardia do Recall, corrida normal
   * entre `marcarEncerrada` e o bot sair da sala de verdade) — a ROTA
   * devolve 200 sem efeito, NUNCA 500 (o Recall reentregaria em laço). */
  | { situacao: "sessao_ja_consolidada" };

const MAX_TENTATIVAS_ORDEM = 5;

export async function registrarSegmentoDoBot(
  admin: SupabaseClient,
  params: { botId: string; texto: string; falante: string | null; falanteConfianca: number | null; iniciadoMs: number | null },
): Promise<ResultadoSegmentoBot> {
  const sessao = await resolverSessaoPorBotId(admin, params.botId);
  if (!sessao) return { situacao: "sessao_nao_encontrada" };
  // 🔴 Gate de consolidação — ANTES de tocar em qualquer segmento. Ver o
  // comentário de topo do módulo para o cenário completo (webhook tardio).
  if (sessao.transcricao_id !== null) return { situacao: "sessao_ja_consolidada" };
  const sessaoId = sessao.sessao_id;

  const textoLimpo = params.texto.trim();
  if (textoLimpo.length === 0) {
    // `sessoes_copiloto_segmentos.texto` tem CHECK `length(trim(texto)) > 0`
    // (0091) — texto vazio não é erro nosso, é ausência de fala.
    return { situacao: "sem_efeito" };
  }

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_ORDEM; tentativa++) {
    const { data: ultimo, error: erroUltimo } = await admin
      .from("sessoes_copiloto_segmentos")
      .select("ordem")
      .eq("sessao_id", sessaoId)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle<{ ordem: number }>();
    if (erroUltimo) throw erroUltimo;

    const proximaOrdem = (ultimo?.ordem ?? 0) + 1;

    const { data: inserido, error: erroInsercao } = await admin
      .from("sessoes_copiloto_segmentos")
      .insert({
        sessao_id: sessaoId,
        ordem: proximaOrdem,
        texto: textoLimpo,
        falante: params.falante,
        falante_confianca: params.falanteConfianca,
        iniciado_ms: params.iniciadoMs,
        origem: "bot",
      })
      .select("id")
      .single<{ id: string }>();

    if (!erroInsercao && inserido) return { situacao: "gravado", segmentoId: inserido.id };

    if ((erroInsercao as ErroPostgrest | null)?.code === "23505") continue; // corrida: recalcula e tenta de novo
    throw erroInsercao ?? new Error("falha_ao_persistir_segmento_bot");
  }

  throw new Error("falha_ao_persistir_segmento_bot_apos_retentativas");
}

/** `copiloto_sessao.papeis_de_fala` (migration 0103) — interruptor de
 * reversão da Fatia de papéis de fala (15/09/2026). `false` faz o JOIN gravar
 * `papel: null` (mesmo efeito de antes desta fatia — `contexto.ts::rotuloFalante`
 * cai no fallback `"participante"` genérico). Nasce `true` (é correção de
 * cegueira: `PAPEIS_CONHECIDOS` nunca casava com nome próprio, então a IA
 * nunca distinguia ninguém na sala — não é um risco NOVO sendo ligado, é uma
 * lacuna sendo fechada). MESMA regra dura dos outros interruptores do
 * copiloto: falha de leitura NUNCA liga sozinha — cai em `false`. */
const CHAVE_PAPEIS_DE_FALA = "copiloto_sessao.papeis_de_fala";

async function papeisDeFalaEstaoAtivos(admin: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(admin, CHAVE_PAPEIS_DE_FALA, true);
  } catch {
    return false;
  }
}

interface BriefingAtualParaDecisores {
  briefings: Array<{ conteudo: { processo_decisorio?: { decisores?: string[] } }; atual: boolean }>;
}

/** Decisores esperados do briefing ATUAL da sessão — mesma forma de leitura
 * de `montarEstadoCopiloto` (embed `sessoes_viabilidade → jornadas →
 * briefings`), aqui isolada porque este módulo só tem `sessaoId` (não o
 * `jornada_id` direto — `sessoes_copiloto.sessao_id` referencia
 * `sessoes_viabilidade`, não `jornadas`). `[]` em qualquer ausência/erro
 * (nunca lança, nunca impede o registro do participante — decisor_N vira
 * indisponível, mas o join/leave em si sempre grava). */
async function buscarDecisoresEsperadosDaSessao(admin: SupabaseClient, sessaoId: string): Promise<string[]> {
  try {
    const { data, error } = await admin
      .from("sessoes_viabilidade")
      .select("jornadas(briefings(conteudo, atual))")
      .eq("id", sessaoId)
      .maybeSingle<{ jornadas: BriefingAtualParaDecisores | null }>();
    if (error || !data?.jornadas) return [];
    const briefingAtual = data.jornadas.briefings.find((b) => b.atual === true) ?? null;
    return extrairDecisoresEsperados(briefingAtual);
  } catch {
    return [];
  }
}

/**
 * `participant_events.join`/`.leave` → `sessoes_copiloto.participantes`
 * (jsonb, 0091). `aplicarEventoParticipante` (participantes.ts) é PURA —
 * este módulo decide o merge em memória, mas a GRAVAÇÃO passa pela RPC
 * `registrar_participantes_copiloto` (0105), nunca por um `update` direto.
 *
 * 🔴 CORREÇÃO (auditoria pós-entrega, 15/09/2026 — "corrida no registro de
 * participantes"). Antes desta correção, a escrita era ler → aplicar em
 * memória → `update` incondicional: SEM trava entre a leitura e a escrita.
 * O webhook da Recall entrega eventos em RAJADA (medido: 10 joins + 5 leaves
 * numa sessão de teste, vários no mesmo segundo) — dois eventos concorrentes
 * na mesma sessão liam o MESMO array, cada um aplicava seu evento, e o 2º
 * `update` sobrescrevia o 1º por inteiro (participante perdido).
 *
 * A correção é COMPARE-AND-SWAP sob `select ... for update` dentro da RPC
 * (0105, mesmo padrão de `app.resolve_link_escrita`, 0077): o merge continua
 * INTEIRO em TypeScript (`aplicarEventoParticipante`/`resolverPapelNoJoin`,
 * já puras e testadas — não duplicadas em PL/pgSQL); a RPC só tranca a linha,
 * confere se `participantes` ainda é igual ao que este módulo leu e, se não
 * for (outro evento escreveu no meio do caminho), devolve o estado ATUAL sem
 * gravar. `aplicado=false` refaz o merge sobre esse estado novo e tenta de
 * novo — mesmo formato de retentativa que `registrarSegmentoDoBot`, acima
 * neste arquivo, já usa para colisão de `ordem`.
 *
 * 🔴 PAPÉIS DE FALA (15/09/2026) — resolvidos aqui, na ESCRITA, só no `join`
 * (decisão de arquitetura: o papel tem de ser ESTÁVEL na sessão inteira,
 * nunca recalculado na leitura — ver o comentário de topo de
 * `participantes.ts`). `aplicarEventoParticipante` já herda o papel de
 * qualquer entrada anterior da mesma pessoa; `resolverPapelNoJoin` só é
 * chamado para decidir o papel de quem NUNCA apareceu nesta sessão — e só
 * quando o interruptor está ligado (senão passa `papel: undefined`, e
 * `aplicarEventoParticipante` grava `null`, comportamento de antes da fatia).
 * Resolvido FORA do lock, contra a leitura desta tentativa: papel depende de
 * `configuracoes`/briefing (dados estáveis por sessão), não do array de
 * participantes disputado pela corrida — recalculá-lo a cada retentativa do
 * CAS (que só devolve o array atualizado, não reconsulta briefing) manteria
 * a MESMA decisão de papel que a tentativa anterior já tinha tomado para
 * este evento, sem gasto extra de query.
 */
export type ResultadoEventoParticipante = { situacao: "gravado" } | { situacao: "sessao_nao_encontrada" };

interface RespostaCasParticipantes {
  aplicado: boolean;
  participantes: unknown;
}

const MAX_TENTATIVAS_PARTICIPANTES = 5;

export async function registrarEventoParticipante(
  admin: SupabaseClient,
  params: { botId: string; tipo: "join" | "leave"; nomeParticipante: string | null; idParticipante: string | null; isHost: boolean; quando: string },
): Promise<ResultadoEventoParticipante> {
  const sessao = await resolverSessaoPorBotId(admin, params.botId);
  if (!sessao) return { situacao: "sessao_nao_encontrada" };
  const sessaoId = sessao.sessao_id;

  const { data: existente, error: erroLeitura } = await admin
    .from("sessoes_copiloto")
    .select("participantes")
    .eq("sessao_id", sessaoId)
    .maybeSingle<{ participantes: unknown }>();
  if (erroLeitura) throw erroLeitura;

  let participantesEsperados = (existente?.participantes ?? []) as unknown;

  // Papel resolvido UMA vez, contra a 1ª leitura — ver o comentário de topo
  // sobre por que não precisa ser recalculado a cada retentativa do CAS.
  let papelParaJoin: ReturnType<typeof resolverPapelNoJoin> | undefined;
  if (params.tipo === "join" && (await papeisDeFalaEstaoAtivos(admin))) {
    const decisoresEsperados = await buscarDecisoresEsperadosDaSessao(admin, sessaoId);
    papelParaJoin = resolverPapelNoJoin({
      nome: params.nomeParticipante,
      isHost: params.isHost,
      decisoresEsperados,
      participantesAtuais: normalizarParticipantesBrutos(participantesEsperados),
    });
  }

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_PARTICIPANTES; tentativa++) {
    const novaLista = aplicarEventoParticipante(participantesEsperados, {
      tipo: params.tipo,
      nome: params.nomeParticipante,
      id: params.idParticipante,
      quando: params.quando,
      papel: papelParaJoin,
    });

    // `returns table` — mesmo padrão de `casar_pessoa_por_telefone`
    // (porteiro.ts): `data` chega como ARRAY, nunca `.single()`.
    const { data, error: erroCas } = await admin.rpc("registrar_participantes_copiloto", {
      p_sessao_id: sessaoId,
      p_participantes_esperados: participantesEsperados,
      p_participantes_novos: novaLista,
    });
    if (erroCas) throw erroCas;
    if (!Array.isArray(data) || data.length === 0) throw new Error("falha_ao_persistir_participante_cas_sem_resposta");
    const resultadoCas = data[0] as RespostaCasParticipantes;

    if (resultadoCas.aplicado) return { situacao: "gravado" };

    // CAS perdeu: outro evento concorrente escreveu entre a leitura e agora.
    // Reaplica ESTE mesmo evento sobre o estado que a RPC acabou de devolver
    // e tenta de novo — nunca perde o evento, nunca sobrescreve o do outro.
    participantesEsperados = resultadoCas.participantes;
  }

  throw new Error("falha_ao_persistir_participante_apos_retentativas");
}

/**
 * Tipo de evento desconhecido — §4.2/§8: "200 sem efeito + pendência", NUNCA
 * 500 (o Recall reentregaria em laço). A pendência fica no `erro` da própria
 * linha de `webhooks_eventos` (a ROTA grava lá, no corpo do handler — este
 * módulo só registra o SINAL para quem olhar o log do servidor). Nunca chama
 * `registrarErro`/`erros_servidor`: um evento novo do fornecedor não é uma
 * FALHA nossa, é o contrato mudando — mesma distinção que `encerrarBot` faz
 * para o 400 `bot_command_error` (estado esperado, não incidente).
 */
export function logarTipoDesconhecido(tipo: string, botId: string): void {
  console.warn(
    JSON.stringify({
      nivel: "warn",
      contexto: "webhooks/copiloto#tipo_evento_desconhecido",
      tipo_evento: tipo,
      bot_id: botId,
      ocorrido_em: new Date().toISOString(),
    }),
  );
}
