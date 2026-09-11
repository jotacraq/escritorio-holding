import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { registrarTentativaInvalida, reservarEventoWebhook } from "@/server/integracoes/livro-razao";
import { criarLimitador, ipDaRequisicao } from "@/server/integracoes/rate-limit";
import { registrarSegmentoDoBot, registrarEventoParticipante, logarTipoDesconhecido } from "@/server/copiloto/entrada-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGEM = "recall";
const LIMITE_CORPO_BYTES = 1_000_000;
const limitePorIp = criarLimitador(120);

/**
 * POST /api/webhooks/copiloto/transcricao — Fase 10, Fatia 4b
 * (docs/ARQUITETURA-FASE-10.md §4.2, §6.2, §6.2.1, §6.2.2, §8, §12).
 *
 * 🔒 MECANISMO DE SEGREDO — diferente dos webhooks n8n desta casa, e a
 * decisão pedida explicitamente pelo coordenador nesta revisão: "confirme se
 * a doc do Recall oferece assinatura de webhook ou header customizado; se
 * não oferecer, documente por que o query param foi escolhido, o que ele
 * expõe, e o que muda se o fornecedor passar a assinar".
 *
 * CONFERIDO (docs.recall.ai, revisão desta correção — não é mais lacuna não
 * sondada, é documentação lida): o schema de `realtime_endpoints[]` do
 * `POST /bot/` aceita SÓ `type`, `url`, `events`, `metadata` — **não existe
 * campo de `headers` customizados neste tipo de endpoint**. O Recall TEM um
 * mecanismo de assinatura Svix, mas é de OUTRO webhook — o de nível de
 * CONTA, configurado no dashboard, que cobre só `status_changes` de
 * lifecycle do bot (`bot.joining_call`, `bot.done`, etc.), NÃO
 * `transcript.data`/`participant_events`. Ou seja: para o endpoint que esta
 * rota implementa, não existe header nem HMAC disponível — a escolha não é
 * "HMAC vs query param", é "query param vs nada".
 *
 * O QUE O QUERY PARAM EXPÕE, por escrito, sem esconder o custo (pedido
 * explícito do coordenador): o segredo pode aparecer em log de acesso do
 * proxy (nosso e do Recall), em log de erro de qualquer intermediário HTTP,
 * e em qualquer ferramenta de observabilidade que capture a URL completa da
 * requisição — de um jeito que um header não vaza (headers comuns não são
 * logados por padrão pela maioria dos proxies/CDNs; query string, sim). Este
 * webhook carrega TRANSCRIÇÃO LITERAL DE CONVERSA PATRIMONIAL FAMILIAR — o
 * risco é real, não teórico, e por isso: (a) `COPILOTO_WEBHOOK_SECRET` é um
 * valor de USO ÚNICO para este webhook (nunca reaproveitar
 * `INTEGRACOES_WEBHOOK_SECRET` nem qualquer outro segredo da casa — um
 * vazamento aqui não deve comprometer outro canal); (b) a idempotência por
 * `reservarEventoWebhook` e a resolução por `gravacao_externa_id` (nunca
 * `sessao_id` do corpo) continuam sendo a 2ª camada — mesmo que o `k=`
 * vazasse, quem o capturasse ainda precisaria adivinhar um `gravacao_externa_id`
 * de bot válido para injetar fala em sessão real; (c) rotação do secret é
 * operação manual em Admin → Integrações (mesma mecânica dos outros
 * segredos) — se um vazamento for suspeitado, trocar a env e reconfigurar o
 * próximo bot fecha a janela (bots já em curso continuam com a URL antiga
 * até `encerrarBot`, que é aceitável porque o raio de exposição é por
 * SESSÃO, não por todas as sessões futuras).
 *
 * A CAMADA (b) — MEDIDA, não suposta (achado do pentester nesta revisão:
 * "enumeração de bot.id é suposição não verificada" — correto cobrar prova).
 * Medido em 11/09/2026: o `id` que o `POST /bot/` devolveu na sonda real foi
 * `bca7fe62-fb86-4ad6-be5f-54d5cbf011d7` — UUID v4 canônico, 36 caracteres,
 * 122 bits de entropia. Enumerar isso a 120 req/min (o teto desta rota) é
 * inviável por ordens de magnitude (~14.400 tentativas em 2h contra um
 * espaço de 2^122) — a mitigação da camada (b) se sustenta. Segundo fator
 * (`metadata` em `realtime_endpoints[]`) avaliado e DESCARTADO: com UUID v4
 * o custo/benefício não fecha, e seria usar um campo cujo comportamento a
 * sonda não cobriu. Se o Recall mudar o formato do `id` (ex.: passar a usar
 * inteiro sequencial), esta mitigação cai junto — reavaliar nesse caso, não
 * antes.
 *
 * O QUE MUDA SE O FORNECEDOR PASSAR A ASSINAR: se o Recall introduzir
 * `headers` customizados ou HMAC neste tipo de endpoint no futuro, a
 * verificação se soma a esta (defesa em profundidade) — não a substitui
 * automaticamente sem sonda nova, porque não temos como confirmar hoje que
 * o mecanismo cobriria os TRÊS eventos que esta rota usa.
 *
 * PENTESTER OBRIGATÓRIO NESTA FATIA (§12 do plano) — este é exatamente o
 * tipo de achado que a auditoria adversarial deve tentar explorar: URL do
 * webhook aparecendo em log de terceiro, replay do `k=` capturado, etc.
 * PENTEST FECHADO em 11/09/2026: nenhum achado crítico/alto explorável;
 * vínculo por `gravacao_externa_id` sem IDOR (regressão com `sessao_id`
 * malicioso injetado no corpo, ignorado), gate nos três caminhos, RLS com
 * `force` nas 4 tabelas, segredo nunca vaza em log/erro/tela, `retention`
 * conferido pós-criação. O MÉDIO (enumeração de `bot.id`) foi dissolvido
 * pela medição registrada acima. Achado que fica de pé para a FATIA 5: cada
 * tentativa com `k=` válido e `bot.id` inexistente grava uma linha em
 * `webhooks_eventos` (`bot_sem_sessao_vinculada`) — com UUID v4 não é vetor
 * de ataque, mas É caminho de acúmulo; o expurgo da Fatia 5 precisa
 * considerar `webhooks_eventos`, não só `sessoes_copiloto_segmentos`.
 *
 * Contrato de segurança, mesmo nível dos outros 4 webhooks da casa:
 *   1. sem `COPILOTO_WEBHOOK_SECRET` → 503 fail-closed (nunca aceita);
 *   2. `?k=` da query string comparado em tempo constante → 401 se não bater
 *      (tentativa registrada no livro-razão, sinal de segurança);
 *   3. Zod, limite de corpo, rate limit por IP;
 *   4. idempotente por (origem='recall', id_evento) via `reservarEventoWebhook`;
 *   5. grava por `service_role` (`criarClienteAdmin`), nunca RLS de sessão.
 *
 * 🔴 VÍNCULO: pelo `id` do BOT (`gravacao_externa_id`), NUNCA por `sessao_id`
 * do corpo — encomendado explicitamente pelo Fable (§4.2/§6.2). Quem tivesse
 * o segredo do webhook (se o mecanismo acima falhasse) ainda não poderia
 * injetar fala em sessão alheia adivinhando um UUID de sessão: o servidor
 * RESOLVE a sessão a partir do id opaco que ELE MESMO gerou ao pedir o bot
 * (`entrada-bot.ts::resolverSessaoPorBotId`), nunca confia no corpo para isso.
 *
 * 🔴 TIPO DESCONHECIDO → 200 sem efeito + log (nunca 500 — o Recall
 * reentregaria em laço). NUNCA `registrarErro`/`erros_servidor` para isto:
 * o fornecedor pode acrescentar evento novo sem avisar, e isso não é uma
 * falha nossa.
 *
 * ⚠️ FORMATO INTERNO DE `transcript.data`/`participant_events.*` — a sonda de
 * 11/09 mediu a CRIAÇÃO do bot (`POST /bot/`), não o formato de cada evento
 * de webhook em si (§4.2 do plano é explícito: só a criação foi sondada). O
 * schema abaixo segue o formato público estável do Recall.ai (envelope
 * `{event, data: {bot: {id}, data: {...}}}`), mas a EXTRAÇÃO é defensiva —
 * campo ausente ou de tipo inesperado nunca lança, vira `payload_invalido`
 * (422) sem tocar o banco. `A MEDIR`: confirmar o formato exato contra um
 * evento real na primeira sessão de bancada com sala de teste.
 */

const CorpoBaseSchema = z.object({
  event: z.string().trim().min(1).max(100),
  data: z.object({ bot: z.object({ id: z.string().trim().min(1).max(200) }) }).passthrough(),
});

const TranscriptDataSchema = z.object({
  event: z.literal("transcript.data"),
  data: z.object({
    bot: z.object({ id: z.string().trim().min(1).max(200) }),
    data: z.object({
      words: z
        .array(z.object({ text: z.string(), start_timestamp: z.union([z.number(), z.object({ relative: z.number() })]).optional() }))
        .optional(),
      transcript: z.string().optional(),
      participant: z.object({ name: z.string().trim().max(300).optional(), is_host: z.boolean().optional() }).nullable().optional(),
    }),
  }),
});

const ParticipantEventSchema = z.object({
  event: z.union([z.literal("participant_events.join"), z.literal("participant_events.leave")]),
  data: z.object({
    bot: z.object({ id: z.string().trim().min(1).max(200) }),
    data: z.object({
      participant: z.object({ name: z.string().trim().max(300) }),
      timestamp: z.union([z.string(), z.number()]).optional(),
    }),
  }),
});

/** Id de evento determinístico para a linha do livro-razão — a Recall não
 * documentou (nesta sonda) um id de evento nativo por chamada de webhook.
 * Hash do conteúdo relevante: reentrega EXATA do mesmo payload cai no mesmo
 * id (idempotente); um evento realmente novo (texto/participante diferente,
 * ou timestamp diferente) gera outro id, nunca é descartado por engano. */
function idEventoDeterministico(botId: string, tipo: string, corpoTexto: string): string {
  const hash = crypto.createHash("sha256").update(corpoTexto, "utf8").digest("hex").slice(0, 32);
  return `${botId}:${tipo}:${hash}`;
}

function extrairTextoTranscript(corpo: z.infer<typeof TranscriptDataSchema>): string {
  if (corpo.data.data.transcript) return corpo.data.data.transcript;
  if (corpo.data.data.words && corpo.data.data.words.length > 0) {
    return corpo.data.data.words.map((w) => w.text).join(" ");
  }
  return "";
}

export async function POST(request: NextRequest) {
  const ip = ipDaRequisicao(request.headers);
  if (limitePorIp(ip)) return NextResponse.json({ erro: "rate_limited" }, { status: 429 });

  const tamanhoDeclarado = Number(request.headers.get("content-length") ?? "0");
  if (tamanhoDeclarado > LIMITE_CORPO_BYTES) return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });

  // Passo 1 — fail-CLOSED: sem secret configurado, recusa, nunca aceita.
  const segredo = process.env.COPILOTO_WEBHOOK_SECRET?.trim();
  if (!segredo) {
    registrarErro("POST /api/webhooks/copiloto/transcricao", new Error("COPILOTO_WEBHOOK_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("POST /api/webhooks/copiloto/transcricao#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const corpoTexto = await request.text();
  if (Buffer.byteLength(corpoTexto, "utf8") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  // Passo 2 — segredo na query string, tempo constante.
  const chaveRecebida = new URL(request.url).searchParams.get("k") ?? "";
  const bufA = Buffer.from(chaveRecebida);
  const bufB = Buffer.from(segredo);
  const assinaturaValida = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  let bruto: unknown;
  try {
    bruto = JSON.parse(corpoTexto || "{}");
  } catch {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }

  const baseParse = CorpoBaseSchema.safeParse(bruto);
  const botIdBruto = baseParse.success ? baseParse.data.data.bot.id : null;
  const tipoEventoBruto = baseParse.success ? baseParse.data.event : null;

  if (!assinaturaValida) {
    await registrarTentativaInvalida(supabaseAdmin, {
      origem: ORIGEM,
      idEvento: botIdBruto ? `invalido:${botIdBruto}:${Date.now()}` : `invalido:${Date.now()}:${ip}`,
      tipoEvento: tipoEventoBruto,
      bruto: typeof bruto === "object" && bruto !== null ? bruto : { bruto },
      erro: "chave_invalida",
    });
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (!baseParse.success || !botIdBruto || !tipoEventoBruto) {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }

  const idEvento = idEventoDeterministico(botIdBruto, tipoEventoBruto, corpoTexto);

  const reserva = await reservarEventoWebhook(supabaseAdmin, {
    origem: ORIGEM,
    idEvento,
    tipoEvento: tipoEventoBruto,
    bruto,
  });
  if (reserva.tipo === "erro") {
    registrarErro(`POST /api/webhooks/copiloto/transcricao#${reserva.etapa}`, reserva.erro, { bot_id: botIdBruto });
    return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
  }
  if (reserva.tipo === "ja_processado") {
    return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
  }
  const { id: webhookEventoId, reentrega } = reserva;

  try {
    const resultado = await processarEvento(supabaseAdmin, tipoEventoBruto, bruto, botIdBruto);

    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ erro: resultado.erroParaAuditoria, processado_em: new Date().toISOString() })
      .eq("id", webhookEventoId);

    return NextResponse.json({ recebido: true, reentrega, ...resultado.corpoExtra }, { status: 200 });
  } catch (erro) {
    // Erro de INFRAESTRUTURA (banco fora do ar, etc) — 500 para o Recall
    // reentregar; o livro-razão (idempotência) protege contra duplicar.
    registrarErro("POST /api/webhooks/copiloto/transcricao#processar", erro, { webhook_evento_id: webhookEventoId, bot_id: botIdBruto });
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }
}

interface ResultadoProcessamento {
  erroParaAuditoria: string | null;
  corpoExtra: Record<string, unknown>;
}

/**
 * Roteia por `type`. TUDO aqui devolve 200 (a rota já decidiu isso antes de
 * chamar): a função só decide o que fica registrado em `webhooks_eventos.erro`
 * — nunca lança para virar 500 por um caso de negócio esperado.
 *
 * 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5 — 7ª ocorrência
 * catalogada nesta fase de "algo afirma o que o código não entrega"). Este
 * comentário dizia que `erro` alimentava `vw_pendencias_sistema` — FALSO.
 * A rota (linha ~251) carimba `processado_em` SEMPRE, sucesso ou erro de
 * negócio; a cláusula `webhook_falho` da view (0089:227) só mostra linha
 * com `processado_em IS NULL`. Ou seja: NENHUM valor gravado aqui em
 * `erro` chega à tela — nem `bot_sem_sessao_vinculada`, nem
 * `payload_invalido`, nem `tipo_evento_desconhecido`.
 *
 * ISSO É DELIBERADO, não uma lacuna a fechar: os três casos que esta função
 * classifica como "erro" são RUÍDO DE FORNECEDOR, não tarefa para a Dra.
 * Elaine —
 *   - `bot_sem_sessao_vinculada`: reentrega tardia depois do bot encerrar,
 *     corrida entre `POST /bot/` e o primeiro webhook, ou tentativa com
 *     `bot.id` que nunca existiu (UUID v4, não é vetor de ataque — medido
 *     no comentário de topo deste arquivo). Nenhuma ação da advogada
 *     resolve isso; a linha é ruído esperado, não uma pendência dela.
 *   - `payload_*_fora_do_formato_esperado`: o formato de evento do Recall
 *     mudou ou veio incompleto — é debug de INTEGRAÇÃO (nosso ou do
 *     fornecedor), não operação do escritório.
 *   - `tipo_evento_desconhecido`: o fornecedor pode acrescentar evento novo
 *     sem avisar (comentário de topo do arquivo) — não é uma falha.
 *
 * `erro` fica gravado em `webhooks_eventos.erro` para AUDITORIA E
 * DIAGNÓSTICO (alguém investigando um caso específico consegue ler o
 * motivo), nunca para virar pendência de tela.
 *
 * ⚠️ CONFERIDO CONTRA `n8n/sala` (não supor por analogia — foi checado
 * linha a linha nesta correção): aquela rota TAMBÉM marca `processado_em`
 * para `sessao_nao_encontrada` (`n8n/sala/route.ts:131`,
 * `sessaoNaoEncontrada ? new Date().toISOString() : null`) — ou seja, é o
 * MESMO padrão desta rota, não um contraste. `sessao_nao_encontrada` do
 * n8n/sala TAMBÉM nunca aparece em `vw_pendencias_sistema`. Isto não é
 * escopo desta fatia para corrigir (fora da fronteira de arquivo, §12 do
 * plano), mas fica registrado aqui para não repetir a comparação errada
 * que este comentário tinha antes desta correção: nenhuma suposição sobre
 * OUTRO webhook entra num comentário sem ler o código dele primeiro.
 *
 * Ver `docs/ARQUITETURA-FASE-10.md` §8 Fatia 5 e a nota de pendência sobre
 * `webhooks_eventos`/B42 no mesmo documento — se linhas como esta
 * devessem virar pendência visível (aqui ou em `n8n/sala`), quem decide é
 * a Dra. Elaine (B42), não este módulo por conta própria.
 */
async function processarEvento(
  admin: ReturnType<typeof criarClienteAdmin>,
  tipo: string,
  bruto: unknown,
  botId: string,
): Promise<ResultadoProcessamento> {
  if (tipo === "transcript.data") {
    const parse = TranscriptDataSchema.safeParse(bruto);
    if (!parse.success) {
      return { erroParaAuditoria: "payload_transcript_data_fora_do_formato_esperado", corpoExtra: { payload_invalido: true } };
    }
    const texto = extrairTextoTranscript(parse.data);
    if (!texto.trim()) return { erroParaAuditoria: null, corpoExtra: {} }; // silêncio transcrito vazio — sem efeito, sem pendência

    const inicioMs = (() => {
      const primeiro = parse.data.data.data.words?.[0]?.start_timestamp;
      if (typeof primeiro === "number") return Math.round(primeiro * 1000);
      if (primeiro && typeof primeiro === "object" && typeof primeiro.relative === "number") return Math.round(primeiro.relative * 1000);
      return null;
    })();

    // 🔴 CORREÇÃO (achados 1 e 2 do Fable): `ordem` NÃO É MAIS calculada
    // aqui — `registrarSegmentoDoBot` (entrada-bot.ts) resolve por
    // `max(ordem)+1` da sessão, com retentativa em corrida. Ver o comentário
    // de topo daquele módulo para a medição completa (Date.now() estourava
    // int4 por 833×; o caminho "primário" via start_timestamp também não
    // tinha garantia de caber, formato nunca sondado). `iniciadoMs` continua
    // guardado na coluna `iniciado_ms` — só deixou de ser fonte de ordenação.
    const resultado = await registrarSegmentoDoBot(admin, {
      botId,
      texto,
      falante: parse.data.data.data.participant?.name ?? null,
      falanteConfianca: null,
      iniciadoMs: inicioMs,
    });

    if (resultado.situacao === "sessao_nao_encontrada") {
      return { erroParaAuditoria: "bot_sem_sessao_vinculada", corpoExtra: { sessao_nao_encontrada: true } };
    }
    // 🔴 CORREÇÃO (achado do coordenador — "a porta dos fundos"). A sessão
    // já foi consolidada (transcricao_id preenchido) — cenário ESPERADO
    // (reentrega tardia, última fala em trânsito entre marcarEncerrada e o
    // bot sair da sala de verdade). 200 + registro LEVE, NUNCA 500 (o
    // Recall reentregaria em laço por um evento que nunca vai virar erro).
    if (resultado.situacao === "sessao_ja_consolidada") {
      return { erroParaAuditoria: "segmento_apos_consolidacao", corpoExtra: { sessao_ja_consolidada: true } };
    }
    return { erroParaAuditoria: null, corpoExtra: {} };
  }

  if (tipo === "participant_events.join" || tipo === "participant_events.leave") {
    const parse = ParticipantEventSchema.safeParse(bruto);
    if (!parse.success) {
      return { erroParaAuditoria: "payload_participant_event_fora_do_formato_esperado", corpoExtra: { payload_invalido: true } };
    }
    const quando = (() => {
      const ts = parse.data.data.data.timestamp;
      if (typeof ts === "string") return ts;
      if (typeof ts === "number") return new Date(ts).toISOString();
      return new Date().toISOString();
    })();

    const resultado = await registrarEventoParticipante(admin, {
      botId,
      tipo: tipo === "participant_events.join" ? "join" : "leave",
      nomeParticipante: parse.data.data.data.participant.name,
      quando,
    });

    if (resultado.situacao === "sessao_nao_encontrada") {
      return { erroParaAuditoria: "bot_sem_sessao_vinculada", corpoExtra: { sessao_nao_encontrada: true } };
    }
    return { erroParaAuditoria: null, corpoExtra: {} };
  }

  // 🔴 Tipo desconhecido — §4.2/§8: 200 sem efeito + log, NUNCA 500.
  logarTipoDesconhecido(tipo, botId);
  return { erroParaAuditoria: `tipo_evento_desconhecido:${tipo}`, corpoExtra: { evento_desconhecido: true } };
}
