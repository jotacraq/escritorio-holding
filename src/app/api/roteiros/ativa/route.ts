export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { RoteiroVersao } from "@/types/roteiro";

const QuerySchema = z.object({ chave: z.enum(["sessao_viabilidade", "pop_03", "pop_03b"]) });

/**
 * GET /api/roteiros/ativa?chave=sessao_viabilidade — atalho para a tela de
 * condução (F-3B) e a de ligação (POP 03/03-B): busca a versão ATIVA
 * completa (com `definicao`) sem precisar listar e filtrar no cliente.
 * 404 honesto se nenhuma versão estiver ativa para a chave (não deveria
 * acontecer — `uniq_roteiro_ativo` mais o seed da 0030 garantem uma sempre —
 * mas a rota nunca finge sucesso).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const parseChave = QuerySchema.safeParse({ chave: request.nextUrl.searchParams.get("chave") });
    if (!parseChave.success) {
      throw erroValidacao(parseChave.error.issues, "Parâmetro `chave` obrigatório e precisa ser válido.");
    }

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("roteiros_versoes")
      .select("*")
      .eq("chave", parseChave.data.chave)
      .eq("ativo", true)
      .maybeSingle<RoteiroVersao>();

    if (error) {
      registrarErro("api/roteiros/ativa GET", error, { chave: parseChave.data.chave });
      throw error;
    }
    if (!data) {
      throw erroNaoEncontrado(`Nenhuma versão ativa de roteiro para "${parseChave.data.chave}".`);
    }

    return NextResponse.json({ roteiro: data });
  } catch (erro) {
    return respostaErro("api/roteiros/ativa GET", erro);
  }
}
