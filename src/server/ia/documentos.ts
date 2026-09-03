import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload de documento sensível — lógica reaproveitável. Vive aqui (não em
 * `src/app/api/documentos/route.ts` sozinho) para que a rota
 * `/api/jornadas/[id]/documentos` do BACK-CORE (fora da minha fronteira, mas
 * mencionada em `src/lib/api.ts` como o caminho que o front realmente chama)
 * possa importar a MESMA validação em vez de duplicá-la.
 *
 * Mime e tamanho são validados NO SERVIDOR (declarado + assinatura de bytes,
 * nunca só o Content-Type do cliente); o caminho é montado pelo servidor;
 * bucket privado. Precisa de um cliente `service_role` (Storage + tabela
 * `documentos` não têm policy de INSERT para `authenticated`).
 */

export const TAMANHO_MAXIMO_DOCUMENTO_BYTES = 20 * 1024 * 1024; // 20 MB — mesmo limite do bucket (0012)

const ASSINATURAS_MIME: Record<string, Buffer[]> = {
  "application/pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

export type TipoDocumento = "imposto_renda" | "contrato_social" | "matricula_imovel" | "outro";

export class ErroUploadDocumento extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = "ErroUploadDocumento";
  }
}

function assinaturaBate(bytes: Buffer, assinaturas: Buffer[]): boolean {
  return assinaturas.some((assinatura) => bytes.subarray(0, assinatura.length).equals(assinatura));
}

/** Remove path traversal e caracteres perigosos do nome original do arquivo. */
export function sanitizarNomeArquivo(nome: string): string {
  const base = nome.replace(/[/\\]/g, "_").replace(/\.\./g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-150) || "arquivo";
}

export interface ResultadoUploadDocumento {
  documentoId: string;
  caminho: string;
}

/**
 * Valida (tamanho, mime declarado, assinatura de bytes), sobe pro bucket
 * privado e registra a linha em `documentos`. Lança `ErroUploadDocumento` com
 * `.codigo` mapeável para status HTTP pelo chamador.
 */
export async function processarUploadDocumento(
  supabaseAdmin: SupabaseClient,
  params: {
    arquivo: File;
    pessoaId: string;
    jornadaId: string | null;
    tipo: TipoDocumento;
    enviadoPor: string | null;
  },
): Promise<ResultadoUploadDocumento> {
  const { arquivo, pessoaId, jornadaId, tipo, enviadoPor } = params;

  if (arquivo.size <= 0 || arquivo.size > TAMANHO_MAXIMO_DOCUMENTO_BYTES) {
    throw new ErroUploadDocumento("Tamanho de arquivo inválido.", "tamanho_invalido");
  }

  const assinaturas = ASSINATURAS_MIME[arquivo.type];
  if (!assinaturas) {
    throw new ErroUploadDocumento("Tipo de arquivo não permitido.", "mime_nao_permitido");
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  if (!assinaturaBate(bytes, assinaturas)) {
    throw new ErroUploadDocumento(
      "O conteúdo do arquivo não corresponde ao tipo declarado.",
      "conteudo_nao_corresponde_ao_mime",
    );
  }

  const documentoId = crypto.randomUUID();
  const nomeSanitizado = sanitizarNomeArquivo(arquivo.name || "arquivo");
  const caminho = `pessoas/${pessoaId}/${documentoId}/${nomeSanitizado}`;
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  const { error: erroUpload } = await supabaseAdmin.storage
    .from("documentos-sensiveis")
    .upload(caminho, bytes, { contentType: arquivo.type, upsert: false });

  if (erroUpload) {
    throw new ErroUploadDocumento(`Falha no upload: ${erroUpload.message}`, "falha_no_upload");
  }

  const { error: erroInsercao } = await supabaseAdmin.from("documentos").insert({
    id: documentoId,
    pessoa_id: pessoaId,
    jornada_id: jornadaId,
    tipo,
    nome_arquivo: nomeSanitizado,
    bucket: "documentos-sensiveis",
    caminho,
    mime: arquivo.type,
    tamanho_bytes: arquivo.size,
    sha256,
    enviado_por: enviadoPor,
  });

  if (erroInsercao) {
    await supabaseAdmin.storage.from("documentos-sensiveis").remove([caminho]);
    throw new ErroUploadDocumento(`Falha ao registrar documento: ${erroInsercao.message}`, "falha_ao_registrar");
  }

  return { documentoId, caminho };
}
