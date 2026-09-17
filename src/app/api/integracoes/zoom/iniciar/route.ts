export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { exigirVePatrimonio } from "@/server/auth";
import { ErroApi, respostaErro } from "@/server/erros";
import { zoomOAuthConfigurado, montarUrlAutorizacaoZoom } from "@/server/integracoes/zoom";

/**
 * GET /api/integracoes/zoom/iniciar — bot autenticado no Zoom (17/09/2026).
 * Gera a URL de autorização OAuth do Zoom (docs.recall.ai/docs/zoom-signed-in-bots,
 * §2 do contrato lido — ver comentário de topo de `server/integracoes/zoom.ts`)
 * e redireciona o navegador do admin para lá. A conta que autoriza é decisão
 * de QUEM CLICA (login do Zoom aberto no navegador na hora), não deste código
 * — o dono decidiu usar `apoio@csmholding.com.br`, uma conta dedicada, para o
 * bot nunca aparecer na sala com o nome de outra pessoa da mesma organização.
 *
 * `exigirVePatrimonio()`: mesma trava de quem pode pedir bot na sala
 * (`POST .../copiloto/bot`) — autorizar a conta Zoom é operação de
 * configuração de sistema, não de uso comum.
 */
export async function GET() {
  try {
    await exigirVePatrimonio();

    if (!zoomOAuthConfigurado()) {
      throw new ErroApi(503, "servico_indisponivel", "A integração com o Zoom não está configurada no servidor.");
    }

    const url = montarUrlAutorizacaoZoom();
    if (!url) {
      throw new ErroApi(503, "servico_indisponivel", "A integração com o Zoom não está configurada no servidor.");
    }

    return NextResponse.redirect(url, 302);
  } catch (erro) {
    return respostaErro("GET /api/integracoes/zoom/iniciar", erro);
  }
}
