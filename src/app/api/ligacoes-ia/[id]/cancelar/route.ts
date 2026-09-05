export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, respostaErro } from "@/server/erros";
import type { LigacaoIa, RespostaLigacaoIa } from "@/types/integracoes";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/ligacoes-ia/[id]/cancelar — cancela uma ligação ainda `na_fila`
 * ou `discando`. Usa o cliente de SESSÃO de propósito: a policy `lia_cancel`
 * (0053) e o grant de coluna (`status`) são a trava real; a rota só traduz.
 * Ligação já atendida/encerrada → 409 `ligacao_nao_cancelavel`.
 * Nota: `discando` cancelada aqui não derruba a chamada na Vapi — o retorno
 * do n8n para uma ligação cancelada é ignorado (estado terminal).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");
    const { id } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();

    const { data: atual, error: erroBusca } = await supabase
      .from("ligacoes_ia")
      .select("id, status")
      .eq("id", id)
      .maybeSingle<{ id: string; status: LigacaoIa["status"] }>();
    if (erroBusca) throw erroBusca;
    if (!atual) throw erroNaoEncontrado("Ligação não encontrada.");
    if (atual.status !== "na_fila" && atual.status !== "discando") {
      throw erroConflito("ligacao_nao_cancelavel", `Ligação em '${atual.status}' não pode ser cancelada.`);
    }

    const { data, error } = await supabase
      .from("ligacoes_ia")
      .update({ status: "cancelada" })
      .eq("id", id)
      .in("status", ["na_fila", "discando"])
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23514" || error.code === "42501") {
        throw erroConflito("ligacao_nao_cancelavel", "A ligação mudou de estado e não pode mais ser cancelada.");
      }
      throw error;
    }
    if (!data) throw erroConflito("ligacao_nao_cancelavel", "A ligação mudou de estado e não pode mais ser cancelada.");

    const resposta: RespostaLigacaoIa = { ligacao: data as LigacaoIa };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/ligacoes-ia/[id]/cancelar", erro);
  }
}
