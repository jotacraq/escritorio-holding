export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirPapel } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { testarIntegracao } from "@/server/integracoes/estado";

const ParametroSchema = z.object({ chave: z.enum(["resend", "hotmart", "cron", "ligacao_ia", "sala", "chatwoot", "ia"]) });

/**
 * POST /api/admin/integracoes/[chave]/testar — chama o provedor com um evento
 * de teste e devolve o resultado cru resumido (HTTP status / código). Só admin
 * (`relacionamento` recebe 403). Nunca contém segredo.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ chave: string }> }) {
  try {
    await exigirPapel("admin");
    const { chave } = ParametroSchema.parse(await params);
    return NextResponse.json(await testarIntegracao(chave));
  } catch (erro) {
    return respostaErro("POST /api/admin/integracoes/[chave]/testar", erro);
  }
}
