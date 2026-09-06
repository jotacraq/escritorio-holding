export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import type { Formulario } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/formularios/[id]/ativar — promove uma versão já publicada a oficial,
 * sem tocar em `definicao`. Espelho de `POST /api/roteiros/[id]/ativar`.
 *
 * A RPC `ativar_formulario_versao` (0078) desativa a anterior e ativa esta na
 * MESMA transação, e carimba `ativado_por`/`ativado_em` — o "quem decidiu que
 * esta é a oficial" que não existia em lugar nenhum do banco.
 *
 * As respostas já dadas não mudam: cada uma aponta para o `formulario_id` da
 * versão em que foi respondida.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.rpc("ativar_formulario_versao", { p_id: id }).single<Formulario>();

    if (error) {
      if (migracaoPendente(error)) {
        return respostaMigracaoPendente("0078", "ativar_formulario_versao não existe neste banco");
      }
      const pg = error as ErroPostgrest;
      if (pg.message?.startsWith("versao_nao_encontrada")) {
        throw erroNaoEncontrado("Versão de formulário não encontrada.");
      }
      if (pg.message?.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/formularios/[id]/ativar POST", error, { formulario_id: id });
      throw error;
    }

    return NextResponse.json({ formulario: data });
  } catch (erro) {
    return respostaErro("api/formularios/[id]/ativar POST", erro);
  }
}
