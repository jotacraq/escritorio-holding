export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { usuarioAtual } from "@/server/auth";
import { registrarErro } from "@/server/erros";
import { trocarCodigoPorCredencialRecall, zoomOAuthConfigurado } from "@/server/integracoes/zoom";

/**
 * GET /api/integracoes/zoom/callback — bot autenticado no Zoom (17/09/2026).
 * Redirect URL cadastrada no Zoom Marketplace (o dono confirmou o valor:
 * `https://escritorio.grupoparticipa.app.br/api/integracoes/zoom/callback`).
 *
 * 🔴 CONTRATO NÃO NEGOCIÁVEL (pedido explícito): esta rota TEM DE RESPONDER
 * 200 mesmo ANTES de existir qualquer credencial e mesmo SEM `?code=` na
 * query — o Zoom valida a URL de redirect ao cadastrar o app fazendo uma
 * requisição a ela, e uma 404/erro nessa validação foi o problema real que
 * o dono viu hoje. Por isso o `try/catch` cobre TUDO e o "sem `code`" é um
 * ramo de sucesso HTTP (200), não um erro — a MENSAGEM na tela é que muda.
 *
 * Troca o `code` com a Recall (`POST /api/v2/zoom-oauth-credentials/`,
 * caminho recomendado pela doc — evita este sistema guardar token do Zoom) e
 * grava só o `credential_id` opaco devolvido, em `integracoes_zoom`
 * (singleton, 0113). Tela de sucesso/erro simples — HTML mínimo, sem design
 * system: é vista uma vez, pelo admin, fora do fluxo normal do produto.
 */

function paginaHtml(titulo: string, mensagem: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 640px; margin: 64px auto; padding: 0 16px;">
<h1>${titulo}</h1>
<p>${mensagem}</p>
</body></html>`;
}

function respostaHtml(titulo: string, mensagem: string, status = 200) {
  return new NextResponse(paginaHtml(titulo, mensagem), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const code = new URL(request.url).searchParams.get("code");

    // Validação do Zoom ao cadastrar a redirect URL (sem `code`) — 200
    // honesto, sem tocar credencial nenhuma. NUNCA 404 aqui (era o defeito
    // que o dono viu).
    if (!code) {
      return respostaHtml(
        "Integração com o Zoom",
        "Esta é a URL de retorno da autorização do Zoom para o Assistente do Escritório. Nada a fazer aqui diretamente — inicie a autorização em Admin → Integrações.",
      );
    }

    // Só admin/advogada pode concluir a autorização — mesma trava de quem
    // pode iniciar (`/iniciar`). Sessão pode não existir aqui (o navegador
    // saiu para o Zoom e voltou): se não houver usuário interno logado,
    // devolve 200 com mensagem clara, nunca 401 cru (o Zoom não interpretaria).
    const usuario = await usuarioAtual();
    if (!usuario || (usuario.papel !== "admin" && usuario.papel !== "advogada")) {
      return respostaHtml(
        "Sessão necessária",
        "Você precisa estar logado como administrador ou advogada para concluir a autorização do Zoom. Faça login no sistema e inicie a autorização de novo em Admin → Integrações.",
      );
    }

    if (!zoomOAuthConfigurado()) {
      registrarErro("GET /api/integracoes/zoom/callback", new Error("ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET/RECALL_API_KEY/RECALL_ZOOM_OAUTH_APP_ID ausentes"));
      return respostaHtml(
        "Integração não configurada",
        "O servidor ainda não tem as credenciais desta integração configuradas. Fale com a equipe técnica.",
        503,
      );
    }

    const resultado = await trocarCodigoPorCredencialRecall(code);

    if (resultado.situacao === "nao_configurado") {
      return respostaHtml(
        "Integração não configurada",
        "O servidor ainda não tem as credenciais desta integração configuradas. Fale com a equipe técnica.",
        503,
      );
    }
    if (resultado.situacao === "falha_provedor") {
      return respostaHtml(
        "Não foi possível concluir a autorização",
        "O Zoom ou a Recall não responderam como esperado. Tente autorizar de novo em Admin → Integrações; se persistir, fale com a equipe técnica.",
        502,
      );
    }

    const admin = criarClienteAdmin();
    const { error: erroUpsert } = await admin.from("integracoes_zoom").upsert(
      {
        id: 1,
        recall_credential_id: resultado.credentialId,
        autorizado_por_email: usuario.email,
        autorizado_em: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (erroUpsert) {
      registrarErro("GET /api/integracoes/zoom/callback#upsert", erroUpsert);
      return respostaHtml(
        "Autorização feita, mas não registrada",
        "O Zoom autorizou o acesso, mas o servidor não conseguiu gravar a credencial. Fale com a equipe técnica antes de usar o bot em salas do Zoom.",
        500,
      );
    }

    return respostaHtml(
      "Zoom autorizado",
      "A conta Zoom foi autorizada com sucesso. O bot já pode entrar em salas do Zoom com autenticação exigida. Você pode fechar esta janela.",
    );
  } catch (erro) {
    registrarErro("GET /api/integracoes/zoom/callback#inesperado", erro);
    return respostaHtml(
      "Erro inesperado",
      "Não foi possível concluir a autorização. Tente de novo em Admin → Integrações; se persistir, fale com a equipe técnica.",
      500,
    );
  }
}
