export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroValidacao, respostaErro } from "@/server/erros";
import { ChaveParametroSchema, UfSchema, parametrosVigentes } from "@/server/parametros";
import type { RespostaParametrosMetodo } from "@/types/cenario";

const QuerySchema = z.object({
  chaves: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((c) => c.trim()).filter(Boolean))
    .pipe(z.array(ChaveParametroSchema).min(1).max(20)),
  uf: UfSchema.optional(),
  municipio: z.string().trim().min(1).max(120).optional(),
});

/**
 * GET /api/parametros-metodo?chaves=honorarios.croqui.padrao,honorarios.croqui.incentivo[&uf=SP]
 *
 * Leitura interna (`eh_interno`, mesma RLS `pm_sel`) das versões ATIVAS —
 * é o que `PainelOferta` (agente I) e a gaveta Cenário (agente H) consomem.
 * Resposta: `{ parametros: { chave: ParametroMetodo | null }, ausentes: string[] }`.
 * `null` é a única resposta para "não há" — nunca um número de fallback.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const url = request.nextUrl;
    const query = QuerySchema.safeParse({
      chaves: url.searchParams.get("chaves") ?? "",
      uf: url.searchParams.get("uf") ?? undefined,
      municipio: url.searchParams.get("municipio") ?? undefined,
    });
    if (!query.success) throw erroValidacao(query.error.issues, "Informe ?chaves=a,b (chaves válidas).");

    const supabase = await criarClienteServidor();
    const resposta: RespostaParametrosMetodo = await parametrosVigentes(supabase, query.data.chaves, {
      uf: query.data.uf ?? null,
      municipio: query.data.municipio ?? null,
    });
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/parametros-metodo GET", erro);
  }
}
