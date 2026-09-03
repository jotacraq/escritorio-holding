export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClientePublico } from "@/server/publico/cliente";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, exigirOrigemPublica, LIMITE_CORPO_JSON_BYTES, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { ErroApi, respostaErro } from "@/server/erros";
import type { ErroPublico, RespostaEscolherHorarioPublico } from "@/types/publico";

const CorpoSchema = z.object({
  inicio_em: z.string().datetime({ offset: true }),
});

/**
 * POST /api/publico/[token]/horario — escolhe (ou remarca 1x, §2.3) um dos horários
 * REALMENTE ofertados no link (`agendamentos_sugestoes`, checado dentro da RPC).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const pepper = exigirPepper();
    exigirOrigemPublica(request);

    const tamanhoDeclarado = Number(request.headers.get("content-length") ?? "0");
    if (tamanhoDeclarado > LIMITE_CORPO_JSON_BYTES) {
      throw new ErroApi(413, "payload_muito_grande", "Corpo da requisição excede o limite.");
    }

    const { token } = await params;
    const corpoBruto = await request.json().catch(() => {
      throw new ErroApi(422, "validacao_invalida", "Corpo da requisição precisa ser JSON válido.");
    });
    const corpo = CorpoSchema.parse(corpoBruto);

    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const supabase = criarClientePublico();
    const { data, error } = await supabase.rpc("escolher_horario_publico", {
      p_hash: hash,
      p_inicio: corpo.inicio_em,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });

    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpoErro: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpoErro, { status: statusParaErroPublico(data.erro) }));
    }

    return comCabecalhosPublicos(NextResponse.json(data as RespostaEscolherHorarioPublico, { status: 200 }));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro("POST /api/publico/[token]/horario", erro));
  }
}
