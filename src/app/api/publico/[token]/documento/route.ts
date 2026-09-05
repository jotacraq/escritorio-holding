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
  tetoDoMinutoJaBatido,
} from "@/server/publico/documento";
import {
  invalidarRadarDoLink,
  itensDeColetaDoLinkEmCache,
  resolverEnvio,
} from "@/server/publico/documentos-pedidos";
import { TIPOS_DOCUMENTO } from "@/server/ia/documentos";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import type { ErroPublico, RespostaRegistrarDocumentoPublico } from "@/types/publico";

/**
 * O campo `tipo` do multipart deixou de ser um enum fechado: ele carrega ou a
 * **chave pública de um item do radar** (o caminho novo, que gruda o arquivo no
 * imóvel/familiar certo) ou um **tipo cru** (o caminho antigo). Quem decide
 * qual é qual é `resolverEnvio`, contra a lista que o SERVIDOR acabou de
 * derivar — o navegador nunca escolhe `item_ref`.
 *
 * O zod aqui só impede que uma string absurda chegue ao resolvedor; a validação
 * de verdade é o casamento com o radar, e depois o `check` e a conferência de
 * dono dentro de `registrar_documento_publico` (0068).
 */
const CamposSchema = z.object({
  tipo: z.string().trim().min(1).max(64),
});

const TIPOS_VALIDOS: ReadonlySet<string> = new Set<string>(TIPOS_DOCUMENTO);

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
 * comentário em `resolverLinkParaUpload`) -> **pré-checagem de rate limit** ->
 * teto de 5 arquivos -> radar (em cache) -> upload ao bucket -> RPC
 * `registrar_documento_publico` (fonte de verdade real: rate limit, estado do link,
 * teto de 5 arquivos, dedupe por sha256) -> se a RPC recusar, remove o objeto do
 * bucket (mesmo padrão de limpeza de `src/server/ia/documentos.ts#processarUploadDocumento`).
 *
 * ## O que a 0069 mudou nessa ordem (achado BAIXO do pentest da Fase 5)
 *
 * O trabalho caro vinha ANTES da única trava de taxa. `resolverLinkParaUpload` +
 * `count(documentos)` + o radar (~5 consultas `service_role`) + **o upload ao
 * Storage** rodavam antes de `registrar_documento_publico`, onde vivem
 * `app.limite_rota_ok`/`app.limite_token_ok`. Um portador de token válido gerava
 * N uploads e 5N consultas por minuto sem o teto contar: a RPC recusava e a rota
 * apagava o objeto, mas o custo já tinha sido pago.
 *
 * Duas correções, nenhuma delas substituindo a RPC:
 *  1. `tetoDoMinutoJaBatido` — UMA consulta a `links_publicos_acessos` (índice
 *     `idx_links_acessos`) logo depois de resolver o link. Bateu o teto, devolve
 *     429 sem tocar em radar nem em Storage.
 *  2. o radar passa a vir de `itensDeColetaDoLinkEmCache` (60 s por `token_hash`),
 *     invalidado assim que um upload é gravado — o cartão do bem recém-enviado
 *     não continua pedindo o arquivo.
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

    // Portão barato de taxa, ANTES do radar e do Storage. Não consome cota e não
    // é a trava: `app.limite_token_ok` dentro da RPC continua sendo a fonte de
    // verdade (tabela `publico_rate_limit`). Aqui só se decide se vale gastar.
    if (await tetoDoMinutoJaBatido(admin, linkParaUpload.linkId)) {
      const corpo: ErroPublico = { erro: "limite_excedido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("limite_excedido") }));
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

    // O radar do SERVIDOR é quem diz o que este link pode receber e a que item
    // cada coisa pertence. Chave que não casa com nenhum item e não é um tipo
    // conhecido é recusada ANTES de gastar bytes de Storage.
    const itensDoRadar = await itensDeColetaDoLinkEmCache(admin, hash, linkParaUpload.jornadaId, pepper);
    const envio = resolverEnvio(campos.tipo, itensDoRadar, TIPOS_VALIDOS);
    if (!envio) {
      const corpo: ErroPublico = { erro: "arquivo_invalido" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico("arquivo_invalido") }));
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

    const argumentos = {
      p_hash: hash,
      p_tipo: envio.tipo,
      p_nome: nomeArquivoExibido,
      p_caminho: caminhoUpload,
      p_mime: arquivo.type,
      p_bytes: arquivo.size,
      p_sha256: sha256,
      p_ip_hash: ipHash,
      p_user_agent: userAgent,
    };

    // `p_item_ref` é revalidado NO BANCO contra a jornada deste link: item de
    // outra jornada vira NULL, nunca erro e nunca gravação errada (0068).
    let { data, error: erroRpc } = await admin.rpc("registrar_documento_publico", {
      ...argumentos,
      p_item_ref: envio.item_ref,
    });

    // Banco ainda sem a 0068: a assinatura de 10 parâmetros não existe e o
    // PostgREST responde "função não encontrada". Regrava sem `item_ref` em vez
    // de perder o arquivo que o cliente já subiu — é exatamente o estado de
    // antes desta costura, e o radar continua sem casar o item (nunca errado).
    if (erroRpc && (erroRpc.code === "PGRST202" || erroRpc.code === "42883")) {
      registrarErro("POST /api/publico/[token]/documento#sem_0068", erroRpc, { link_id: linkParaUpload.linkId });
      ({ data, error: erroRpc } = await admin.rpc("registrar_documento_publico", argumentos));
    }

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

    // O documento entrou: o radar daquele link mudou de estado agora, não daqui a
    // 60 s. Sem isto, o cartão do bem recém-enviado continuaria pedindo o arquivo.
    invalidarRadarDoLink(hash);

    return comCabecalhosPublicos(NextResponse.json(data as RespostaRegistrarDocumentoPublico, { status: 201 }));
  } catch (erro) {
    if (admin && caminhoUpload) {
      await admin.storage.from(BUCKET).remove([caminhoUpload]).catch(() => {});
    }
    return comCabecalhosPublicos(respostaErro("POST /api/publico/[token]/documento", erro));
  }
}
