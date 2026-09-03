import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diz o que o SERVIDOR enxerga do ambiente — nunca o valor, só presença e
 * tamanho. Existe porque um deploy pode buildar limpo e mesmo assim subir sem
 * variável nenhuma, e sem isso o diagnóstico vira adivinhação.
 *
 * Protegido pelo mesmo CRON_SECRET do cron: sem o segredo, 404 (não 401 —
 * quem não tem a chave não precisa nem saber que esta rota existe).
 */
function iguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const VARIAVEIS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "IA_PROVEDOR",
  "ANTHROPIC_API_KEY",
  "HOTMART_WEBHOOK_SECRET",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "TZ",
] as const;

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const enviado = request.headers.get("x-cron-secret") ?? "";
  if (!segredo || !enviado || !iguais(segredo, enviado)) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({
    node: process.version,
    ambiente: process.env.NODE_ENV,
    diretorio: process.cwd(),
    variaveis: Object.fromEntries(
      VARIAVEIS.map((nome) => {
        const valor = process.env[nome];
        return [nome, valor ? `presente (${valor.length} chars)` : "AUSENTE"];
      }),
    ),
  });
}
