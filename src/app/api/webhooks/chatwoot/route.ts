import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { segredosIguais } from "@/server/integracoes/assinatura";
import { criarLimitador, ipDaRequisicao } from "@/server/integracoes/rate-limit";
import { eMensagemDeSaida, eMensagemRecebida, registrarMensagemRecebida, type EventoChatwoot } from "@/server/chatwoot/recebidas";
import { carimbarRespostaHumana } from "@/server/agente-whatsapp/estado";
import { processarMensagemDoAgente } from "@/server/agente-whatsapp/responder";

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

  // C8/D24 — `outgoing` passa a ser LIDO (nunca gravado em `mensagens_recebidas`,
  // que é tabela de ENTRADA) só para carimbar `humano_respondeu_em`. Sem isto,
  // "calar quando o humano responde" não teria como funcionar: até a Fase 9 o
  // sistema simplesmente não via a resposta da equipe.
  if (eMensagemDeSaida(evento)) {
    const conversa = evento.conversation?.id != null ? String(evento.conversation.id) : null;
    if (!conversa) return NextResponse.json({ recebido: true, efeito: "nenhum" }, { status: 200 });
    try {
      const carimbo = await carimbarRespostaHumana(supabaseAdmin, {
        conversaExternaId: conversa,
        provedorId: evento.id != null ? String(evento.id) : null,
        quandoIso: new Date().toISOString(),
      });
      return NextResponse.json({ recebido: true, efeito: carimbo.carimbou ? "humano_respondeu" : "nenhum", motivo: carimbo.motivo }, { status: 200 });
    } catch (erro) {
      registrarErro("POST /api/webhooks/chatwoot#outgoing", erro, { conversa });
      return NextResponse.json({ recebido: true, efeito: "nenhum" }, { status: 200 });
    }
  }

  if (!eMensagemRecebida(evento)) {
    return NextResponse.json({ recebido: true, efeito: "nenhum" }, { status: 200 });
  }

  try {
    const resultado = await registrarMensagemRecebida(supabaseAdmin, evento);
    if (resultado.situacao === "gravada") {
      // O agente decide e responde NO MESMO request (D12), com orçamento de
      // tempo próprio. Ele NUNCA impede a gravação de aparecer: qualquer falha
      // dele vira `agente: "falha_ao_avaliar"` e a mensagem continua registrada.
      const agente = await processarMensagemDoAgente(supabaseAdmin, {
        evento,
        mensagemRecebidaId: resultado.mensagem.id,
        conversaExternaId: resultado.mensagem.conversa_externa_id,
        telefoneBruto: evento.sender?.phone_number ?? evento.sender?.identifier ?? null,
        corpo: resultado.mensagem.corpo,
        temAnexo: (evento.attachments ?? []).length > 0,
      }).catch((erro) => {
        registrarErro("POST /api/webhooks/chatwoot#agente", erro, { mensagem_id: resultado.mensagem.id });
        return null;
      });

      return NextResponse.json(
        {
          recebido: true,
          mensagem_id: resultado.mensagem.id,
          // Em produção só o VEREDITO. `correspondencia` ("pessoa" vs
          // "sem_correspondencia") e `agente_motivo`
          // ("sem_consentimento_whatsapp", "origem_demonstracao") dizem, a quem
          // tem o token do webhook, se um número qualquer é cliente do
          // escritório — é o mesmo oráculo que o §F queria fechar, por canal
          // lateral de CORPO em vez de status (achado BAIXO do pentest da
          // Fase 9). O Chatwoot não lê nenhum dos dois: este corpo é só ack.
          // Fora de produção os dois saem, porque é deles que o
          // `scripts/simular-chatwoot.ts` vive.
          agente: agente ? (agente.respondeu ? "respondeu" : "silencio") : "falha_ao_avaliar",
          ...(process.env.NODE_ENV === "production"
            ? {}
            : {
                correspondencia: resultado.mensagem.pessoa_id ? "pessoa" : "sem_correspondencia",
                ...(agente ? { agente_motivo: agente.motivo } : {}),
              }),
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
