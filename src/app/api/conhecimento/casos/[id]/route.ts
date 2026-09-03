export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { obterCasoComTranscricoes } from "@/server/conhecimento/casos";
import { ParametroIdSchema } from "@/types/conhecimento";

/**
 * Leitura lado a lado (F-4A): um caso com o conteúdo completo da Sessão de
 * Viabilidade e, quando existir, da apresentação de Croqui pareada. Mesmo
 * recorte de patrimônio das demais rotas do módulo — `conteudo` de
 * transcrição só chega a quem já vê patrimônio.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParametroIdSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const resultado = await obterCasoComTranscricoes(supabase, id);

    if (!resultado) throw erroNaoEncontrado("Caso não encontrado.");

    return NextResponse.json(resultado);
  } catch (erro) {
    return respostaErro("api/conhecimento/casos/[id] GET", erro);
  }
}
