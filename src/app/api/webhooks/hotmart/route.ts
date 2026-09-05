import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { processarEventoHotmart, type PayloadHotmart } from "@/server/pagamentos/hotmart";

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

/**
 * POST /api/webhooks/hotmart — contrato de segurança do ARQUITETURA.md §3.1.
 * Ordem obrigatória: fail-closed de secret -> comparação em tempo constante ->
 * persistir bruto primeiro (idempotência por evento_externo_id) -> processar em
 * transação (função de banco) -> nunca 200 em erro real de processamento.
 *
 * Fase 4 (§1.5): o miolo vive em `processarEventoHotmart` (compartilhado com o
 * botão de Admin) e a REENTREGA passa a olhar `processado_em`:
 *   linha nova                          → processa
 *   linha existente, processado_em null → processa de novo (mesmo bruto já gravado)
 *   linha existente, já processada      → 200 {reentrega:true}, nada é tocado
 *   linha existente com assinatura inválida + entrega VÁLIDA agora → a válida
 *   substitui o bruto e processa (uma tentativa forjada com o mesmo id não
 *   pode "ocupar" o evento e esconder a venda real).
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

  let supabaseAdmin;
  try {
    supabaseAdmin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("POST /api/webhooks/hotmart#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

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
    // `upsert` com ignoreDuplicates: um id já existente (válido ou não) não é
    // sobrescrito por uma tentativa inválida.
    await supabaseAdmin.from("webhooks_eventos").upsert(
      {
        origem: "hotmart",
        evento_externo_id: eventoExternoId,
        tipo_evento: payload.event ?? null,
        assinatura_valida: false,
        bruto: payload,
      },
      { onConflict: "origem,evento_externo_id", ignoreDuplicates: true },
    );
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // Passo 3 — persistir o bruto primeiro. Idempotência é do banco (constraint
  // unique), não de cache em memória.
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

  let webhookEventoId: string;
  let reentrega = false;

  if (linhaInserida) {
    webhookEventoId = linhaInserida.id as string;
  } else {
    // Já existia: reentrega da Hotmart (ou id já ocupado por tentativa inválida).
    const { data: existente, error: erroExistente } = await supabaseAdmin
      .from("webhooks_eventos")
      .select("id, processado_em, assinatura_valida")
      .eq("origem", "hotmart")
      .eq("evento_externo_id", eventoExternoId)
      .maybeSingle<{ id: string; processado_em: string | null; assinatura_valida: boolean }>();

    if (erroExistente || !existente) {
      registrarErro("POST /api/webhooks/hotmart#ler_existente", erroExistente ?? new Error("linha sumiu"));
      return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
    }

    if (existente.processado_em && existente.assinatura_valida) {
      // Idempotente — nada a reprocessar, nada é tocado.
      return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
    }

    if (!existente.assinatura_valida) {
      // Entrega VÁLIDA de um id que só tinha tentativa inválida: a válida manda.
      const { error: erroSubstituir } = await supabaseAdmin
        .from("webhooks_eventos")
        .update({ assinatura_valida: true, bruto: payload, tipo_evento: payload.event ?? null, erro: null, processado_em: null })
        .eq("id", existente.id);
      if (erroSubstituir) {
        registrarErro("POST /api/webhooks/hotmart#substituir_invalido", erroSubstituir, { webhook_evento_id: existente.id });
        return NextResponse.json({ erro: "falha_ao_persistir" }, { status: 500 });
      }
    }

    webhookEventoId = existente.id;
    reentrega = true;
  }

  try {
    const resultado = await processarEventoHotmart(supabaseAdmin, webhookEventoId);

    switch (resultado.tipo) {
      case "sem_compra":
        return NextResponse.json({ recebido: true, reentrega }, { status: 200 });
      case "produto_nao_mapeado":
        // Passo 6 — produto desconhecido: 200, marcado para a tela de pendências.
        return NextResponse.json({ recebido: true, reentrega, produto_nao_mapeado: true }, { status: 200 });
      case "pagamento_nao_registrado":
        // Dinheiro sem registro: 500 para a Hotmart reentregar; fica bem visível
        // (`processado_em` continua nulo → pendência `webhook_falho`).
        return NextResponse.json({ erro: "falha_ao_registrar_pagamento" }, { status: 500 });
      case "processado":
        return NextResponse.json({ recebido: true, reentrega, pagamento_id: resultado.pagamento_id }, { status: 200 });
      case "ja_processado":
        return NextResponse.json({ recebido: true, reentrega: true }, { status: 200 });
      case "assinatura_invalida":
        return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
    }
  } catch (erro) {
    // Passo 5 — erro no processamento: 500 (bruto já salvo, a Hotmart reentrega
    // e a idempotência do passo 3 protege). Nunca engolir erro devolvendo 200.
    registrarErro("POST /api/webhooks/hotmart#processar", erro, { webhook_evento_id: webhookEventoId });
    return NextResponse.json({ erro: "falha_ao_processar" }, { status: 500 });
  }
}
