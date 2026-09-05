export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { ErroApi, erroValidacao, respostaErro } from "@/server/erros";
import { estadoIntegracoes, testarIntegracao } from "@/server/integracoes/estado";
import type { RespostaIntegracoes } from "@/types/integracoes";

const CHAVES = ["resend", "hotmart", "cron", "ligacao_ia", "sala", "chatwoot", "ia"] as const;
const CorpoSchema = z.object({ chave: z.enum(CHAVES), acao: z.literal("testar").default("testar") });

function admin() {
  try {
    return criarClienteAdmin();
  } catch {
    throw new ErroApi(503, "servico_indisponivel", "SUPABASE_SERVICE_ROLE_KEY ausente — estado das integrações indisponível.");
  }
}

/**
 * GET /api/admin/integracoes — estado de cada integração (§2.6). Só admin.
 * NUNCA devolve valor de env var, nem tamanho: só nomes do que falta, os
 * toggles que são dado (`configuracoes`) e o último evento visto.
 */
export async function GET() {
  try {
    await exigirPapel("admin");
    const itens = await estadoIntegracoes(admin());
    const resposta: RespostaIntegracoes = { itens };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/admin/integracoes", erro);
  }
}

/** POST /api/admin/integracoes {chave, acao:'testar'} — atalho para `[chave]/testar`. */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );
    return NextResponse.json(await testarIntegracao(corpo.chave));
  } catch (erro) {
    return respostaErro("POST /api/admin/integracoes", erro);
  }
}
