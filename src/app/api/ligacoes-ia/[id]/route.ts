export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import type { LigacaoIa, RespostaLigacaoIa } from "@/types/integracoes";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** GET /api/ligacoes-ia/[id] — detalhe (RLS decide; fora do recorte → 404, nunca 403 que confirme existência). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.from("ligacoes_ia").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Ligação não encontrada.");
    const resposta: RespostaLigacaoIa = { ligacao: data as LigacaoIa };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/ligacoes-ia/[id]", erro);
  }
}
