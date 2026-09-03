export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/admin/webhooks/[id]/reprocessar — casca fina sobre
 * `public.reprocessar_webhook` (já existe desde 0027, ONDA 0): zera
 * `processado_em`/`erro` e soma `tentativas`. Não reprocessa aqui — quem
 * reprocessa de fato é o próximo passo manual (reenviar o webhook pela
 * Hotmart) ou, quando a rota `POST /api/webhooks/hotmart` passar a testar
 * `processado_em is null` no `on conflict` (nota da 0027, fora da minha
 * fronteira), a PRÓXIMA reentrega do mesmo evento.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { error } = await supabase.rpc("reprocessar_webhook", { p_evento_id: id });

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("evento_nao_encontrado")) {
        throw erroNaoEncontrado("Evento de webhook não encontrado.");
      }
      if (pg.message.startsWith("sem_permissao")) {
        throw erroSemPermissao();
      }
      registrarErro("api/admin/webhooks/[id]/reprocessar POST", error, { evento_id: id });
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return respostaErro("api/admin/webhooks/[id]/reprocessar POST", erro);
  }
}
