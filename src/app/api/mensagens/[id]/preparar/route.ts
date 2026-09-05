export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirInterno } from "@/server/auth";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { resolverPlaceholdersDeEnvio, temPlaceholderSobrando } from "@/server/regua/placeholders";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface MensagemLinha {
  id: string;
  jornada_id: string;
  agendamento_id: string | null;
  canal: "email" | "whatsapp";
  status: string;
  corpo_renderizado: string | null;
}

/**
 * POST /api/mensagens/[id]/preparar — resolve `{{link_confirmacao}}`/
 * `{{link_sala}}`/`{{link_material}}` de uma mensagem PENDENTE da fila manual
 * de WhatsApp, congela o `corpo_renderizado` e devolve o texto pronto. O botão
 * "Copiar texto" da tela chama isto ANTES de copiar — placeholder literal
 * nunca chega ao cliente por nenhum canal (§1.2).
 *
 * Exige `service_role` (emitir link é RPC de sistema) — sem ele 503, nunca um
 * texto pela metade. Dado ausente (sala sem link) é 409 com código estável,
 * não 500.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: mensagem, error } = await supabase
      .from("mensagens_agendadas")
      .select("id, jornada_id, agendamento_id, canal, status, corpo_renderizado")
      .eq("id", id)
      .maybeSingle<MensagemLinha>();
    if (error) throw error;
    if (!mensagem) throw erroNaoEncontrado("Mensagem não encontrada.");

    if (mensagem.status !== "pendente") {
      throw erroConflito("status_nao_pendente", `Só mensagem pendente é preparada (esta está '${mensagem.status}').`);
    }

    const corpoAtual = mensagem.corpo_renderizado ?? "";
    if (!temPlaceholderSobrando(corpoAtual)) {
      return NextResponse.json({ corpo: corpoAtual, preparada: false });
    }

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("api/mensagens/[id]/preparar#service_role", erroServiceRole, { mensagem_id: id });
      throw new ErroApi(503, "servico_indisponivel", "Preparar a mensagem exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.");
    }

    const resolucao = await resolverPlaceholdersDeEnvio(admin, mensagem);
    if (!resolucao.ok) {
      throw erroConflito(resolucao.hold, resolucao.mensagem);
    }
    if (temPlaceholderSobrando(resolucao.corpo)) {
      throw erroConflito("template_com_placeholder_desconhecido", "O template tem um campo que o sistema não sabe preencher — corrija em Admin → Templates.");
    }

    // Congela o texto que será copiado (prova do que foi mandado, 0013). UPDATE
    // direto está revogado de `authenticated` (0019) — service_role.
    const { error: erroCongelar } = await admin
      .from("mensagens_agendadas")
      .update({ corpo_renderizado: resolucao.corpo })
      .eq("id", id)
      .eq("status", "pendente");
    if (erroCongelar) {
      registrarErro("api/mensagens/[id]/preparar#congelar", erroCongelar, { mensagem_id: id });
      throw erroCongelar;
    }

    return NextResponse.json({ corpo: resolucao.corpo, preparada: true });
  } catch (erro) {
    return respostaErro("api/mensagens/[id]/preparar POST", erro);
  }
}
