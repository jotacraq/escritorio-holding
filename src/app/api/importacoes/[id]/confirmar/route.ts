export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { Importacao } from "@/types/importacao";

/**
 * POST /api/importacoes/[id]/confirmar — fase 2. Só existe DEPOIS que o
 * operador viu a prévia (`GET /api/importacoes/[id]` + `.../linhas`). Delega
 * a escrita inteira para `public.confirmar_importacao` (RPC, transação
 * única — 0035): grava pessoa/jornada/participação de verdade, tolerante a
 * falha por linha isolada, nunca sobrescreve pessoa existente.
 *
 * Idempotência: a própria função recusa (`importacao_ja_processada`) se
 * `status <> 'previa'` — reenviar a confirmação (duplo clique, retry de rede)
 * nunca duplica pessoa/jornada.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Importação não encontrada.");
    }

    const supabase = await criarClienteServidor();
    // `confirmar_importacao` devolve `importacoes` (linha única, não SETOF) —
    // `.single()` desempacota, mesmo padrão de `registrar_briefing`/
    // `revogar_link_publico` já usado no resto do projeto.
    const { data, error } = await supabase
      .rpc("confirmar_importacao", { p_importacao_id: id })
      .single<Importacao>();

    if (error) {
      if (error.message?.includes("importacao_nao_encontrada")) {
        throw erroNaoEncontrado("Importação não encontrada.");
      }
      if (error.message?.includes("importacao_ja_processada")) {
        throw erroConflito(
          "importacao_ja_processada",
          "Esta importação já foi confirmada ou cancelada e não pode ser confirmada de novo.",
        );
      }
      if (error.message?.includes("sem_permissao_para_confirmar_importacao")) {
        throw erroConflito("sem_permissao", "Seu papel não tem permissão para confirmar importações.");
      }
      registrarErro("api/importacoes/[id]/confirmar POST", error, { importacao_id: id });
      throw error;
    }

    return NextResponse.json({ importacao: data as Importacao });
  } catch (erro) {
    return respostaErro("api/importacoes/[id]/confirmar POST", erro);
  }
}
