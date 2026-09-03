export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClientePublico } from "@/server/publico/cliente";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { respostaErro } from "@/server/erros";
import type { AberturaLinkPublico, ErroPublico } from "@/types/publico";

/**
 * GET /api/publico/[token] — resolve o link e devolve o escopo mínimo da finalidade
 * (§2.2 regra 4, §4.1). Erro único para todo caso ruim de token (regra 3): resolvido
 * inteiramente dentro de `abrir_link_publico` — esta rota só traduz `{erro}` em status.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const pepper = exigirPepper();
    const { token } = await params;
    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const supabase = criarClientePublico();
    const { data, error } = await supabase.rpc("abrir_link_publico", {
      p_hash: hash,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });

    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpo: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico(data.erro) }));
    }

    return comCabecalhosPublicos(NextResponse.json(data as AberturaLinkPublico, { status: 200 }));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro("GET /api/publico/[token]", erro));
  }
}
