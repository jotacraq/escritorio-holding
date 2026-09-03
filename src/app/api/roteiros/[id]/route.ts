export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { RoteiroVersao } from "@/types/roteiro";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** GET /api/roteiros/[id] — versão completa, com `definicao`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("roteiros_versoes")
      .select("*")
      .eq("id", id)
      .maybeSingle<RoteiroVersao>();

    if (error) {
      registrarErro("api/roteiros/[id] GET", error, { roteiro_id: id });
      throw error;
    }
    if (!data) throw erroNaoEncontrado("Versão de roteiro não encontrada.");

    return NextResponse.json({ roteiro: data });
  } catch (erro) {
    return respostaErro("api/roteiros/[id] GET", erro);
  }
}
