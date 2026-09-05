export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import {
  CorpoEditarDiagnosticoSchema,
  editarDiagnostico,
  gerarDiagnostico,
  listarDiagnostico,
} from "@/server/diagnostico";

const ParametroSchema = z.object({ id: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
async function exigirJornada(supabase: any, jornadaId: string) {
  const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Jornada não encontrada.");
}

/**
 * GET /api/jornadas/[id]/diagnostico — `{ atual: DiagnosticoSv | null,
 * historico: DiagnosticoSvResumo[] }`. Só `admin`/`advogada` (RLS `dg_sel`):
 * `relacionamento` não lê o diagnóstico (contém patrimônio e riscos).
 * O Modo Apresentação (agente H/I) renderiza SÓ blocos com
 * `visivel_ao_cliente === true` — e não os põe no DOM escondidos.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    await exigirJornada(supabase, jornadaId);
    return NextResponse.json(await listarDiagnostico(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/diagnostico GET", erro);
  }
}

/**
 * POST /api/jornadas/[id]/diagnostico — monta versão NOVA por função pura
 * (`montarDiagnostico`, zero IA) a partir da Ficha 360, da análise atual do
 * Agente do Croqui (se houver) e da grade do Cenário. Todos os blocos nascem
 * `visivel_ao_cliente: false` (B31). Resposta 201 `{ diagnostico }`.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    const diagnostico = await gerarDiagnostico(supabase, jornadaId);
    return NextResponse.json({ diagnostico }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/diagnostico POST", erro);
  }
}

/**
 * PATCH /api/jornadas/[id]/diagnostico — edita a versão ATUAL
 * (`CorpoEditarDiagnostico`: `blocos[]` por chave, `visibilidade{}` e/ou
 * `aprovar`). Nunca cria versão nem toca versão antiga. `o_que_falta`
 * visível → 409 `bloco_interno`. Resposta `{ diagnostico }`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoEditarDiagnosticoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );
    const supabase = await criarClienteServidor();
    await exigirJornada(supabase, jornadaId);
    const diagnostico = await editarDiagnostico(supabase, jornadaId, usuario.id, corpo);
    return NextResponse.json({ diagnostico });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/diagnostico PATCH", erro);
  }
}
