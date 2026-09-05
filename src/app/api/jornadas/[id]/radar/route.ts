export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { montarRadar } from "@/server/radar";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/jornadas/[id]/radar — o que falta chegar (coleta) e o que falta
 * entregar (entrega), item a item (§8.3).
 *
 * Só `admin`/`advogada`: a lista é derivada do patrimônio e da família, e a
 * EXISTÊNCIA de cada item já é metadado sensível (mesma regra de
 * `requerPatrimonio` no catálogo da Pasta). A RLS repete a exigência nas três
 * tabelas de origem.
 * Forma: `RespostaRadar` (src/types/jornada-automacoes.ts).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();

    const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Jornada não encontrada.");

    return NextResponse.json(await montarRadar(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/radar GET", erro);
  }
}
