export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { AgendaBloqueio } from "@/types/agenda";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * Cancela um bloqueio (`cancelado_em = now()`). Nunca DELETE — mesma convenção
 * de baixa lógica do resto do schema. Restrito a admin/advogada.
 */
export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirPapel("admin", "advogada");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: existente, error: erroBusca } = await supabase
      .from("agenda_bloqueios")
      .select("id, cancelado_em")
      .eq("id", id)
      .maybeSingle<{ id: string; cancelado_em: string | null }>();
    if (erroBusca) throw erroBusca;
    if (!existente) throw erroNaoEncontrado("Bloqueio não encontrado.");
    if (existente.cancelado_em) throw erroConflito("bloqueio_ja_cancelado", "Este bloqueio já está cancelado.");

    const { data, error } = await supabase
      .from("agenda_bloqueios")
      .update({ cancelado_em: new Date().toISOString(), cancelado_por: usuario.id })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      registrarErro("api/disponibilidades/bloqueios/[id] PATCH", error, { id });
      throw error;
    }

    return NextResponse.json({ bloqueio: data as AgendaBloqueio });
  } catch (erro) {
    return respostaErro("api/disponibilidades/bloqueios/[id] PATCH", erro);
  }
}
