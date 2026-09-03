import { NextResponse } from "next/server";
import { APP_URL } from "@/lib/config-publica";
import { ErroApi } from "@/server/erros";

/** §2.5 — corpo das rotas JSON públicas, no máximo 1 MB. Upload de documento tem limite próprio. */
export const LIMITE_CORPO_JSON_BYTES = 1_000_000;

/**
 * §2.5 — `POST` exige `Origin` igual a `NEXT_PUBLIC_APP_URL`. Tolerante à AUSÊNCIA do
 * cabeçalho (alguns clientes same-origin legítimos não o enviam) — o que rejeita é um
 * `Origin` PRESENTE e DIFERENTE, que é o sinal real de requisição forjada de outro site.
 */
export function exigirOrigemPublica(request: Request): void {
  const origem = request.headers.get("origin");
  if (origem && origem !== APP_URL) {
    throw new ErroApi(403, "origem_nao_autorizada", "Origem não autorizada para esta requisição.");
  }
}

/**
 * Cabeçalhos obrigatórios de TODA resposta pública (§2.5): nunca cacheia, nunca
 * indexa, nunca vaza referrer para fora do link. Aplicado tanto no sucesso quanto
 * no erro — inclusive por cima de `respostaErro()`, que não os define sozinha.
 */
export function comCabecalhosPublicos(resposta: NextResponse): NextResponse {
  resposta.headers.set("Cache-Control", "no-store");
  resposta.headers.set("X-Robots-Tag", "noindex, nofollow");
  resposta.headers.set("Referrer-Policy", "no-referrer");
  return resposta;
}

/** IP e User-Agent só entram como sinal de auditoria (nunca de autorização — §2.2 achado BAIXO 6). */
export function lerSinaisDeRequisicao(request: Request): { ip: string | null; userAgent: string | null } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = request.headers.get("user-agent");
  return { ip, userAgent };
}
