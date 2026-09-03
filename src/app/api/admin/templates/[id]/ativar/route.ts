export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import type { MensagemTemplateAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/admin/templates/[id]/ativar — promove uma versão já existente
 * (inclusive para VOLTAR a uma versão anterior) sem tocar no corpo. Chama
 * `public.ativar_template_mensagem` (0033): desativa a versão corrente e
 * ativa esta na MESMA transação — dois `.update()` sequenciais do
 * supabase-js não têm essa garantia.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("ativar_template_mensagem", { p_id: id })
      .single<MensagemTemplateAdmin>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("versao_nao_encontrada")) {
        throw erroNaoEncontrado("Versão de template não encontrada.");
      }
      if (pg.message.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/admin/templates/[id]/ativar POST", error, { template_id: id });
      throw error;
    }

    return NextResponse.json({ template: data });
  } catch (erro) {
    return respostaErro("api/admin/templates/[id]/ativar POST", erro);
  }
}
