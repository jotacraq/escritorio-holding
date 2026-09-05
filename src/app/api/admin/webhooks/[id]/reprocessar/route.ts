export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import { processarEventoHotmart } from "@/server/pagamentos/hotmart";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/admin/webhooks/[id]/reprocessar — reprocessa DE VERDADE, no clique
 * (§1.5): `public.reprocessar_webhook` (0027) zera `processado_em`/`erro` e soma
 * `tentativas`; em seguida `processarEventoHotmart` (o mesmo miolo da rota do
 * webhook) roda sobre o bruto já gravado. Evento de outra origem só é zerado —
 * a próxima reentrega do provedor reprocessa (todo webhook novo desta fase
 * testa `processado_em is null`).
 *
 * `service_role` é checado ANTES de zerar: sem ele o clique não pode deixar o
 * evento "zerado e não reprocessado" — responde 503 e nada muda.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: evento, error: erroLeitura } = await supabase
      .from("webhooks_eventos")
      .select("id, origem, assinatura_valida")
      .eq("id", id)
      .maybeSingle<{ id: string; origem: string; assinatura_valida: boolean }>();
    if (erroLeitura) throw erroLeitura;
    if (!evento) throw erroNaoEncontrado("Evento de webhook não encontrado.");

    if (!evento.assinatura_valida) {
      throw new ErroApi(409, "assinatura_invalida", "Evento com assinatura inválida nunca é reprocessado.");
    }

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("api/admin/webhooks/[id]/reprocessar#service_role", erroServiceRole, { evento_id: id });
      throw new ErroApi(503, "servico_indisponivel", "Reprocessar exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.");
    }

    const { error } = await supabase.rpc("reprocessar_webhook", { p_evento_id: id });
    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("evento_nao_encontrado")) throw erroNaoEncontrado("Evento de webhook não encontrado.");
      if (pg.message.startsWith("sem_permissao")) throw erroSemPermissao();
      registrarErro("api/admin/webhooks/[id]/reprocessar POST", error, { evento_id: id });
      throw error;
    }

    if (evento.origem !== "hotmart") {
      return NextResponse.json({ ok: true, reprocessado: false, motivo: "origem_sem_processador_local" });
    }

    const resultado = await processarEventoHotmart(admin, id, { forcar: true });
    return NextResponse.json({ ok: true, reprocessado: true, resultado });
  } catch (erro) {
    return respostaErro("api/admin/webhooks/[id]/reprocessar POST", erro);
  }
}
