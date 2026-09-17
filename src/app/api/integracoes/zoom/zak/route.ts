export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { segredosIguais } from "@/server/sala/assinatura";
import { criarLimitador, ipDaRequisicao } from "@/server/integracoes/rate-limit";
import { obterZak, zakWebhookConfigurado } from "@/server/integracoes/zoom";

/**
 * GET /api/integracoes/zoom/zak — bot autenticado no Zoom (17/09/2026).
 * Esta é a `zoom.zak_url` que `pedirBot()` (recall.ts) manda ao criar um bot
 * em sala do Zoom. A Recall chama esta URL sozinha, sem sessão de usuário —
 * inclusive DURANTE a reunião (o pseudocódigo oficial da doc mostra um
 * handler HTTP puro: valida a requisição, devolve o token em texto).
 *
 * 🔒 MESMO MECANISMO do webhook de transcrição
 * (`api/webhooks/copiloto/transcricao/route.ts`): segredo em `?k=`,
 * comparado em TEMPO CONSTANTE (`segredosIguais`, `server/sala/assinatura.ts`)
 * — o schema de `zoom.zak_url` na doc da Recall é só uma URL string, sem
 * campo de headers customizados, então não é escolha entre HMAC e query
 * param, é entre query param e nada (mesmo raciocínio já registrado no
 * webhook de transcrição).
 *
 * Segredo PRÓPRIO (`ZOOM_ZAK_WEBHOOK_SECRET`), NUNCA `COPILOTO_WEBHOOK_SECRET`
 * reaproveitado — um vazamento aqui não deve comprometer o outro canal
 * (mesma regra da casa aplicada no webhook de transcrição).
 *
 * Resposta: **texto puro** (`Content-Type: text/plain`), nunca JSON — a doc
 * é explícita ("returns the ZAK token as a plain text HTTP response"); um
 * envelope JSON faria a Recall tentar usar `{"token":"..."}` como se fosse o
 * próprio ZAK.
 *
 * Fail-closed: sem `ZOOM_ZAK_WEBHOOK_SECRET` → 503. `?k=` errado → 401. Sem
 * credencial Zoom cadastrada ainda → 404 (estado esperado antes da 1ª
 * autorização, não erro de servidor).
 */

const limitePorIp = criarLimitador(120);

export async function GET(request: NextRequest) {
  const ip = ipDaRequisicao(request.headers);
  if (limitePorIp(ip)) return new Response("rate_limited", { status: 429 });

  if (!zakWebhookConfigurado()) {
    registrarErro("GET /api/integracoes/zoom/zak", new Error("ZOOM_ZAK_WEBHOOK_SECRET ausente"));
    return new Response("servico_indisponivel", { status: 503 });
  }

  const segredo = process.env.ZOOM_ZAK_WEBHOOK_SECRET!.trim();
  const chaveRecebida = new URL(request.url).searchParams.get("k") ?? "";
  if (!segredosIguais(chaveRecebida, segredo)) {
    return new Response("nao_autorizado", { status: 401 });
  }

  let admin;
  try {
    admin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("GET /api/integracoes/zoom/zak#service_role", erro);
    return new Response("servico_indisponivel", { status: 503 });
  }

  const { data, error } = await admin
    .from("integracoes_zoom")
    .select("recall_credential_id")
    .eq("id", 1)
    .maybeSingle<{ recall_credential_id: string | null }>();

  if (error) {
    registrarErro("GET /api/integracoes/zoom/zak#leitura", error);
    return new Response("erro_interno", { status: 500 });
  }

  if (!data?.recall_credential_id) {
    // Estado esperado antes da 1ª autorização — não é `registrarErro`.
    return new Response("conta_zoom_nao_autorizada", { status: 404 });
  }

  const resultado = await obterZak(data.recall_credential_id);

  if (resultado.situacao === "nao_configurado") {
    return new Response("servico_indisponivel", { status: 503 });
  }
  if (resultado.situacao === "sem_credencial") {
    return new Response("conta_zoom_nao_autorizada", { status: 404 });
  }
  if (resultado.situacao === "falha_provedor") {
    return new Response("falha_provedor", { status: 502 });
  }

  // Texto puro — nunca JSON. É o corpo que a Recall repassa cru ao Zoom.
  return new Response(resultado.zak, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
