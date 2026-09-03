export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { Familiar } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    parentesco: z.string().trim().min(1).max(100),
    nome: z.string().trim().max(200).nullable(),
    idade: z.number().int().min(0).max(130).nullable(),
    ocupacao: z.string().trim().max(200).nullable(),
    regime_casamento: z.string().trim().max(100).nullable(),
    ano_casamento: z.number().int().min(1900).max(2100).nullable(),
    dependente_financeiro: z.boolean().nullable(),
    observacoes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nenhum campo para atualizar." });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: familiar, error } = await supabase
      .from("familiares")
      .update(corpo)
      .eq("id", id)
      .eq("ativo", true)
      .select("*")
      .maybeSingle();

    if (error) {
      registrarErro("api/familiares/[id] PUT", error, { familiar_id: id });
      throw error;
    }
    if (!familiar) throw erroNaoEncontrado("Familiar não encontrado.");

    return NextResponse.json({ familiar: familiar as Familiar });
  } catch (erro) {
    return respostaErro("api/familiares/[id] PUT", erro);
  }
}

/** "Nada de DELETE" — baixa é `ativo = false`. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: familiar, error } = await supabase
      .from("familiares")
      .update({ ativo: false })
      .eq("id", id)
      .eq("ativo", true)
      .select("id")
      .maybeSingle();

    if (error) {
      registrarErro("api/familiares/[id] DELETE", error, { familiar_id: id });
      throw error;
    }
    if (!familiar) throw erroNaoEncontrado("Familiar não encontrado.");

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return respostaErro("api/familiares/[id] DELETE", erro);
  }
}
