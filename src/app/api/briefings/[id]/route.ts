import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/briefings/[id] — usa o cliente com a sessão do usuário (RLS vale de
 * verdade): `relacionamento` lê o briefing mas não o custo (execucoes_ia é
 * recorte de quem vê patrimônio). Guard de sessão na rota + RLS no banco.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const { data: briefing, error } = await supabase
      .from("briefings")
      .select(
        "id, jornada_id, versao, conteudo, grau_confianca, fontes_usadas, modo_reduzido, atual, criado_em, " +
          "execucoes_ia(custo_usd, modelo, tokens_entrada, tokens_saida, prompt_versao_id, " +
          "prompts_versoes(chave, versao, titulo))",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!briefing) {
      // RLS pode estar escondendo a linha (papel sem acesso) ou ela não existir —
      // a rota nunca distingue os dois pro cliente, por design.
      throw erroNaoEncontrado("Briefing não encontrado.");
    }

    return NextResponse.json({ briefing });
  } catch (erro) {
    return respostaErro("GET /api/briefings/[id]", erro);
  }
}
