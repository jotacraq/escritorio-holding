export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { PromptVersaoAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** GET /api/admin/prompts/[id] — versão completa, com `corpo_sistema` e `esquema_saida`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("prompts_versoes")
      .select("*")
      .eq("id", id)
      .maybeSingle<PromptVersaoAdmin>();

    if (error) {
      registrarErro("api/admin/prompts/[id] GET", error, { prompt_id: id });
      throw error;
    }
    if (!data) throw erroNaoEncontrado("Versão de prompt não encontrada.");

    return NextResponse.json({ prompt: data });
  } catch (erro) {
    return respostaErro("api/admin/prompts/[id] GET", erro);
  }
}
