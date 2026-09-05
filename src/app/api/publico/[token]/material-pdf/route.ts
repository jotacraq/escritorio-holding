export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { registrarErro, respostaErro } from "@/server/erros";
import { assinarUrlPdfMaterial } from "@/server/material/storage";
import type { ErroPublico } from "@/types/publico";

/**
 * GET /api/publico/[token]/material-pdf — botão "Baixar PDF" da página `/p/m`
 * (ARQUITETURA-FASE-4.md §3.3 "Entrega").
 *
 * Cadeia: pepper → service_role (503 antes de tocar em qualquer coisa) → RPC
 * `resolver_pdf_material_publico` (0055; service_role) que aplica o MESMO rate
 * limit, resolução e auditoria de `abrir_link_publico` e devolve só o caminho
 * do objeto do material ATUAL e APROVADO → `createSignedUrl(300 s)` → 302.
 *
 * O portador do token nunca vê caminho de bucket, jornada ou pessoa: só a URL
 * assinada, que expira em 5 minutos e força download com nome neutro. Erro
 * único `link_invalido` para todo token ruim (regra 3 da 0028);
 * `pdf_indisponivel` (409) só quando o material aprovado existe sem arquivo —
 * a página /p/m já mostra o material nesse caso, então nada novo vaza.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const contexto = "GET /api/publico/[token]/material-pdf";
  try {
    const pepper = exigirPepper();

    let admin: ReturnType<typeof criarClienteAdmin>;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro(`${contexto}#service_role_ausente`, erroServiceRole);
      // Mesmo código que o upload público usa para "sem service_role" (503).
      const corpo: ErroPublico = { erro: "envio_indisponivel" };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: 503 }));
    }

    const { token } = await params;
    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const { data, error } = await admin.rpc("resolver_pdf_material_publico", {
      p_hash: hash,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });
    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpo: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico(data.erro) }));
    }

    const caminho = (data as { caminho?: unknown } | null)?.caminho;
    if (typeof caminho !== "string" || caminho.length === 0) {
      throw new Error("resolver_pdf_material_publico devolveu resposta sem caminho");
    }

    const { url } = await assinarUrlPdfMaterial(admin, caminho);
    return comCabecalhosPublicos(NextResponse.redirect(url, 302));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro(contexto, erro));
  }
}
