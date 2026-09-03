export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { EtapaJornadaOrdem } from "@/types/banco";

/**
 * GET /api/etapas — colunas do kanban da Esteira (F2), na ordem certa.
 * Lê `etapas_jornada_ordem` (dado, não código — nunca hardcodear a lista aqui).
 * Resposta é o array puro (sem wrapper `{itens}`) para casar com
 * `buscarEtapasOrdem()` em src/lib/api.ts, que tipa `EtapaOrdem[]` direto.
 */
export async function GET() {
  try {
    await exigirInterno();

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("etapas_jornada_ordem")
      .select("etapa, ordem, rotulo, cor")
      .order("ordem", { ascending: true });

    if (error) {
      registrarErro("api/etapas GET", error);
      throw error;
    }

    return NextResponse.json((data as EtapaJornadaOrdem[] | null) ?? []);
  } catch (erro) {
    return respostaErro("api/etapas GET", erro);
  }
}
