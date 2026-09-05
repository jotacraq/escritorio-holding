import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { segredosIguais } from "@/server/integracoes/assinatura";
import { criarLimitador, ipDaRequisicao } from "@/server/integracoes/rate-limit";
import { eMensagemRecebida, registrarMensagemRecebida, type EventoChatwoot } from "@/server/chatwoot/recebidas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGEM = "chatwoot";
const LIMITE_CORPO_BYTES = 1_000_000;
const limiteExcedido = criarLimitador(120);

/**
 * POST /api/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_SECRET>
 *
 * O Chatwoot NÃO assina webhooks (CONFLITO C28): a trava é o segredo na URL,
 * comparado em tempo constante — mesmo nível do `hottok` da Hotmart. Sem a
 * env var → 503 (fail-closed). Token errado → 401 e registro em
 * `webhooks_eventos(assinatura_valida=false)`. Só `message_created` com
 * `message_type='incoming'` tem efeito; o resto → 200 sem efeito.
 * Idempotência: unique (provedor, mensagem_externa_id) em `mensagens_recebidas`.
 */
export async function POST(request: NextRequest) {
  if (limiteExcedido(ipDaRequisicao(request.headers))) {
    return NextResponse.json({ erro: "rate_limited" }, { status: 429 });
  }
  if (Number(request.headers.get("content-length") ?? "0") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  const segredo = process.env.CHATWOOT_WEBHOOK_SECRET?.trim();
  if (!segredo) {
    registrarErro("POST /api/webhooks/chatwoot", new Error("CHATWOOT_WEBHOOK_SECRET ausente"));
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
    registrarErro("POST /api/webhooks/chatwoot#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const token = request.nextUrl.searchParams.get("token") ?? request.headers.get("x-chatwoot-token") ?? "";
  const tokenValido = token.length > 0 && segredosIguais(token, segredo);

  let bruto: unknown = null;
  try {
    bruto = corpoTexto ? JSON.parse(corpoTexto) : null;
  } catch {
    bruto = null;
  }
  const evento = (bruto && typeof bruto === "object" ? bruto : {}) as EventoChatwoot;

  if (!tokenValido) {
    // Nunca guarda o token recebido; só o fato e um recorte do corpo.
    await supabaseAdmin.from("webhooks_eventos").insert({
      origem: ORIGEM,
      evento_externo_id: evento.id != null ? `msg:${String(evento.id)}` : `invalida:${randomUUID()}`,
      tipo_evento: typeof evento.event === "string" ? evento.event : null,
      assinatura_valida: false,
      bruto: { motivo: "token_invalido", evento: evento.event ?? null, conversa: evento.conversation?.id ?? null },
      erro: "token_invalido",
      processado_em: new Date().toISOString(),
    });
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (bruto === null) {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }

  if (!eMensagemRecebida(evento)) {
    return NextResponse.json({ recebido: true, efeito: "nenhum" }, { status: 200 });
  }

  try {
    const resultado = await registrarMensagemRecebida(supabaseAdmin, evento);
    if (resultado.situacao === "gravada") {
      return NextResponse.json(
        {
          recebido: true,
          mensagem_id: resultado.mensagem.id,
          correspondencia: resultado.mensagem.pessoa_id ? "pessoa" : "sem_correspondencia",
        },
        { status: 200 },
      );
    }
    if (resultado.situacao === "duplicada") {
      return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
    }
    return NextResponse.json({ recebido: true, efeito: "nenhum", motivo: resultado.motivo }, { status: 200 });
  } catch (erro) {
    registrarErro("POST /api/webhooks/chatwoot#processar", erro, { conversa: evento.conversation?.id ?? null });
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }
}
