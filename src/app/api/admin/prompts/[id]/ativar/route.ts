export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import type { PromptVersaoAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/admin/prompts/[id]/ativar — promove uma versão sem editar
 * `corpo_sistema`. Chama `public.ativar_prompt_versao` (0033), atômica: sem
 * isto, dois `.update()` sequenciais do supabase-js deixariam uma janela sem
 * NENHUM prompt ativo para a `chave` (a unique index parcial
 * `uniq_prompt_ativo` proibiria as duas ativas ao mesmo tempo, mas não
 * garante que sempre exista uma).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("ativar_prompt_versao", { p_id: id })
      .single<PromptVersaoAdmin>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("versao_nao_encontrada")) {
        throw erroNaoEncontrado("Versão de prompt não encontrada.");
      }
      if (pg.message.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/admin/prompts/[id]/ativar POST", error, { prompt_id: id });
      throw error;
    }

    return NextResponse.json({ prompt: data });
  } catch (erro) {
    return respostaErro("api/admin/prompts/[id]/ativar POST", erro);
  }
}
