import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { registrarTentativaInvalida, reservarEventoWebhook } from "@/server/integracoes/livro-razao";
import { verificarAssinatura } from "@/server/sala/assinatura";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_CORPO_BYTES = 1_000_000;
const LIMITE_REQUISICOES_POR_MINUTO = 60;
const ORIGEM = "n8n_sala";

const contadorPorIp = new Map<string, { contagem: number; expiraEm: number }>();

function limiteExcedido(ip: string): boolean {
  const agora = Date.now();
  const entrada = contadorPorIp.get(ip);
  if (!entrada || entrada.expiraEm < agora) {
    contadorPorIp.set(ip, { contagem: 1, expiraEm: agora + 60_000 });
    return false;
  }
  entrada.contagem += 1;
  return entrada.contagem > LIMITE_REQUISICOES_POR_MINUTO;
}

const CorpoSchema = z.object({
  id_evento: z.string().trim().min(1).max(200),
  sessao_id: z.string().uuid(),
  link_sala: z.string().trim().url().max(2000).refine((u) => u.startsWith("https://"), "link_sala precisa ser https"),
  provedor: z.string().trim().max(50).optional(),
});

/**
 * POST /api/webhooks/n8n/sala — o n8n devolve o link da reunião criada (§1.3).
 * Contrato de segurança (mesmo nível do Hotmart, mais assinatura HMAC):
 *   1) sem INTEGRACOES_WEBHOOK_SECRET → 503 (fail-closed, registrarErro);
 *   2) x-sichf-timestamp fora de ±5 min → 401;
 *      x-sichf-assinatura = "sha256=HMAC(secret, timestamp + "." + corpo)" em
 *      tempo constante → senão 401 E linha em webhooks_eventos(assinatura_valida=false);
 *   3) corpo Zod, limite 1 MB, rate limit por IP;
 *   4) idempotente por (origem, id_evento): existente e processado → 200 reentrega;
 *      existente e não processado → reprocessa;
 *   5) grava via RPC `registrar_link_sala` (service_role, 0051); erro real → 500 (n8n reentrega).
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
  if (limiteExcedido(ip)) return NextResponse.json({ erro: "rate_limited" }, { status: 429 });

  const tamanhoDeclarado = Number(request.headers.get("content-length") ?? "0");
  if (tamanhoDeclarado > LIMITE_CORPO_BYTES) return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });

  const segredo = process.env.INTEGRACOES_WEBHOOK_SECRET?.trim();
  if (!segredo) {
    registrarErro("POST /api/webhooks/n8n/sala", new Error("INTEGRACOES_WEBHOOK_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const corpoTexto = await request.text();
  if (Buffer.byteLength(corpoTexto, "utf8") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("POST /api/webhooks/n8n/sala#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const timestamp = request.headers.get("x-sichf-timestamp") ?? "";
  const assinatura = request.headers.get("x-sichf-assinatura") ?? "";
  const assinaturaValida = verificarAssinatura(segredo, timestamp, corpoTexto, assinatura);

  let bruto: unknown;
  try {
    bruto = JSON.parse(corpoTexto || "{}");
  } catch {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }

  const idEventoBruto =
    typeof bruto === "object" && bruto !== null && typeof (bruto as { id_evento?: unknown }).id_evento === "string"
      ? ((bruto as { id_evento: string }).id_evento.trim().slice(0, 200) || null)
      : null;

  if (!assinaturaValida) {
    // Tentativa inválida é sinal de segurança: fica registrada (sem ocupar id de evento válido).
    await registrarTentativaInvalida(supabaseAdmin, {
      origem: ORIGEM,
      idEvento: idEventoBruto ?? `invalido:${Date.now()}:${ip}`,
      tipoEvento: "sala_criada",
      bruto: typeof bruto === "object" && bruto !== null ? bruto : { bruto },
    });
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const parse = CorpoSchema.safeParse(bruto);
  if (!parse.success) {
    return NextResponse.json({ erro: "validacao_invalida", detalhes: parse.error.issues }, { status: 422 });
  }
  const corpo = parse.data;

  const reserva = await reservarEventoWebhook(supabaseAdmin, {
    origem: ORIGEM,
    idEvento: corpo.id_evento,
    tipoEvento: "sala_criada",
    bruto: corpo,
  });
  if (reserva.tipo === "erro") {
    registrarErro(`POST /api/webhooks/n8n/sala#${reserva.etapa}`, reserva.erro);
    return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
  }
  if (reserva.tipo === "ja_processado") {
    return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
  }
  const { id: webhookEventoId, reentrega } = reserva;

  const { error: erroRpc } = await supabaseAdmin.rpc("registrar_link_sala", {
    p_sessao_id: corpo.sessao_id,
    p_link_sala: corpo.link_sala,
    p_origem: "n8n",
  });

  if (erroRpc) {
    const sessaoNaoEncontrada = erroRpc.message.startsWith("sessao_nao_encontrada");
    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ erro: erroRpc.message, processado_em: sessaoNaoEncontrada ? new Date().toISOString() : null })
      .eq("id", webhookEventoId);
    if (sessaoNaoEncontrada) {
      // Reentregar não resolve: fica registrado como processado com erro, sem 500.
      return NextResponse.json({ recebido: true, reentrega, sessao_nao_encontrada: true }, { status: 200 });
    }
    registrarErro("POST /api/webhooks/n8n/sala#registrar_link_sala", erroRpc, { webhook_evento_id: webhookEventoId });
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }

  await supabaseAdmin.from("webhooks_eventos").update({ erro: null, processado_em: new Date().toISOString() }).eq("id", webhookEventoId);
  return NextResponse.json({ recebido: true, reentrega }, { status: 200 });
}
