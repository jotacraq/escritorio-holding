import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirInterno } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/jornadas/[id]/briefings — histórico de versões do Briefing.
 *
 * A tela pedia esta rota desde o MVP e ela nunca existiu: `chamarOpcional()`
 * engolia o 404 e o histórico simplesmente não aparecia, sem erro na tela e
 * sem nada no console que denunciasse a falta. Encontrada varrendo as
 * respostas HTTP da produção com o navegador, não pelo build.
 *
 * Cliente COM SESSÃO de propósito (RLS vale de verdade): `relacionamento` lê o
 * briefing, mas o custo mora em `execucoes_ia`, que é recorte de quem vê
 * patrimônio — por isso esta rota não devolve custo nem conteúdo, só a régua
 * de versões. Mesma decisão de `GET /api/briefings/[id]`.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("briefings")
      .select("id, versao, grau_confianca, criado_em, atual, modo_reduzido, completude_entrada")
      .eq("jornada_id", id)
      .order("versao", { ascending: false });

    if (error) throw error;

    // Lista vazia é resposta legítima: jornada sem briefing gerado ainda. A
    // tela mostra o estado real; não é 404 nem erro.
    return NextResponse.json({ itens: data ?? [] });
  } catch (erro) {
    return respostaErro("GET /api/jornadas/[id]/briefings", erro);
  }
}
