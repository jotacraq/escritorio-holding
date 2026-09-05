import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroValidacao, respostaErro , ErroApi , registrarErro } from "@/server/erros";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroUploadDocumento, processarUploadDocumento, TIPOS_DOCUMENTO } from "@/server/ia/documentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CamposSchema = z.object({
  pessoa_id: z.string().uuid(),
  jornada_id: z.string().uuid().optional(),
  // Os 10 tipos da 0065 (radar de documentos). A lista vive em um lugar só,
  // no servidor — a rota não redigita a união.
  tipo: z.enum(TIPOS_DOCUMENTO as unknown as [string, ...string[]]),
  /**
   * `documentos.item_ref` (0065) — a qual bem/familiar o documento pertence.
   * Vem do radar, é um uuid de `patrimonio_itens`/`familiares`. Validado como
   * uuid para não virar campo de texto livre gravado em tabela de PII; a
   * autorização continua sendo a mesma da rota (`exigirVePatrimonio`) e da
   * RLS de `documentos` — item de outra pessoa não passa a ser visível por
   * estar referenciado aqui.
   */
  item_ref: z.string().uuid().optional(),
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
      item_ref: formData.get("item_ref") || undefined,
    });

    // Sem SUPABASE_SERVICE_ROLE_KEY isto e configuracao ausente, nao falha do

    // sistema: responde 503 dizendo o que falta, em vez de 500 generico que

    // polui o log de erro real e esconde a causa de quem for triar.

    let supabaseAdmin: ReturnType<typeof criarClienteAdmin>;

    try {

      supabaseAdmin = criarClienteAdmin();

    } catch (erroServiceRole) {

      registrarErro("src/app/api/documentos/route.ts#service_role_ausente", erroServiceRole);

      throw new ErroApi(503, "servico_indisponivel", "Upload de documento exige SUPABASE_SERVICE_ROLE_KEY — indisponivel agora.");

    }
    const resultado = await processarUploadDocumento(supabaseAdmin, {
      arquivo,
      pessoaId: campos.pessoa_id,
      jornadaId: campos.jornada_id ?? null,
      tipo: campos.tipo as Parameters<typeof processarUploadDocumento>[1]["tipo"],
      enviadoPor: usuario.id,
      itemRef: campos.item_ref ?? null,
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
