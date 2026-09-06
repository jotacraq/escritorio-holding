import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroApi, registrarErro } from "@/server/erros";
import { CABECALHO_ASSINATURA, CABECALHO_TIMESTAMP, verificarAssinatura } from "@/server/integracoes/assinatura";
import { registrarTentativaInvalida, reservarEventoWebhook } from "@/server/integracoes/livro-razao";
import { criarLimitador, ipDaRequisicao } from "@/server/integracoes/rate-limit";
import { aplicarResultado } from "@/server/ligacao-ia";
import type { PayloadLigacaoIaEntrada } from "@/types/integracoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGEM = "n8n_ligacao";
const LIMITE_CORPO_BYTES = 1_000_000;
/** Tentativa NÃO autenticada só rende este tanto de corpo no livro-razão (I3). */
const LIMITE_BRUTO_INVALIDO = 2_000;

/**
 * Rate limit em DUAS chaves (achado A1 do pentest, 06/09/2026).
 *
 * O limite era 60/min por IP. Só que TODO callback legítimo chega do MESMO IP
 * (a VPS do n8n): quem forjasse 60 requisições por minuto contra este endereço
 * consumia a cota do n8n e punha os callbacks de verdade em 429 — o
 * `retryOnFail` do nó HTTP esgota e o agendamento que o cliente acabou de dar
 * ao telefone se perde. Limitar o remetente conhecido a 60 era proteger o
 * atacante.
 *
 * Agora:
 *  - por IP, teto ALTO (600/min) — continua contendo inundação bruta, mas não é
 *    mais alcançável por um forjador de volume moderado;
 *  - por `ligacao_id`, teto BAIXO (20/min) — uma ligação real gera 3 ou 4
 *    eventos (`discando`, `em_ligacao`, `end-of-call-report` e algum retry).
 *    20 já é folgado, e é o limite que de fato importa: martelar a máquina de
 *    estados de UMA ligação exige conhecer o UUID dela.
 * Corpo sem `ligacao_id` legível cai na chave `ip:sem-id`, que é a mais apertada.
 */
const limitePorIp = criarLimitador(600);
const limitePorLigacao = criarLimitador(20);

const EventoEnum = z.enum(["discando", "em_ligacao", "concluida", "sem_resposta", "falhou"]);
const ResultadoEnum = z.enum(["recusou", "pediu_retorno", "caixa_postal", "numero_invalido"]);

const CorpoSchema = z
  .object({
    id_evento: z.string().trim().min(1).max(200),
    ligacao_id: z.string().uuid(),
    evento: EventoEnum.optional(),
    estado: EventoEnum.optional(),
    id_externo: z.string().trim().max(200).nullable().optional(),
    horario_escolhido: z.string().datetime({ offset: true }).nullable().optional(),
    resultado: ResultadoEnum.nullable().optional(),
    transcricao: z.string().max(200_000).nullable().optional(),
    resumo: z.string().max(4000).nullable().optional(),
    gravacao_url: z.string().url().max(2000).nullable().optional(),
    custo_usd: z.number().min(0).max(1000).nullable().optional(),
    duracao_s: z.number().int().min(0).max(86_400).nullable().optional(),
    duracao_segundos: z.number().int().min(0).max(86_400).nullable().optional(),
    motivo_falha: z.string().max(500).nullable().optional(),
  })
  .refine((c) => c.evento || c.estado, { message: "evento (ou estado) é obrigatório" });

/**
 * POST /api/webhooks/n8n/ligacao — retorno do n8n (WEBHOOK Vapi → VPS, padrão
 * RSVP) sobre uma ligação por IA. Contrato em docs/integracoes/n8n-ligacao-ia.md.
 *
 * Ordem obrigatória (§2.4, mesma classe do Hotmart): rate limit por IP →
 * tamanho → fail-CLOSED sem segredo (503) → rate limit por `ligacao_id` →
 * janela de tempo + HMAC em tempo constante
 * (401 e REGISTRA a tentativa) → Zod → livro-razão `webhooks_eventos`
 * (idempotente por id_evento; tentativa inválida NÃO ocupa o id — a entrega
 * válida substitui e processa, `server/integracoes/livro-razao.ts`) →
 * máquina de estados → 500 em erro real (o n8n reentrega; a idempotência protege).
 */
export async function POST(request: NextRequest) {
  const ip = ipDaRequisicao(request.headers);
  if (limitePorIp(ip)) {
    return NextResponse.json({ erro: "rate_limited" }, { status: 429 });
  }
  if (Number(request.headers.get("content-length") ?? "0") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  const segredo = process.env.LIGACAO_IA_WEBHOOK_SECRET?.trim();
  if (!segredo) {
    registrarErro("POST /api/webhooks/n8n/ligacao", new Error("LIGACAO_IA_WEBHOOK_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const corpoTexto = await request.text();
  if (Buffer.byteLength(corpoTexto, "utf8") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  let bruto: unknown = null;
  try {
    bruto = corpoTexto ? JSON.parse(corpoTexto) : null;
  } catch {
    bruto = null;
  }
  const brutoObj = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;

  // Segunda chave do limite: a ligação. Antes de qualquer trabalho de banco, e
  // sem confiar no corpo — `ligacao_id` aqui é só material de chave, não dado.
  const chaveLigacao = typeof brutoObj.ligacao_id === "string" && brutoObj.ligacao_id.length <= 64 ? brutoObj.ligacao_id : `${ip}:sem-id`;
  if (limitePorLigacao(chaveLigacao)) {
    return NextResponse.json({ erro: "rate_limited" }, { status: 429 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("POST /api/webhooks/n8n/ligacao#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const verificacao = verificarAssinatura({
    segredo,
    timestamp: request.headers.get(CABECALHO_TIMESTAMP),
    assinatura: request.headers.get(CABECALHO_ASSINATURA),
    corpo: corpoTexto,
  });

  if (!verificacao.valida) {
    // Tentativa inválida é sinal de segurança: fica registrada, sem processar e
    // sem sobrescrever (nem "ocupar") o id de um evento válido.
    const idEvento = typeof brutoObj.id_evento === "string" && brutoObj.id_evento ? brutoObj.id_evento.slice(0, 200) : `invalida:${randomUUID()}`;
    // I3 do pentest: só o TEXTO do corpo, cortado em 2 000 — nunca o objeto
    // inteiro. O corpo de uma tentativa NÃO AUTENTICADA é escolhido pelo
    // remetente: guardar até 1 MB dele por requisição faz de `webhooks_eventos`
    // um depósito grátis (e enche a tabela que a equipe usa para diagnosticar).
    // 2 000 caracteres bastam para ver quem tentou o quê.
    await registrarTentativaInvalida(supabaseAdmin, {
      origem: ORIGEM,
      idEvento,
      tipoEvento: typeof brutoObj.evento === "string" ? brutoObj.evento.slice(0, 100) : null,
      bruto: {
        motivo: verificacao.motivo,
        corpo: corpoTexto.slice(0, LIMITE_BRUTO_INVALIDO),
        truncado: corpoTexto.length > LIMITE_BRUTO_INVALIDO,
      },
      erro: verificacao.motivo,
      encerrar: true,
    });
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (bruto === null) {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }
  const parse = CorpoSchema.safeParse(bruto);
  if (!parse.success) {
    return NextResponse.json({ erro: "validacao_invalida", detalhes: parse.error.issues }, { status: 422 });
  }
  const evento = parse.data as PayloadLigacaoIaEntrada;
  const tipoEvento = evento.evento ?? evento.estado ?? null;

  // Livro-razão primeiro (mesma reserva do Hotmart e da n8n/sala). Reentrega de
  // evento já processado → 200 sem efeito; existente e NÃO processado (falhou
  // antes) → reprocessa (§1.5); id ocupado por tentativa inválida → a válida manda.
  const reserva = await reservarEventoWebhook(supabaseAdmin, {
    origem: ORIGEM,
    idEvento: evento.id_evento,
    tipoEvento,
    bruto,
  });
  if (reserva.tipo === "erro") {
    registrarErro(`POST /api/webhooks/n8n/ligacao#${reserva.etapa}`, reserva.erro);
    return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
  }
  if (reserva.tipo === "ja_processado") {
    return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
  }
  const webhookEventoId = reserva.id;

  try {
    const resultado = await aplicarResultado(supabaseAdmin, evento);
    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ processado_em: new Date().toISOString(), erro: resultado.erro ?? resultado.ignorado ?? null })
      .eq("id", webhookEventoId);

    if (resultado.erro) {
      // Horário fora dos ofertados / núcleo recusou: registrado, ligação já
      // encerrada como `falhou` com fallback. 422 para o n8n NÃO reentregar.
      return NextResponse.json({ recebido: true, erro: resultado.erro, ligacao: resultado }, { status: 422 });
    }
    return NextResponse.json({ recebido: true, ligacao: resultado }, { status: 200 });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status < 500) {
      // 404 ligação inexistente / 422 evento inválido: não é falha transitória — marca processado com o motivo.
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ processado_em: new Date().toISOString(), erro: erro.codigo })
        .eq("id", webhookEventoId);
      return NextResponse.json({ erro: erro.codigo }, { status: erro.status });
    }
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    registrarErro("POST /api/webhooks/n8n/ligacao#processar", erro, { webhook_evento_id: webhookEventoId, ligacao_id: evento.ligacao_id });
    await supabaseAdmin.from("webhooks_eventos").update({ erro: mensagem.slice(0, 1000) }).eq("id", webhookEventoId);
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }
}
