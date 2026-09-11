import type { SupabaseClient } from "@supabase/supabase-js";
import { aplicarEventoParticipante } from "./participantes";

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
 */

interface SessaoPorGravacaoExterna {
  sessao_id: string;
}

/** Resolve `sessao_id` a partir do id OPACO do bot — nunca o contrário. */
async function resolverSessaoPorBotId(admin: SupabaseClient, botId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .select("sessao_id")
    .eq("gravacao_externa_id", botId)
    .maybeSingle<SessaoPorGravacaoExterna>();
  if (error) throw error;
  return data?.sessao_id ?? null;
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
  | { situacao: "sem_efeito" };

const MAX_TENTATIVAS_ORDEM = 5;

export async function registrarSegmentoDoBot(
  admin: SupabaseClient,
  params: { botId: string; texto: string; falante: string | null; falanteConfianca: number | null; iniciadoMs: number | null },
): Promise<ResultadoSegmentoBot> {
  const sessaoId = await resolverSessaoPorBotId(admin, params.botId);
  if (!sessaoId) return { situacao: "sessao_nao_encontrada" };

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

/**
 * `participant_events.join`/`.leave` → `sessoes_copiloto.participantes`
 * (jsonb, 0091). `aplicarEventoParticipante` (participantes.ts) é PURA —
 * este módulo faz a leitura-aplica-grava, com o mesmo cuidado de
 * `ativarSessaoCopiloto` (segmentos/route.ts): erro de leitura/escrita
 * PROPAGA (nunca upsert cego silencioso).
 */
export type ResultadoEventoParticipante = { situacao: "gravado" } | { situacao: "sessao_nao_encontrada" };

export async function registrarEventoParticipante(
  admin: SupabaseClient,
  params: { botId: string; tipo: "join" | "leave"; nomeParticipante: string; quando: string },
): Promise<ResultadoEventoParticipante> {
  const sessaoId = await resolverSessaoPorBotId(admin, params.botId);
  if (!sessaoId) return { situacao: "sessao_nao_encontrada" };

  const { data: existente, error: erroLeitura } = await admin
    .from("sessoes_copiloto")
    .select("participantes")
    .eq("sessao_id", sessaoId)
    .maybeSingle<{ participantes: unknown }>();
  if (erroLeitura) throw erroLeitura;

  const novaLista = aplicarEventoParticipante(existente?.participantes ?? [], {
    tipo: params.tipo,
    nome: params.nomeParticipante,
    quando: params.quando,
  });

  const { error: erroEscrita } = await admin.from("sessoes_copiloto").update({ participantes: novaLista }).eq("sessao_id", sessaoId);
  if (erroEscrita) throw erroEscrita;

  return { situacao: "gravado" };
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
