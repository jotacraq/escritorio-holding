import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPapel } from "@/server/auth";
import { respostaErro , ErroApi , registrarErro } from "@/server/erros";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { gerarBriefing } from "@/server/ia/briefing";
import { ErroIa } from "@/server/ia/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CorpoSchema = z.object({
  jornada_id: z.string().uuid(),
  forcar_regeracao: z.boolean().optional(),
});

/**
 * POST /api/briefings/gerar — gera o Briefing Estratégico (Protocolo 01) para
 * uma jornada. 202 com os ids de execução/briefing; nunca devolve um briefing
 * de exemplo. Guard de papel na rota (`exigirPapel`) + RLS no banco — as duas
 * camadas.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const corpo = CorpoSchema.parse(await request.json());

    // Sem SUPABASE_SERVICE_ROLE_KEY isto e configuracao ausente, nao falha do

    // sistema: responde 503 dizendo o que falta, em vez de 500 generico que

    // polui o log de erro real e esconde a causa de quem for triar.

    let supabaseAdmin: ReturnType<typeof criarClienteAdmin>;

    try {

      supabaseAdmin = criarClienteAdmin();

    } catch (erroServiceRole) {

      registrarErro("src/app/api/briefings/gerar/route.ts#service_role_ausente", erroServiceRole);

      throw new ErroApi(503, "servico_indisponivel", "Geração de briefing exige SUPABASE_SERVICE_ROLE_KEY — indisponivel agora.");

    }
    const resultado = await gerarBriefing(supabaseAdmin, {
      jornadaId: corpo.jornada_id,
      criadoPor: usuario.id,
      forcarRegeracao: corpo.forcar_regeracao,
    });

    return NextResponse.json(
      { execucao_id: resultado.execucaoId, briefing_id: resultado.briefingId },
      { status: 202 },
    );
  } catch (erro) {
    if (erro instanceof ErroIa) {
      return NextResponse.json({ erro: erro.codigo, mensagem: erro.message }, { status: erro.status });
    }
    return respostaErro("POST /api/briefings/gerar", erro);
  }
}
