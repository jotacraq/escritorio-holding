import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";

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

/**
 * Os 10 valores que `documentos.tipo` aceita depois da 0065 (M2, radar de
 * documentos). Os seis últimos entraram com o CHECK alargado — sem eles, um
 * CRLV ou uma certidão de casamento pedidos pelo radar não teriam onde ser
 * gravados, e o item ficaria `a_pedir` para sempre mesmo com o arquivo no
 * Storage. A validação continua em três camadas: enum na rota, esta união no
 * servidor e o CHECK no banco.
 */
export type TipoDocumento =
  | "imposto_renda"
  | "contrato_social"
  | "matricula_imovel"
  | "certidao_casamento"
  | "certidao_nascimento"
  | "crlv"
  | "extrato_investimento"
  | "balanco"
  | "comprovante_residencia"
  | "outro";

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  "imposto_renda",
  "contrato_social",
  "matricula_imovel",
  "certidao_casamento",
  "certidao_nascimento",
  "crlv",
  "extrato_investimento",
  "balanco",
  "comprovante_residencia",
  "outro",
] as const;

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
    /**
     * A qual bem/familiar o documento pertence (`patrimonio_itens.id` /
     * `familiares.id`) — `documentos.item_ref`, coluna da 0065. Sem ele, o
     * radar não consegue casar "3 matrículas soltas" com 3 imóveis e o item
     * fica `a_pedir` com arquivo no Storage (`src/lib/radar/derivar.ts`: o
     * casamento é exato ou não existe). `null` = documento sem item.
     */
    itemRef?: string | null;
  },
): Promise<ResultadoUploadDocumento> {
  const { arquivo, pessoaId, jornadaId, tipo, enviadoPor, itemRef = null } = params;

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

  // A mensagem do provedor NUNCA vai para o cliente. Erro cru de Storage/
  // Postgres nomeia bucket, caminho (que contém `pessoas/<uuid>`), política e
  // às vezes a versão do PostgREST — é reconhecimento de infraestrutura de
  // graça, entregue a quem só conseguiu fazer um upload falhar. O texto real
  // fica em `erros_servidor` (`registrarErro`, mesmo padrão de `respostaErro`)
  // com um id correlacionável; o cliente recebe uma frase humana e acionável.
  if (erroUpload) {
    registrarErro("server/ia/documentos.processarUploadDocumento#upload", erroUpload, {
      pessoa_id: pessoaId,
      jornada_id: jornadaId,
      tipo,
    });
    throw new ErroUploadDocumento(
      "Não foi possível guardar o arquivo agora. Tente de novo em instantes.",
      "falha_no_upload",
    );
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
    // Antes da 0065 a coluna não existe: `undefined` some do payload do
    // PostgREST, então o insert continua funcionando no banco antigo.
    item_ref: itemRef ?? undefined,
  });

  if (erroInsercao) {
    await supabaseAdmin.storage.from("documentos-sensiveis").remove([caminho]);
    registrarErro("server/ia/documentos.processarUploadDocumento#registrar", erroInsercao, {
      pessoa_id: pessoaId,
      jornada_id: jornadaId,
      tipo,
      documento_id: documentoId,
    });
    throw new ErroUploadDocumento(
      "O arquivo subiu, mas não foi possível registrá-lo. O envio foi desfeito — tente de novo.",
      "falha_ao_registrar",
    );
  }

  return { documentoId, caminho };
}
