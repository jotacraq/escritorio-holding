export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { LinkPublicoResumo, RespostaRevogarLinkPublico, TipoLinkPublico } from "@/types/publico";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface LinhaLinkPublico {
  id: string;
  tipo: TipoLinkPublico;
  estado: LinkPublicoResumo["estado"];
  token_prefixo: string;
  expira_em: string;
  usos: number;
  criado_em: string;
  revogado_em: string | null;
}

/**
 * POST /api/links/[id]/revogar — revogação manual pela equipe (§2.3). Idempotente:
 * revogar um link já revogado/expirado/usado só devolve o estado atual, sem erro.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");
    const { id: linkId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: linkBruto, error } = await supabase.rpc("revogar_link_publico", { p_link_id: linkId }).single<LinhaLinkPublico>();

    if (error) {
      if (error.code === "P0002") throw erroNaoEncontrado("Link não encontrado.");
      registrarErro("POST /api/links/[id]/revogar", error, { link_id: linkId });
      throw error;
    }

    const resposta: RespostaRevogarLinkPublico = {
      link: {
        id: linkBruto.id,
        tipo: linkBruto.tipo,
        estado: linkBruto.estado,
        token_prefixo: linkBruto.token_prefixo,
        expira_em: linkBruto.expira_em,
        usos: linkBruto.usos,
        criado_em: linkBruto.criado_em,
        revogado_em: linkBruto.revogado_em,
      },
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/links/[id]/revogar", erro);
  }
}
