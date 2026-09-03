import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({ edicao_id: z.string().uuid().optional() });

/**
 * GET /api/indicadores — POP 08, lê a view `vw_indicadores_esteira` (migration
 * 0015, do BACK-CORE — este arquivo só lê). `security_invoker` garante que a
 * RLS de `jornadas` vale também aqui; a rota também checa o papel, porque
 * nenhuma rota confia só na RLS. Chave de resposta `itens` para casar com
 * `buscarIndicadores()` em src/lib/api.ts (já escrito).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirVePatrimonio();

    const { searchParams } = new URL(request.url);
    const query = QuerySchema.parse({ edicao_id: searchParams.get("edicao_id") ?? undefined });

    const supabase = await criarClienteServidor();
    let consulta = supabase.from("vw_indicadores_esteira").select("*");
    if (query.edicao_id) {
      consulta = consulta.eq("edicao_id", query.edicao_id);
    }

    const { data, error } = await consulta;
    if (error) throw error;

    return NextResponse.json({ itens: data ?? [] });
  } catch (erro) {
    return respostaErro("GET /api/indicadores", erro);
  }
}
