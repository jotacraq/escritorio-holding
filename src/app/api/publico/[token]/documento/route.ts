export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, exigirOrigemPublica, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { statusParaErroPublico, ehRespostaDeErro } from "@/server/publico/rpc";
import {
  assinaturaDeBytesBate,
  caminhoDocumentoPublico,
  LIMITE_ARQUIVOS_POR_LINK,
  mimeSuportadoPublico,
  resolverLinkParaUpload,
  sha256DeBytes,
  TAMANHO_MAXIMO_DOCUMENTO_PUBLICO_BYTES,
} from "@/server/publico/documento";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import type { ErroPublico, RespostaRegistrarDocumentoPublico } from "@/types/publico";

const CamposSchema = z.object({
  tipo: z.enum(["imposto_renda", "contrato_social", "matricula_imovel", "outro"]),
});

const BUCKET = "documentos-sensiveis";

/**
 * POST /api/publico/[token]/documento — upload público de documento. Reaproveita
 * INTEGRALMENTE o caminho já auditado do upload interno (mime por assinatura de
 * bytes, caminho montado pelo servidor, bucket privado — ver `src/server/publico/documento.ts`).
 *
 * Sem `SUPABASE_SERVICE_ROLE_KEY`, responde 503 ANTES de tocar em qualquer coisa —
 * o Storage só aceita escrita via `service_role`, e esta rota nunca finge sucesso.
 *
 * Ordem: pepper -> service_role -> Origin -> parse do multipart -> tamanho/mime/
 * assinatura -> resolve o link (leitura mínima, só para achar `pessoa_id` — ver
 * comentário em `resolverLinkParaUpload`) -> upload ao bucket -> RPC
 * `registrar_documento_publico` (fonte de verdade real: rate limit, estado do link,
 * teto de 5 arquivos, dedupe por sha256) -> se a RPC recusar, remove o objeto do
 * bucket (mesmo padrão de limpeza de `src/server/ia/documentos.ts#processarUploadDocumento`).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let admin: ReturnType<typeof criarClienteAdmin> | null = null;
  let caminhoUpload: string | null = null;

  try {
    const pepper = exigirPepper();

    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("POST /api/publico/[token]/documento#service_role_ausente", erroServiceRole);
      const corpo: ErroPublico = { erro: "envio_indisponivel" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: 503 }));
    }

    exigirOrigemPublica(request);

    const { token } = await params;
    const formData = await request.formData();
    const arquivo = formData.get("arquivo");
    if (!(arquivo instanceof File)) {
      throw new ErroApi(422, "validacao_invalida", "Campo 'arquivo' ausente.");
    }
    const campos = CamposSchema.parse({ tipo: formData.get("tipo") });

    if (arquivo.size <= 0 || arquivo.size > TAMANHO_MAXIMO_DOCUMENTO_PUBLICO_BYTES) {
      const corpo: ErroPublico = { erro: "arquivo_invalido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("arquivo_invalido") }));
    }
    if (!mimeSuportadoPublico(arquivo.type)) {
      const corpo: ErroPublico = { erro: "arquivo_invalido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("arquivo_invalido") }));
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    if (!assinaturaDeBytesBate(bytes, arquivo.type)) {
      const corpo: ErroPublico = { erro: "arquivo_invalido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("arquivo_invalido") }));
    }

    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);
    const ipHash = ip ? hashIp(ip, pepper) : null;

    // Leitura mínima server-side (service_role) só para achar `pessoa_id` e montar o
    // caminho do bucket — nunca a validação final. Ver comentário no helper.
    const linkParaUpload = await resolverLinkParaUpload(admin, hash);
    if (!linkParaUpload) {
      const corpo: ErroPublico = { erro: "link_invalido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: 404 }));
    }

    // Teto de 5 arquivos também checado aqui, antes do upload, para não gastar
    // bytes de Storage numa tentativa que a RPC vai recusar de qualquer jeito. A
    // RPC (`registrar_documento_publico`) reconfere com `usos`, que é a fonte real.
    const { count: jaEnviados } = await admin
      .from("documentos")
      .select("id", { count: "exact", head: true })
      .eq("jornada_id", linkParaUpload.jornadaId)
      .eq("origem", "cliente")
      .eq("ativo", true);
    if ((jaEnviados ?? 0) >= LIMITE_ARQUIVOS_POR_LINK) {
      const corpo: ErroPublico = { erro: "limite_arquivos_atingido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("limite_arquivos_atingido") }));
    }

    const documentoId = crypto.randomUUID();
    const sha256 = sha256DeBytes(bytes);
    caminhoUpload = caminhoDocumentoPublico(linkParaUpload.pessoaId, documentoId, arquivo.type);

    const { error: erroUpload } = await admin.storage
      .from(BUCKET)
      .upload(caminhoUpload, bytes, { contentType: arquivo.type, upsert: false });
    if (erroUpload) {
      registrarErro("POST /api/publico/[token]/documento#upload", erroUpload, { link_id: linkParaUpload.linkId });
      const corpo: ErroPublico = { erro: "envio_indisponivel" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: 503 }));
    }

    const nomeArquivoExibido = caminhoUpload.split("/").pop() ?? "documento";

    const { data, error: erroRpc } = await admin.rpc("registrar_documento_publico", {
      p_hash: hash,
      p_tipo: campos.tipo,
      p_nome: nomeArquivoExibido,
      p_caminho: caminhoUpload,
      p_mime: arquivo.type,
      p_bytes: arquivo.size,
      p_sha256: sha256,
      p_ip_hash: ipHash,
      p_user_agent: userAgent,
    });

    if (erroRpc) {
      await admin.storage.from(BUCKET).remove([caminhoUpload]);
      throw erroRpc;
    }

    if (ehRespostaDeErro(data)) {
      // A RPC recusou depois do upload (rate limit, link mudou de estado entre as
      // duas chamadas, teto de arquivos, duplicidade) — não deixa objeto órfão.
      await admin.storage.from(BUCKET).remove([caminhoUpload]);
      const corpo: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico(data.erro) }));
    }

    return comCabecalhosPublicos(NextResponse.json(data as RespostaRegistrarDocumentoPublico, { status: 201 }));
  } catch (erro) {
    if (admin && caminhoUpload) {
      await admin.storage.from(BUCKET).remove([caminhoUpload]).catch(() => {});
    }
    return comCabecalhosPublicos(respostaErro("POST /api/publico/[token]/documento", erro));
  }
}
