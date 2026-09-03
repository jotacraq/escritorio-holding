export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import type { RelatorioSessao } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** Acesso direto por id do relatório — útil para telas que listam sessões sem
 * carregar a Ficha 360 inteira. Mesmo recorte de patrimônio da rota aninhada. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: relatorio, error } = await supabase
      .from("relatorios_sessao")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!relatorio) throw erroNaoEncontrado("Relatório não encontrado.");

    return NextResponse.json({ relatorio: relatorio as RelatorioSessao });
  } catch (erro) {
    return respostaErro("api/relatorios/[id] GET", erro);
  }
}
