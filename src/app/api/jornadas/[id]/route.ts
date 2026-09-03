export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, papelVePatrimonio } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { montarFicha360 } from "@/server/jornadas";

const ParametroIdSchema = z.object({ id: z.string().uuid() });

/**
 * Ficha 360. Patrimônio e relatório só vêm no payload se `app.ve_patrimonio()`
 * for true para quem está logado — a rota decide isso ANTES de buscar (não busca
 * para depois esconder), e a RLS nega de novo se o código aqui errar.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirInterno();

    const { id } = ParametroIdSchema.parse(await params);

    const podeVerPatrimonio = papelVePatrimonio(usuario.papel);

    const supabase = await criarClienteServidor();
    const ficha = await montarFicha360(supabase, id, podeVerPatrimonio);

    return NextResponse.json(ficha);
  } catch (erro) {
    return respostaErro("api/jornadas/[id] GET", erro);
  }
}
