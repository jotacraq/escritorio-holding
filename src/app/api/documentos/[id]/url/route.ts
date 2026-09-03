import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });
const EXPIRA_EM_SEGUNDOS = 300;

/**
 * GET /api/documentos/[id]/url — URL assinada de 300s. Metadados lidos com RLS
 * (a policy `doc_sel` já recusa quem não vê patrimônio); a assinatura em si e o
 * registro de auditoria usam service_role, porque o cliente nunca deve tocar o
 * Storage direto (a policy de storage é a SEGUNDA trava, não a primeira).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const { data: documento, error } = await supabase
      .from("documentos")
      .select("id, bucket, caminho")
      .eq("id", id)
      .maybeSingle<{ id: string; bucket: string; caminho: string }>();

    if (error) throw error;
    if (!documento) throw erroNaoEncontrado("Documento não encontrado.");

    const supabaseAdmin = criarClienteAdmin();
    const { data: assinada, error: erroAssinatura } = await supabaseAdmin.storage
      .from(documento.bucket)
      .createSignedUrl(documento.caminho, EXPIRA_EM_SEGUNDOS);

    if (erroAssinatura || !assinada) {
      throw new Error(`falha_ao_gerar_url_assinada: ${erroAssinatura?.message}`);
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { error: erroAuditoria } = await supabaseAdmin.from("documentos_acessos").insert({
      documento_id: documento.id,
      perfil_id: usuario.id,
      acao: "url_assinada",
      ip,
      user_agent: request.headers.get("user-agent"),
    });

    if (erroAuditoria) {
      // Não falha a entrega da URL por causa da auditoria, mas isto tem que
      // ficar visível — acesso a PII sem trilha não pode passar em silêncio.
      registrarErro("GET /api/documentos/[id]/url#auditoria", erroAuditoria, { documento_id: documento.id });
    }

    const expiraEm = new Date(Date.now() + EXPIRA_EM_SEGUNDOS * 1000).toISOString();
    return NextResponse.json({ url: assinada.signedUrl, expira_em: expiraEm });
  } catch (erro) {
    return respostaErro("GET /api/documentos/[id]/url", erro);
  }
}
