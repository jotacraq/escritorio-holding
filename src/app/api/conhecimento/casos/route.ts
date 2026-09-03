export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { listarCasos, obterContagemDesfecho } from "@/server/conhecimento/casos";
import { ParametroListaCasosSchema } from "@/types/conhecimento";

/**
 * Lista de casos do Módulo 4, com a contagem por desfecho ao lado
 * (CONFLITO C13 — a tela precisa dos DOIS números, nunca só o percentual de
 * "avançou para croqui"). Mesmo recorte de patrimônio das demais rotas do
 * módulo.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirVePatrimonio();
    const params = ParametroListaCasosSchema.parse(Object.fromEntries(request.nextUrl.searchParams));

    const supabase = await criarClienteServidor();
    const [casos, contagem] = await Promise.all([
      listarCasos(supabase, params),
      obterContagemDesfecho(supabase),
    ]);

    return NextResponse.json({ casos, contagem_por_desfecho: contagem });
  } catch (erro) {
    return respostaErro("api/conhecimento/casos GET", erro);
  }
}
