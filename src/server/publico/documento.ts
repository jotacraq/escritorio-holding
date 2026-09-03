import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload público de documento reaproveita o caminho já auditado do upload interno
 * (`src/server/ia/documentos.ts`, fora da minha fronteira) — mesmo bucket privado,
 * mesma exigência de mime por ASSINATURA DE BYTES (nunca só `Content-Type`), mesmo
 * `sanitizarNomeArquivo`. As duas constantes de assinatura abaixo são uma cópia
 * pequena e deliberada (não uma importação) porque `ASSINATURAS_MIME` e
 * `assinaturaBate` não são exportadas daquele arquivo — evita editar um arquivo que
 * não é meu só para expor duas constantes. Se isso incomodar na revisão, é um
 * refactor de 5 minutos: exportar as duas de lá e apagar a cópia daqui.
 */
const ASSINATURAS_MIME_PUBLICO: Record<string, Buffer[]> = {
  "application/pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

const EXTENSAO_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export const TAMANHO_MAXIMO_DOCUMENTO_PUBLICO_BYTES = 20 * 1024 * 1024; // 20 MB, §2.4
export const LIMITE_ARQUIVOS_POR_LINK = 5; // §2.4

export function mimeSuportadoPublico(mime: string): boolean {
  return mime in ASSINATURAS_MIME_PUBLICO;
}

export function assinaturaDeBytesBate(bytes: Buffer, mimeDeclarado: string): boolean {
  const assinaturas = ASSINATURAS_MIME_PUBLICO[mimeDeclarado];
  if (!assinaturas) return false;
  return assinaturas.some((assinatura) => bytes.subarray(0, assinatura.length).equals(assinatura));
}

export function extensaoPorMime(mime: string): string {
  return EXTENSAO_POR_MIME[mime] ?? "bin";
}

/** Mesmo saneamento de `src/server/ia/documentos.ts#sanitizarNomeArquivo`, sem depender do import. */
export function nomeArquivoPublico(mime: string): string {
  return `documento.${extensaoPorMime(mime)}`;
}

export interface LinkParaUpload {
  linkId: string;
  jornadaId: string;
  pessoaId: string;
}

/**
 * Resolve `token_hash` -> pessoa_id usando `service_role` (bypassa RLS — necessário
 * porque `links_publicos`/`jornadas` não têm policy para `anon`, e esta consulta
 * precisa rodar ANTES do upload, só para montar o caminho `pessoas/{pessoa_id}/...`
 * do Storage, que segue a MESMA convenção do upload interno, 0012).
 *
 * NÃO é a validação de negócio (rate limit, estado, expiração, remarcação, dedupe) —
 * essa validação, completa, é feita de novo por `registrar_documento_publico` (a RPC
 * `security definer`, chamada DEPOIS do upload) — porque a regra de negócio do link
 * vive no banco, não na rota. Esta função só existe pela fronteira técnica real: o
 * schema `app` (onde vive `app.resolve_link_escrita`) não é exposto pelo PostgREST,
 * então nenhum cliente JS — nem com `service_role` — consegue chamá-lo. E a resposta
 * pública de `abrir_link_publico` nunca traz `pessoa_id` (regra dura 4, §2.2) — de
 * propósito, para não vazar UUID interno ao NAVEGADOR. Aqui é o SERVIDOR, não o
 * navegador, lendo a tabela diretamente com uma chave que só o processo Next.js tem.
 * Por isso a checagem abaixo é deliberadamente mínima: só o suficiente para decidir
 * se vale a pena gastar upload de bytes, nunca a fonte de verdade final.
 */
export async function resolverLinkParaUpload(
  supabaseAdmin: SupabaseClient,
  tokenHash: string,
): Promise<LinkParaUpload | null> {
  const { data: link, error: erroLink } = await supabaseAdmin
    .from("links_publicos")
    .select("id, jornada_id, tipo, estado, expira_em")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (erroLink || !link) return null;
  if (link.tipo !== "documentos") return null;
  if (link.estado !== "ativo") return null;
  if (new Date(link.expira_em).getTime() <= Date.now()) return null;

  const { data: jornada, error: erroJornada } = await supabaseAdmin
    .from("jornadas")
    .select("id, pessoa_id, desfecho")
    .eq("id", link.jornada_id)
    .maybeSingle();

  if (erroJornada || !jornada || jornada.desfecho !== "aberta") return null;

  return { linkId: link.id as string, jornadaId: jornada.id as string, pessoaId: jornada.pessoa_id as string };
}

export function caminhoDocumentoPublico(pessoaId: string, documentoId: string, mime: string): string {
  return `pessoas/${pessoaId}/${documentoId}/${nomeArquivoPublico(mime)}`;
}

export function sha256DeBytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
