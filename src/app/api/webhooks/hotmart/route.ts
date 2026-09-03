import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_CORPO_BYTES = 1_000_000; // 1 MB, §3.1 passo 7
const LIMITE_REQUISICOES_POR_MINUTO = 60;

// Rate limit simples em memória — vale para uma instância Node (Hostinger não é
// serverless multi-região aqui). Suficiente para conter abuso grosseiro; não é
// distribuído entre processos.
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

function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type StatusPagamento = "pendente" | "em_analise" | "aprovado" | "cancelado" | "estornado" | "reembolsado";

/**
 * Mapeamento best-effort do status de compra da Hotmart. Os valores exatos
 * dependem da versão/contrato do webhook contratado — BLOQUEIO B7 do plano.
 * Nunca assume "aprovado" por default: status desconhecido cai em 'em_analise'.
 */
function mapearStatusHotmart(statusBruto: string | undefined): StatusPagamento {
  const status = (statusBruto ?? "").toUpperCase();
  if (status === "APPROVED" || status === "COMPLETE" || status === "COMPLETED") return "aprovado";
  if (status === "CANCELLED" || status === "CANCELED" || status === "EXPIRED") return "cancelado";
  if (status === "REFUNDED") return "reembolsado";
  if (status === "CHARGEBACK" || status === "DISPUTE") return "estornado";
  if (status === "BILLET_PRINTED" || status === "STARTED" || status === "PRE_ORDER" || status === "PROCESSING_TRANSACTION") {
    return "pendente";
  }
  return "em_analise";
}

interface PayloadHotmart {
  id?: string;
  event?: string;
  data?: {
    purchase?: {
      transaction?: string;
      status?: string;
      price?: { value?: number; currency_value?: string };
      payment?: { installments_number?: number };
      approved_date?: number;
      order_date?: number;
    };
    product?: { id?: number | string };
    buyer?: { email?: string; name?: string; checkout_phone?: string };
  };
}

/**
 * POST /api/webhooks/hotmart — contrato de segurança do ARQUITETURA.md §3.1.
 * Ordem obrigatória: fail-closed de secret -> comparação em tempo constante ->
 * persistir bruto primeiro (idempotência por evento_externo_id) -> processar em
 * transação (função de banco) -> nunca 200 em erro real de processamento.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
  if (limiteExcedido(ip)) {
    return NextResponse.json({ erro: "rate_limited" }, { status: 429 });
  }

  const tamanhoDeclarado = Number(request.headers.get("content-length") ?? "0");
  if (tamanhoDeclarado > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  // Passo 1 — fail-CLOSED: sem secret configurado, o endpoint recusa, nunca aceita.
  const segredo = process.env.HOTMART_WEBHOOK_SECRET;
  if (!segredo) {
    registrarErro("POST /api/webhooks/hotmart", new Error("HOTMART_WEBHOOK_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const corpoTexto = await request.text();
  if (Buffer.byteLength(corpoTexto, "utf8") > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ erro: "payload_muito_grande" }, { status: 413 });
  }

  const supabaseAdmin = criarClienteAdmin();

  // Passo 2 — comparação em tempo constante do hottok.
  const hottokRecebido = request.headers.get("x-hotmart-hottok") ?? "";
  const assinaturaValida = segredosIguais(hottokRecebido, segredo);

  let payload: PayloadHotmart;
  try {
    payload = JSON.parse(corpoTexto || "{}") as PayloadHotmart;
  } catch {
    return NextResponse.json({ erro: "payload_invalido" }, { status: 400 });
  }

  const eventoExternoId = payload.id ?? payload.data?.purchase?.transaction;
  if (!eventoExternoId) {
    return NextResponse.json({ erro: "payload_sem_id_de_evento" }, { status: 400 });
  }

  if (!assinaturaValida) {
    // Grava mesmo assim: tentativa inválida é sinal de segurança, não descartar.
    await supabaseAdmin.from("webhooks_eventos").insert({
      origem: "hotmart",
      evento_externo_id: eventoExternoId,
      tipo_evento: payload.event ?? null,
      assinatura_valida: false,
      bruto: payload,
    });
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // Passo 3 — persistir o bruto primeiro. Idempotência é do banco (constraint
  // unique), não de cache em memória. Reentrega -> 200 imediato, sem reprocessar.
  const { data: linhaInserida, error: erroInsercao } = await supabaseAdmin
    .from("webhooks_eventos")
    .upsert(
      {
        origem: "hotmart",
        evento_externo_id: eventoExternoId,
        tipo_evento: payload.event ?? null,
        assinatura_valida: true,
        bruto: payload,
      },
      { onConflict: "origem,evento_externo_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (erroInsercao) {
    registrarErro("POST /api/webhooks/hotmart#persistir_bruto", erroInsercao);
    return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
  }

  if (!linhaInserida) {
    // Já existia: reentrega da Hotmart. Idempotente — nada a reprocessar.
    return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
  }

  const webhookEventoId = linhaInserida.id as string;
  const purchase = payload.data?.purchase;
  const produto = payload.data?.product;
  const buyer = payload.data?.buyer;

  if (!purchase) {
    // Evento sem dados de compra (ex.: outro tipo de notificação): registrado,
    // nada a processar.
    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ processado_em: new Date().toISOString() })
      .eq("id", webhookEventoId);
    return NextResponse.json({ recebido: true }, { status: 200 });
  }

  const statusPagamento = mapearStatusHotmart(purchase.status);
  const pagoEm = purchase.approved_date
    ? new Date(purchase.approved_date).toISOString()
    : purchase.order_date
      ? new Date(purchase.order_date).toISOString()
      : null;

  try {
    // Passo 4 — processar em transação (função de banco, ver 0011).
    const { data: resultado, error: erroProcessamento } = await supabaseAdmin
      .rpc("processar_pagamento_hotmart", {
        p_hotmart_produto_id: produto?.id != null ? String(produto.id) : null,
        p_transacao_externa_id: purchase.transaction ?? eventoExternoId,
        p_status: statusPagamento,
        p_valor: purchase.price?.value ?? null,
        p_moeda: purchase.price?.currency_value ?? "BRL",
        p_parcelas: purchase.payment?.installments_number ?? null,
        p_comprador_email: buyer?.email ?? null,
        p_comprador_nome: buyer?.name ?? null,
        p_comprador_telefone: buyer?.checkout_phone ?? null,
        p_pago_em: pagoEm,
        p_bruto: payload,
      })
      .single<{
        pagamento_id: string | null;
        jornada_id: string | null;
        produto_mapeado: boolean;
        etapa_avancada: boolean;
        observacao: string | null;
      }>();

    if (erroProcessamento) {
      throw new Error(erroProcessamento.message);
    }

    // Passo 6 — produto desconhecido: 200, marcado para a tela de pendências.
    if (!resultado?.produto_mapeado) {
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({ erro: "produto_nao_mapeado", processado_em: new Date().toISOString() })
        .eq("id", webhookEventoId);
      return NextResponse.json({ recebido: true, produto_nao_mapeado: true }, { status: 200 });
    }

    // Pagamento não foi possível registrar (rede de segurança da trava de piso
    // cross-migration — ver comentário na função). Isto é crítico: dinheiro sem
    // registro. Responde 500 para a Hotmart reentregar e fica bem visível.
    if (!resultado.pagamento_id) {
      await supabaseAdmin
        .from("webhooks_eventos")
        .update({
          erro: resultado.observacao ?? "pagamento_nao_registrado",
          tentativas: 1,
        })
        .eq("id", webhookEventoId);
      registrarErro("POST /api/webhooks/hotmart#pagamento_nao_registrado", new Error(resultado.observacao ?? "sem observacao"), { webhook_evento_id: webhookEventoId });
      return NextResponse.json({ erro: "falha_ao_registrar_pagamento" }, { status: 500 });
    }

    await supabaseAdmin
      .from("webhooks_eventos")
      .update({
        erro: resultado.observacao,
        processado_em: new Date().toISOString(),
      })
      .eq("id", webhookEventoId);

    return NextResponse.json({ recebido: true, pagamento_id: resultado.pagamento_id }, { status: 200 });
  } catch (erro) {
    // Passo 5 — erro no processamento: 500 (bruto já salvo, a Hotmart reentrega
    // e a idempotência do passo 3 protege). Nunca engolir erro devolvendo 200.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    registrarErro("POST /api/webhooks/hotmart#processar", erro, { webhook_evento_id: webhookEventoId });
    await supabaseAdmin
      .from("webhooks_eventos")
      .update({ erro: mensagem })
      .eq("id", webhookEventoId);
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }
}
