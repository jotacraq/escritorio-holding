export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import type { Importacao } from "@/types/importacao";

/**
 * GET /api/importacoes/[id] — detalhe agregado (contadores) de uma importação.
 * Id malformado responde 404 (mesmo padrão de `/api/jornadas/[id]/etapa`) —
 * nunca 422, para não distinguir "formato ruim" de "não existe" para quem tenta
 * enumerar ids.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel();

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Importação não encontrada.");
    }

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.from("importacoes").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Importação não encontrada.");

    return NextResponse.json({ importacao: data as Importacao });
  } catch (erro) {
    return respostaErro("api/importacoes/[id] GET", erro);
  }
}
