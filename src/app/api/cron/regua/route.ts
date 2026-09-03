import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { processarFilaRegua } from "@/server/regua/processar";
import { registrarErro } from "@/server/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comparação em tempo constante — mesmo padrão do webhook Hotmart. */
function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/cron/regua — disparado pelo cron do painel Hostinger (a cada 5 min),
 * nunca por pg_cron (ARQUITETURA.md §5.1). Fail-CLOSED: sem CRON_SECRET
 * configurado, 503 — nunca processa a fila sem segredo definido.
 */
export async function POST(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    registrarErro("POST /api/cron/regua", new Error("CRON_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const header = request.headers.get("x-cron-secret");
  if (!header || !segredosIguais(header, segredo)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  try {
    const supabaseAdmin = criarClienteAdmin();
    const resultado = await processarFilaRegua(supabaseAdmin);
    return NextResponse.json(resultado, { status: 200 });
  } catch (erro) {
    registrarErro("POST /api/cron/regua", erro);
    return NextResponse.json({ erro: "falha_ao_processar_fila" }, { status: 500 });
  }
}
