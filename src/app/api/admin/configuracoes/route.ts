export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { ConfiguracaoAdmin } from "@/types/admin";

/**
 * GET /api/admin/configuracoes — as 7 chaves seedadas pela 0027 (link,
 * cooldown de IA, duração de sessão). Nunca há chave "fantasma": o conjunto
 * inteiro nasce por migration, e esta rota só lê o que existe.
 */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("configuracoes")
      .select("*")
      .order("chave", { ascending: true });

    if (error) {
      registrarErro("api/admin/configuracoes GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as ConfiguracaoAdmin[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/configuracoes GET", erro);
  }
}
