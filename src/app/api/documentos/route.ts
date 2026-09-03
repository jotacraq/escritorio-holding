import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroValidacao, respostaErro } from "@/server/erros";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroUploadDocumento, processarUploadDocumento } from "@/server/ia/documentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CamposSchema = z.object({
  pessoa_id: z.string().uuid(),
  jornada_id: z.string().uuid().optional(),
  tipo: z.enum(["imposto_renda", "contrato_social", "matricula_imovel", "outro"]),
});

const CODIGO_PARA_STATUS: Record<string, number> = {
  tamanho_invalido: 400,
  mime_nao_permitido: 400,
  conteudo_nao_corresponde_ao_mime: 400,
  falha_no_upload: 500,
  falha_ao_registrar: 500,
};

/**
 * POST /api/documentos — upload de documento sensível (IR, contrato social,
 * matrícula). Só admin/advogada. Nunca policy de INSERT direto no banco — é
 * sempre esta rota, com service_role (ver `processarUploadDocumento`).
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirVePatrimonio();

    const formData = await request.formData();
    const arquivo = formData.get("arquivo");
    if (!(arquivo instanceof File)) {
      throw erroValidacao(null, "Campo 'arquivo' ausente.");
    }

    const campos = CamposSchema.parse({
      pessoa_id: formData.get("pessoa_id"),
      jornada_id: formData.get("jornada_id") || undefined,
      tipo: formData.get("tipo"),
    });

    const supabaseAdmin = criarClienteAdmin();
    const resultado = await processarUploadDocumento(supabaseAdmin, {
      arquivo,
      pessoaId: campos.pessoa_id,
      jornadaId: campos.jornada_id ?? null,
      tipo: campos.tipo,
      enviadoPor: usuario.id,
    });

    return NextResponse.json({ documento_id: resultado.documentoId }, { status: 201 });
  } catch (erro) {
    if (erro instanceof ErroUploadDocumento) {
      return NextResponse.json(
        { erro: erro.codigo, mensagem: erro.message },
        { status: CODIGO_PARA_STATUS[erro.codigo] ?? 500 },
      );
    }
    return respostaErro("POST /api/documentos", erro);
  }
}
