export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { Formulario } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/formularios/[id] — a versão COMPLETA, com `definicao`.
 *
 * A lista (`GET /api/formularios`) não traz a definição; quem abre uma versão
 * para editar ou pré-visualizar pede esta rota. Mesmo par de
 * `GET /api/admin/prompts` e `/api/admin/prompts/[id]`.
 *
 * `exigirInterno` (não `admin`): a definição do POP 02 é o roteiro do método,
 * que quem conduz a sessão precisa ler. Publicar continua sendo só de admin.
 * Nenhuma resposta de cliente sai por aqui — só a definição.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.from("formularios").select("*").eq("id", id).maybeSingle();

    if (error) {
      registrarErro("api/formularios/[id] GET", error, { formulario_id: id });
      throw error;
    }
    if (!data) throw erroNaoEncontrado("Versão de formulário não encontrada.");

    return NextResponse.json({ formulario: data as Formulario });
  } catch (erro) {
    return respostaErro("api/formularios/[id] GET", erro);
  }
}
