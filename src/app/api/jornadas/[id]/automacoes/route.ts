export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { listarAutomacoes } from "@/server/automacoes";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * GET /api/jornadas/[id]/automacoes — "o que o sistema fez" nesta jornada
 * (§8.2): régua de mensagens, ligação por IA, confirmação de presença e o
 * pagamento como marco, na mesma gramática.
 *
 * Toda a equipe interna vê (é o mesmo recorte de `mensagens_agendadas` e
 * `ligacoes_ia`, `eh_interno`): a view `vw_automacoes_jornada` roda com
 * `security_invoker` e não carrega valor de pagamento, payload de webhook,
 * transcrição, gravação, custo, destinatário nem corpo de mensagem.
 * Forma: `RespostaAutomacoes` (src/types/jornada-automacoes.ts).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();

    const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Jornada não encontrada.");

    return NextResponse.json(await listarAutomacoes(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/automacoes GET", erro);
  }
}
