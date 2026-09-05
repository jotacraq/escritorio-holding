export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { listarExecucao } from "@/server/execucao";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/jornadas/[id]/execucao — a sub-esteira do cronograma real (0067):
 * marcos do modelo, quais já foram concluídos e o total.
 *
 * `ve_patrimonio` porque a lista de marcos concluídos diz em que pé está a
 * reorganização patrimonial de UMA família (a RLS de `execucao_jornada_marcos`
 * exige o mesmo). Sem modelo cadastrado: `total: 0` e `modelo: null` — o
 * trilho mostra "sem informação", nunca "0%".
 * Forma: `RespostaExecucao` (src/types/jornada-automacoes.ts).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();

    const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Jornada não encontrada.");

    return NextResponse.json(await listarExecucao(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/execucao GET", erro);
  }
}
