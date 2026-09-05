export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import type { ParametroMetodo } from "@/types/cenario";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/admin/parametros/[id]/ativar — promove uma versão. Chama
 * `public.ativar_parametro_metodo` (0056): desativa a corrente e ativa esta
 * na MESMA transação, carimbando `ativado_por/em`. Só admin (gate na rota,
 * na RLS `pm_upd` e dentro da função — os três).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.rpc("ativar_parametro_metodo", { p_id: id }).single<ParametroMetodo>();
    if (error) {
      const msg = (error as { message: string }).message;
      if (msg.startsWith("versao_nao_encontrada")) throw erroNaoEncontrado("Versão de parâmetro não encontrada.");
      if (msg.startsWith("sem_permissao")) throw erroSemPermissao();
      registrarErro("api/admin/parametros/[id]/ativar POST", error, { parametro_id: id });
      throw error;
    }
    return NextResponse.json({ parametro: data });
  } catch (erro) {
    return respostaErro("api/admin/parametros/[id]/ativar POST", erro);
  }
}
