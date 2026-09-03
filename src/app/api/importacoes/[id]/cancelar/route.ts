export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { Importacao } from "@/types/importacao";

/**
 * POST /api/importacoes/[id]/cancelar — abandona uma prévia (arquivo errado,
 * mapeamento errado). Nunca apaga a linha (sem DELETE em lugar nenhum deste
 * projeto): só marca `status='cancelada'`, e só a partir de `'previa'` —
 * confirmada não se cancela por aqui.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Importação não encontrada.");
    }

    const supabase = await criarClienteServidor();
    // `cancelar_importacao` devolve `importacoes` (linha única, não SETOF) —
    // `.single()` desempacota, mesmo padrão de `registrar_briefing`/
    // `revogar_link_publico` já usado no resto do projeto.
    const { data, error } = await supabase
      .rpc("cancelar_importacao", { p_importacao_id: id })
      .single<Importacao>();

    if (error) {
      if (error.message?.includes("importacao_nao_encontrada_ou_ja_processada")) {
        throw erroConflito(
          "importacao_nao_encontrada_ou_ja_processada",
          "Importação não encontrada ou já saiu do estado de prévia (não pode mais ser cancelada).",
        );
      }
      if (error.message?.includes("sem_permissao_para_cancelar_importacao")) {
        throw erroConflito("sem_permissao", "Seu papel não tem permissão para cancelar importações.");
      }
      registrarErro("api/importacoes/[id]/cancelar POST", error, { importacao_id: id });
      throw error;
    }

    return NextResponse.json({ importacao: data as Importacao });
  } catch (erro) {
    return respostaErro("api/importacoes/[id]/cancelar POST", erro);
  }
}
