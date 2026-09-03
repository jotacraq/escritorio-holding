export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface MensagemAgendadaLinha {
  id: string;
  status: string;
}

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/admin/mensagens/[id]/reenfileirar — ação sobre a pendência
 * "mensagem que não saiu". Chama `public.requeue_mensagem_falhada` (0033):
 * só existe porque a 0019 revogou UPDATE direto em `mensagens_agendadas` de
 * `authenticated` (a única porta de escrita hoje é `marcar_mensagem_manual`,
 * que só cobre WhatsApp pendente->enviada) — sem uma RPC nova, uma mensagem
 * `falhou` ficaria travada para sempre, sem rota, RLS ou cron que a resgate.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("requeue_mensagem_falhada", { p_id: id })
      .single<MensagemAgendadaLinha>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("mensagem_nao_encontrada")) {
        throw erroNaoEncontrado("Mensagem não encontrada.");
      }
      if (pg.message.startsWith("status_nao_falhou")) {
        throw erroConflito("status_nao_falhou", pg.message.replace(/^status_nao_falhou:\s*/, ""));
      }
      if (pg.message.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/admin/mensagens/[id]/reenfileirar POST", error, { mensagem_id: id });
      throw error;
    }

    return NextResponse.json({ mensagem: data });
  } catch (erro) {
    return respostaErro("api/admin/mensagens/[id]/reenfileirar POST", erro);
  }
}
