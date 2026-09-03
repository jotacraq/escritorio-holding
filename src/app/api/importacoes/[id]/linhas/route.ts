export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { ImportacaoLinha } from "@/types/importacao";

const TAMANHO_PAGINA = 200;

const FiltrosSchema = z.object({
  resultado: z
    .enum(["pessoa_nova", "pessoa_existente", "jornada_nova", "ignorada_jornada_aberta", "erro"])
    .optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});

/**
 * GET /api/importacoes/[id]/linhas — tabela de linhas da prévia (ou o
 * resultado já confirmado), paginada e filtrável por `resultado` — é isso que
 * a tela usa para mostrar "quantas pessoas novas, quantas já existem (e por
 * qual chave casaram), quantas têm erro e por quê" ANTES de confirmar.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel();

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Importação não encontrada.");
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(searchParams);

    const supabase = await criarClienteServidor();

    const { data: importacao, error: erroImportacao } = await supabase
      .from("importacoes")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (erroImportacao) throw erroImportacao;
    if (!importacao) throw erroNaoEncontrado("Importação não encontrada.");

    let query = supabase.from("importacoes_linhas").select("*", { count: "exact" }).eq("importacao_id", id);
    if (filtros.resultado) query = query.eq("resultado", filtros.resultado);

    const inicio = (filtros.pagina - 1) * TAMANHO_PAGINA;
    query = query.order("numero", { ascending: true }).range(inicio, inicio + TAMANHO_PAGINA - 1);

    const { data, error, count } = await query;
    if (error) {
      registrarErro("api/importacoes/[id]/linhas GET", error, { importacao_id: id, filtros });
      throw error;
    }

    return NextResponse.json({ itens: (data as ImportacaoLinha[] | null) ?? [], total: count ?? 0 });
  } catch (erro) {
    return respostaErro("api/importacoes/[id]/linhas GET", erro);
  }
}
