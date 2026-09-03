export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { obterTranscricaoPorId } from "@/server/conhecimento/transcricoes";
import { ParametroIdSchema } from "@/types/conhecimento";

/**
 * Leitura de uma transcrição isolada (conteúdo completo). Mesmo recorte de
 * patrimônio das demais rotas do módulo — quem não vê patrimônio recebe o
 * mesmo 404 de "não encontrado" que uma transcrição inexistente (RLS nega em
 * silêncio; a rota não distingue os dois casos).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParametroIdSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const transcricao = await obterTranscricaoPorId(supabase, id);

    if (!transcricao) throw erroNaoEncontrado("Transcrição não encontrada.");

    return NextResponse.json({ transcricao });
  } catch (erro) {
    return respostaErro("api/conhecimento/transcricoes/[id] GET", erro);
  }
}
