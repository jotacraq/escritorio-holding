export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { CorpoGravarRubricaSchema, gravarRubrica, listarCenario } from "@/server/cenario";

const ParametroSchema = z.object({ id: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
async function exigirJornada(supabase: any, jornadaId: string) {
  const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Jornada não encontrada.");
}

/**
 * GET /api/jornadas/[id]/cenario — grade `rubrica × cenário` com procedência
 * por célula. Só `admin`/`advogada` (`exigirVePatrimonio` + RLS `cp_sel`/
 * `cr_sel`): `relacionamento` recebe 403 aqui e 0 linhas no PostgREST.
 * Forma: `RespostaCenarioJornada` (src/types/cenario.ts).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    await exigirJornada(supabase, jornadaId);
    return NextResponse.json(await listarCenario(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/cenario GET", erro);
  }
}

/**
 * PUT /api/jornadas/[id]/cenario — grava UMA célula (`CorpoGravarRubrica`).
 * O sistema não calcula imposto (B26): `calculado` exige `base_calculo` +
 * `parametro_id` e o banco multiplica com a alíquota carimbada; o corpo nunca
 * manda `valor` nesse caso. Violação → 409 com código do trigger
 * (`cenario_calculado_exige_parametro`, `parametro_nao_e_percentual`, ...).
 * Resposta: `RespostaGravarRubrica` — célula + totais do cenário (`total`
 * `null` enquanto houver rubrica ausente).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoGravarRubricaSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );
    const supabase = await criarClienteServidor();
    await exigirJornada(supabase, jornadaId);
    return NextResponse.json(await gravarRubrica(supabase, jornadaId, usuario.id, corpo));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/cenario PUT", erro);
  }
}
