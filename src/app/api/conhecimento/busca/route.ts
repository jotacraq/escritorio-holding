export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { buscarTranscricoes } from "@/server/conhecimento/busca";
import { ParametroBuscaSchema } from "@/types/conhecimento";

/**
 * Busca full-text no Módulo 4 (`0032_base_conhecimento.sql`). Mesmo recorte
 * de patrimônio de `documentos`/`patrimonio_itens`: só admin/advogada —
 * transcrição é conversa de advogado com cliente.
 *
 * `termo` é sempre encaminhado como parâmetro da RPC `buscar_transcricoes_por_termo`
 * (bind parameter no Postgres) — nunca concatenado em filtro. Qualquer erro
 * inesperado cai em `respostaErro`, que nunca inclui trecho de transcrição na
 * resposta (só código semântico + id de correlação em log).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirVePatrimonio();
    const params = ParametroBuscaSchema.parse(Object.fromEntries(request.nextUrl.searchParams));

    const supabase = await criarClienteServidor();
    const resultados = await buscarTranscricoes(supabase, params);

    return NextResponse.json({ resultados });
  } catch (erro) {
    return respostaErro("api/conhecimento/busca GET", erro);
  }
}
