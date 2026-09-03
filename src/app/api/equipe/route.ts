export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";

/**
 * GET /api/equipe — perfis de `perfis_equipe` ativos, para o filtro
 * "responsável" (F2). Só equipe interna lê (`pe_select` na RLS já exige
 * `app.eh_interno()`; a rota checa de novo — nenhuma rota confia só na RLS).
 * Não expõe `email`/`auth_user_id`: o filtro só precisa de nome e papel.
 */
export async function GET() {
  try {
    await exigirInterno();

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("perfis_equipe")
      .select("id, nome, papel, ativo")
      .eq("ativo", true)
      .order("nome", { ascending: true });

    if (error) {
      registrarErro("api/equipe GET", error);
      throw error;
    }

    return NextResponse.json({ itens: data ?? [] });
  } catch (erro) {
    return respostaErro("api/equipe GET", erro);
  }
}
