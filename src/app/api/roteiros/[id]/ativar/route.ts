export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import type { RoteiroVersao } from "@/types/roteiro";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/roteiros/[id]/ativar — promove uma versão sem editar `definicao`.
 * Chama `public.ativar_roteiro_versao` (0030), atômica (mesmo padrão de
 * `ativar_prompt_versao`, 0033). É o mecanismo do BLOQUEIO B15: quando a Dra.
 * Elaine carimbar qual guia é a oficial, ativar aquela versão é isto — as
 * sessões já conduzidas com a v4 mantêm `roteiro_versao_id` inalterado.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("ativar_roteiro_versao", { p_id: id })
      .single<RoteiroVersao>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("versao_nao_encontrada")) {
        throw erroNaoEncontrado("Versão de roteiro não encontrada.");
      }
      if (pg.message.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/roteiros/[id]/ativar POST", error, { roteiro_id: id });
      throw error;
    }

    return NextResponse.json({ roteiro: data });
  } catch (erro) {
    return respostaErro("api/roteiros/[id]/ativar POST", erro);
  }
}
