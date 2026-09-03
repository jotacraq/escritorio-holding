export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { Oferta } from "@/types/roteiro";

const ParametroSchema = z.object({ id: z.string().uuid(), ofertaId: z.string().uuid() });

const CorpoSchema = z.object({ aceita: z.boolean() });

/**
 * PATCH /api/jornadas/[id]/ofertas/[ofertaId] — registra a "Finalização
 * Binária" (PARTE 12 do script: só Sim ou Não). Não dispara nenhuma
 * transição de etapa — quem avança `jornadas.etapa` para `croqui_contratado`
 * é o pagamento aprovado (`processar_pagamento_hotmart`, 0011), não a
 * intenção verbal. Este campo existe para reconciliar (CONFLITO C8): "a
 * cliente disse sim aqui, mas o pagamento nunca chegou" é um furo visível.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; ofertaId: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId, ofertaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: existente, error: erroExistente } = await supabase
      .from("ofertas")
      .select("id")
      .eq("id", ofertaId)
      .eq("jornada_id", jornadaId)
      .maybeSingle();
    if (erroExistente) throw erroExistente;
    if (!existente) throw erroNaoEncontrado("Oferta não encontrada para esta jornada.");

    const { data: oferta, error } = await supabase
      .from("ofertas")
      .update({ aceita: corpo.aceita })
      .eq("id", ofertaId)
      .select("*")
      .single<Oferta>();

    if (error) {
      registrarErro("api/jornadas/[id]/ofertas/[ofertaId] PATCH", error, { jornada_id: jornadaId, oferta_id: ofertaId });
      throw error;
    }

    return NextResponse.json({ oferta });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/ofertas/[ofertaId] PATCH", erro);
  }
}
