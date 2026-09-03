export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClientePublico } from "@/server/publico/cliente";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, exigirOrigemPublica, LIMITE_CORPO_JSON_BYTES, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import type { ErroPublico, RespostaResponderFormularioPublico } from "@/types/publico";

const CorpoSchema = z.object({
  respostas: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: "`respostas` não pode ser vazio.",
  }),
  consentimentos: z
    .array(
      z.object({
        chave: z.enum(["tratamento_ia", "comunicacao_email", "comunicacao_whatsapp"]),
        versao: z.string().optional(), // aceito e IGNORADO pelo servidor — ver 0028.
      }),
    )
    .default([]),
  // Honeypot (§2.5): campo invisível ao humano. Nome combinado com o F-1A: `verificacao`.
  verificacao: z.string().optional(),
});

/**
 * POST /api/publico/[token]/formulario — POP 02 respondido pelo cliente, sem login.
 * Ordem: pepper -> Origin -> tamanho -> honeypot (descarte silencioso, 200 falso) ->
 * hash do token -> RPC `responder_formulario_publico` (única porta de escrita real).
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

    // Honeypot: bot preencheu um campo que nenhum humano vê. 200 falso-positivo
    // silencioso, registrado só no log — nunca um erro que ensine o bot a se ajustar.
    if (corpo.verificacao && corpo.verificacao.trim().length > 0) {
      registrarErro("POST /api/publico/[token]/formulario#honeypot", new Error("honeypot preenchido"), {
        token_prefixo: token.slice(0, 6),
      });
      const respostaFalsa: RespostaResponderFormularioPublico = { ok: true, respondido_em: new Date().toISOString() };
      return comCabecalhosPublicos(NextResponse.json(respostaFalsa, { status: 200 }));
    }

    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const supabase = criarClientePublico();
    const { data, error } = await supabase.rpc("responder_formulario_publico", {
      p_hash: hash,
      p_respostas: corpo.respostas,
      p_consentimentos: corpo.consentimentos,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });

    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpoErro: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpoErro, { status: statusParaErroPublico(data.erro) }));
    }

    return comCabecalhosPublicos(NextResponse.json(data as RespostaResponderFormularioPublico, { status: 200 }));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro("POST /api/publico/[token]/formulario", erro));
  }
}
