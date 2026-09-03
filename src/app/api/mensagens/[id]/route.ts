export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** O único uso desta rota hoje é a fila manual de WhatsApp marcando "enviei à mão". */
const CorpoSchema = z.object({ status: z.literal("enviada") });

interface MensagemAgendadaLinha {
  id: string;
  jornada_id: string;
  canal: "email" | "whatsapp";
  destinatario: string;
  agendada_para: string;
  status: "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";
  corpo_renderizado: string | null;
  erro: string | null;
  enviada_em: string | null;
}

/**
 * PATCH /api/mensagens/[id] — marca uma mensagem da fila manual de WhatsApp
 * como enviada à mão. `enviada_em` e `marcada_manual_por` são carimbados pelo
 * servidor (nunca aceitos do corpo) — são campo de auditoria, o cliente não
 * escolhe quem marcou nem quando.
 *
 * ALTO 1 (pentest 03/09/2026): a RLS `ma_upd` só exigia `app.eh_interno()`,
 * sem distinguir canal/estado — um PATCH direto no PostgREST conseguia trocar
 * `destinatario`/`status`/`enviada_em` de qualquer linha, inclusive
 * canal='email'. A regra de negócio agora vive só no banco, numa RPC
 * `security definer` (`public.marcar_mensagem_manual`, migration 0019) que é a
 * ÚNICA porta de escrita em `mensagens_agendadas` para `authenticated` — o
 * UPDATE direto na tabela foi revogado. Esta rota virou casca fina.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpoBruto = await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    });
    CorpoSchema.parse(corpoBruto);

    const supabase = await criarClienteServidor();

    const { data: atualizada, error } = await supabase
      .rpc("marcar_mensagem_manual", { p_id: id })
      .single<MensagemAgendadaLinha>();

    if (error) {
      if (error.message.startsWith("mensagem_nao_encontrada")) {
        throw erroNaoEncontrado("Mensagem não encontrada.");
      }
      if (error.message.startsWith("canal_nao_manual")) {
        throw erroConflito(
          "canal_nao_manual",
          "Só mensagens de WhatsApp podem ser marcadas como enviadas manualmente.",
        );
      }
      if (error.message.startsWith("status_nao_pendente")) {
        throw erroConflito("status_nao_pendente", error.message.replace(/^status_nao_pendente:\s*/, ""));
      }
      registrarErro("api/mensagens/[id] PATCH", error, { mensagem_id: id });
      throw error;
    }

    return NextResponse.json({ mensagem: atualizada });
  } catch (erro) {
    return respostaErro("api/mensagens/[id] PATCH", erro);
  }
}
