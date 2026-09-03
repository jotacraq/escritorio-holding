import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { gerarAnaliseCroqui } from "@/server/ia/croqui-analise";
import { ErroIa } from "@/server/ia/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  // Transcrição bruta da Sessão de Viabilidade. Mínimo alto de propósito: a
  // Agente do Croqui não deve rodar sobre um trecho curto e "alucinar" o resto.
  transcricao_sessao: z.string().min(200, "transcricao_sessao muito curta para uma análise responsável"),
});

/**
 * POST /api/croquis/[id]/analise — a SEGUNDA IA (Agente do Croqui), pós-SV.
 * Recebe a transcrição no corpo (nunca lida do banco) + dados de ficha já
 * registrados, devolve as 14 seções carimbadas por categoria. Só admin/advogada
 * — mesmo recorte de quem vê patrimônio, porque esta IA processa valor real.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const corpo = CorpoSchema.parse(await request.json());

    const supabaseAdmin = criarClienteAdmin();

    const { data: croqui, error: erroCroqui } = await supabaseAdmin
      .from("croquis")
      .select("id, jornada_id, jornadas(pessoa_id)")
      .eq("id", id)
      .maybeSingle<{ id: string; jornada_id: string; jornadas: { pessoa_id: string } | { pessoa_id: string }[] }>();

    if (erroCroqui) throw erroCroqui;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    const jornadaRelacionada = Array.isArray(croqui.jornadas) ? croqui.jornadas[0] : croqui.jornadas;
    if (!jornadaRelacionada) throw erroNaoEncontrado("Jornada da ficha não encontrada.");

    const resultado = await gerarAnaliseCroqui(supabaseAdmin, {
      croquiId: croqui.id,
      jornadaId: croqui.jornada_id,
      pessoaId: jornadaRelacionada.pessoa_id,
      transcricaoSessao: corpo.transcricao_sessao,
      criadoPor: usuario.id,
    });

    return NextResponse.json(
      {
        execucao_id: resultado.execucaoId,
        analise_id: resultado.analiseId,
        analise: resultado.analise,
        custo_usd: resultado.custoUsd,
      },
      { status: 201 },
    );
  } catch (erro) {
    if (erro instanceof ErroIa) {
      return NextResponse.json({ erro: erro.codigo, mensagem: erro.message }, { status: erro.status });
    }
    return respostaErro("POST /api/croquis/[id]/analise", erro);
  }
}
