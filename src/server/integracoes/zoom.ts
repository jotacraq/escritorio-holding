import { APP_URL } from "@/lib/config-publica";
import { registrarErro } from "@/server/erros";

/**
 * Integração Zoom (bot autenticado / ZAK token) — pedido do João, 17/09/2026.
 * A conta Zoom da Dra. Elaine exige "Somente usuários autenticados" (travado
 * pelo admin da conta, não dá para desligar) — sem isto, TODO bot cai em
 * `meeting_requires_sign_in` e a sessão fica sem transcrição.
 *
 * CONTRATO LIDO em docs.recall.ai/docs/zoom-signed-in-bots (WebFetch desta
 * rodada, 17/09/2026 — não suposto, e citado literalmente abaixo porque
 * `retention` já custou uma sessão real por ter sido assumido em vez de
 * medido, ver o comentário de topo de `recall.ts`):
 *
 *   1. App OAuth no Zoom Marketplace com escopo `user:read:zak` (default) —
 *      o dono já criou.
 *   2. Gerar a URL de autorização:
 *        https://zoom.us/oauth/authorize
 *          ?response_type=code&client_id=<ZOOM_CLIENT_ID>&redirect_uri=<...>
 *   3. O usuário autoriza uma vez → Zoom devolve `?code=` no redirect.
 *   4. Trocar o `code` por uma credencial na RECALL (caminho recomendado —
 *      evita nós guardarmos refresh token do Zoom):
 *        POST https://us-east-1.recall.ai/api/v2/zoom-oauth-credentials/
 *        Authorization: Token <RECALL_API_KEY>
 *        { "oauth_app": "<id do app OAuth cadastrado na Recall>",
 *          "authorization_code": { "code": "<code>", "redirect_uri": "<...>" } }
 *        -> 200 { "id": "<credential_id>" }         (guardamos só este id)
 *   5. Ao criar o bot: `zoom.zak_url` no corpo de `POST /api/v2/bot/` — uma
 *      URL NOSSA que devolve o ZAK em **texto puro** (a doc é explícita:
 *      "returns the ZAK token as a plain text HTTP response"). A Recall
 *      chama essa URL quando precisa, inclusive DURANTE a reunião — o
 *      pseudocódigo oficial da doc é um handler HTTP que valida a
 *      requisição e devolve `HttpResponse(body=zak_token)`, sem envelope
 *      JSON.
 *   6. Para obter o ZAK a cada chamada: primeiro um access token FRESCO da
 *      credencial guardada na Recall —
 *        GET https://us-east-1.recall.ai/api/v2/zoom-oauth-credentials/{id}/access-token/
 *        Authorization: Token <RECALL_API_KEY>
 *        -> 200 { "access_token": "..." }
 *      depois o ZAK em si, direto na API do Zoom, com esse access token:
 *        GET https://api.zoom.us/v2/users/me/zak
 *        Authorization: Bearer <access_token>
 *        -> 200 { "token": "<zak>" }
 *
 * 🔴 A doc avisa: "o Zoom pode devolver ZAK mesmo com o access_token
 * expirado" — por isso este módulo NUNCA usa "gerou token sem erro" como
 * prova de credencial fresca; é só um encadeamento de chamadas, sem cache
 * nem suposição de validade.
 *
 * `oauth_app` (o id do App OAuth do Zoom DENTRO da Recall, não o
 * ZOOM_CLIENT_ID) precisa existir previamente no painel da Recall — é
 * cadastro manual do dono, fora do escopo de código (mesma natureza do
 * `RECALL_API_KEY`).
 */

const RECALL_BASE_URL = "https://us-east-1.recall.ai/api/v2";
const ZOOM_OAUTH_BASE_URL = "https://zoom.us/oauth";
const ZOOM_API_BASE_URL = "https://api.zoom.us/v2";
const TIMEOUT_MS = 15_000;

/** As 3 envs desta integração — nenhum valor default, nenhum valor de
 * exemplo (mesma lição de `resgate_codigo` hardcoded, 11/09): ausência é
 * ausência, tratada explicitamente por quem chama. */
export function zoomOAuthConfigurado(): boolean {
  return Boolean(
    process.env.ZOOM_CLIENT_ID?.trim() &&
      process.env.ZOOM_CLIENT_SECRET?.trim() &&
      process.env.RECALL_API_KEY?.trim() &&
      process.env.RECALL_ZOOM_OAUTH_APP_ID?.trim(),
  );
}

function redirectUri(): string {
  return `${APP_URL}/api/integracoes/zoom/callback`;
}

/** Passo 2 do contrato — URL para onde `GET /api/integracoes/zoom/iniciar` redireciona. */
export function montarUrlAutorizacaoZoom(): string | null {
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  if (!clientId) return null;

  const url = new URL(`${ZOOM_OAUTH_BASE_URL}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  return url.toString();
}

export type ResultadoTrocaCredencial =
  | { situacao: "criada"; credentialId: string }
  | { situacao: "falha_provedor"; detalhe: string }
  | { situacao: "nao_configurado" };

/**
 * Passo 4 — troca o `code` recebido no callback por uma credencial GUARDADA
 * PELA RECALL. Nunca vemos/guardamos access_token nem refresh_token do Zoom
 * em si — só o `credential_id` opaco que a Recall devolve.
 */
export async function trocarCodigoPorCredencialRecall(code: string): Promise<ResultadoTrocaCredencial> {
  if (!zoomOAuthConfigurado()) return { situacao: "nao_configurado" };

  const corpo = {
    oauth_app: process.env.RECALL_ZOOM_OAUTH_APP_ID,
    authorization_code: { code, redirect_uri: redirectUri() },
  };

  let resposta: Response;
  try {
    resposta = await fetch(`${RECALL_BASE_URL}/zoom-oauth-credentials/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.RECALL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    registrarErro("integracoes/zoom.trocarCodigoPorCredencialRecall#rede", erro);
    return { situacao: "falha_provedor", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  // 🔴 17/09: o corpo da resposta É o diagnóstico. A Recall devolve, em texto,
  // QUAL das três causas ocorreu — credencial errada no painel dela, código já
  // usado/expirado, ou redirect_uri divergente — e repassa a mensagem original
  // do Zoom junto. Registrar só o status (`recall_400`) descartava exatamente
  // a informação que resolve o problema, e deixou o dono tentando às cegas.
  const bruto = await resposta.text().catch(() => "");
  let corpoResposta: { id?: string } | null = null;
  try {
    corpoResposta = bruto ? (JSON.parse(bruto) as { id?: string }) : null;
  } catch {
    corpoResposta = null;
  }

  if (!resposta.ok || !corpoResposta?.id) {
    registrarErro("integracoes/zoom.trocarCodigoPorCredencialRecall#http", new Error(`recall_${resposta.status}`), {
      // Truncado: a resposta de erro da Recall é curta (uma frase), mas o
      // teto evita que um HTML de proxy encha a tabela de erros.
      resposta_recall: bruto.slice(0, 600),
    });
    return { situacao: "falha_provedor", detalhe: `recall_${resposta.status}` };
  }

  return { situacao: "criada", credentialId: corpoResposta.id };
}

export type ResultadoZak =
  | { situacao: "obtido"; zak: string }
  | { situacao: "sem_credencial" }
  | { situacao: "falha_provedor"; detalhe: string }
  | { situacao: "nao_configurado" };

/**
 * Passo 6 completo — access token fresco na Recall, depois o ZAK no Zoom.
 * Chamada A CADA requisição de `GET /api/integracoes/zoom/zak`: nunca cacheia
 * (a doc avisa que "gerou token" não prova frescor; e o ZAK em si é de uso
 * curto).
 */
export async function obterZak(credentialId: string): Promise<ResultadoZak> {
  if (!zoomOAuthConfigurado()) return { situacao: "nao_configurado" };

  let respostaToken: Response;
  try {
    respostaToken = await fetch(`${RECALL_BASE_URL}/zoom-oauth-credentials/${encodeURIComponent(credentialId)}/access-token/`, {
      headers: { Authorization: `Token ${process.env.RECALL_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    registrarErro("integracoes/zoom.obterZak#rede_recall", erro, { credential_id: credentialId });
    return { situacao: "falha_provedor", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  if (respostaToken.status === 404) {
    // Credencial apagada/revogada do lado da Recall — estado esperado,
    // mesma categoria de "conta ainda não autorizada" para quem chama.
    return { situacao: "sem_credencial" };
  }

  const corpoToken = (await respostaToken.json().catch(() => null)) as { access_token?: string } | null;
  if (!respostaToken.ok || !corpoToken?.access_token) {
    registrarErro("integracoes/zoom.obterZak#http_recall", new Error(`recall_${respostaToken.status}`), { credential_id: credentialId });
    return { situacao: "falha_provedor", detalhe: `recall_${respostaToken.status}` };
  }

  let respostaZak: Response;
  try {
    respostaZak = await fetch(`${ZOOM_API_BASE_URL}/users/me/zak`, {
      headers: { Authorization: `Bearer ${corpoToken.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    registrarErro("integracoes/zoom.obterZak#rede_zoom", erro, { credential_id: credentialId });
    return { situacao: "falha_provedor", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  const corpoZak = (await respostaZak.json().catch(() => null)) as { token?: string } | null;
  if (!respostaZak.ok || !corpoZak?.token) {
    registrarErro("integracoes/zoom.obterZak#http_zoom", new Error(`zoom_${respostaZak.status}`), { credential_id: credentialId });
    return { situacao: "falha_provedor", detalhe: `zoom_${respostaZak.status}` };
  }

  return { situacao: "obtido", zak: corpoZak.token };
}

/** A URL exata a usar em `PedirBotParams` (recall.ts) quando a sala é Zoom —
 * inclui o segredo compartilhado como query param, mesmo mecanismo do
 * webhook de transcrição (`server/sala/assinatura.ts::segredosIguais`, o
 * schema de bot do Recall não tem campo de headers customizados para
 * `zoom.zak_url`, então não é escolha entre HMAC e query param, é entre
 * query param e nada). `null` sem `ZOOM_ZAK_WEBHOOK_SECRET` configurado. */
export function montarZakUrlComSegredo(): string | null {
  const segredo = process.env.ZOOM_ZAK_WEBHOOK_SECRET?.trim();
  if (!segredo) return null;
  return `${APP_URL}/api/integracoes/zoom/zak?k=${encodeURIComponent(segredo)}`;
}

export function zakWebhookConfigurado(): boolean {
  return Boolean(process.env.ZOOM_ZAK_WEBHOOK_SECRET?.trim());
}

/** Detecta se o link de sala é do Zoom — só nesse caso `zoom.zak_url` entra
 * no corpo de criação do bot (§ do plano: mandar em bot de Meet é ruído, e a
 * API pode recusar). Casa `zoom.us` e subdomínios (ex.: `us02web.zoom.us`). */
export function linkEhZoom(linkSala: string): boolean {
  try {
    const host = new URL(linkSala).hostname.toLowerCase();
    return host === "zoom.us" || host.endsWith(".zoom.us");
  } catch {
    return false;
  }
}
