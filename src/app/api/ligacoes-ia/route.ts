export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import type { LigacaoIa, RespostaListarLigacoesIa } from "@/types/integracoes";

const STATUS = ["na_fila", "discando", "em_ligacao", "concluida", "sem_resposta", "falhou", "cancelada"] as const;
const QuerySchema = z.object({
  status: z.enum(STATUS).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  /** Cursor: `criado_em` do último item da página anterior (ISO). */
  antes_de: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /api/ligacoes-ia?status=&limite=&antes_de= — fila e histórico para o
 * Painel/Comunicação (RLS `lia_sel`: toda a equipe lê). Paginado por cursor.
 * A transcrição vem junto (mesma posição de `ligacoes_estrategicas`).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

    const supabase = await criarClienteServidor();
    let consulta = supabase.from("ligacoes_ia").select("*").order("criado_em", { ascending: false }).limit(query.limite);
    if (query.status) consulta = consulta.eq("status", query.status);
    if (query.antes_de) consulta = consulta.lt("criado_em", query.antes_de);

    const { data, error } = await consulta;
    if (error) throw error;
    const resposta: RespostaListarLigacoesIa = { itens: (data ?? []) as LigacaoIa[] };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/ligacoes-ia", erro);
  }
}
