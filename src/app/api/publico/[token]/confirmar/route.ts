export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClientePublico } from "@/server/publico/cliente";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, exigirOrigemPublica, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { respostaErro } from "@/server/erros";
import type { ErroPublico, RespostaConfirmarPresencaPublico } from "@/types/publico";

/**
 * POST /api/publico/[token]/confirmar — o cliente confirma presença com um
 * toque (link `/p/c/[token]`, tipo `confirmacao`, 0050/0051). Sem corpo.
 * Idempotente: a segunda chamada devolve a mesma `confirmada_em`. Toda a
 * regra (rate limit, link válido, agendamento ativo, imutabilidade) vive na
 * RPC `confirmar_presenca_publico` — a rota só traduz `{erro}` em status.
 * Mesmo cliente `anon` das outras 4 rotas públicas (least privilege).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const pepper = exigirPepper();
    exigirOrigemPublica(request);

    const { token } = await params;
    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const supabase = criarClientePublico();
    const { data, error } = await supabase.rpc("confirmar_presenca_publico", {
      p_hash: hash,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });

    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpoErro: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpoErro, { status: statusParaErroPublico(data.erro) }));
    }

    return comCabecalhosPublicos(NextResponse.json(data as RespostaConfirmarPresencaPublico, { status: 200 }));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro("POST /api/publico/[token]/confirmar", erro));
  }
}
