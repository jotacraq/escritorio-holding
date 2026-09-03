export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { Familiar } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** Composição familiar é operacional (quem participa da sessão) — toda a equipe lê. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("pessoa_id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: familiares, error } = await supabase
      .from("familiares")
      .select("*")
      .eq("pessoa_id", (jornada as { pessoa_id: string }).pessoa_id)
      .eq("ativo", true)
      .order("criado_em", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ familiares: (familiares as Familiar[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/familiares GET", erro);
  }
}

const CorpoSchema = z.object({
  parentesco: z.string().trim().min(1).max(100),
  nome: z.string().trim().max(200).optional(),
  idade: z.number().int().min(0).max(130).optional(),
  ocupacao: z.string().trim().max(200).optional(),
  regime_casamento: z.string().trim().max(100).optional(),
  ano_casamento: z.number().int().min(1900).max(2100).optional(),
  dependente_financeiro: z.boolean().optional(),
  observacoes: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("pessoa_id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: familiar, error } = await supabase
      .from("familiares")
      .insert({
        ...corpo,
        pessoa_id: (jornada as { pessoa_id: string }).pessoa_id,
        registrado_na_jornada_id: jornadaId,
      })
      .select("*")
      .single();

    if (error) {
      registrarErro("api/jornadas/[id]/familiares POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ familiar: familiar as Familiar }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/familiares POST", erro);
  }
}
