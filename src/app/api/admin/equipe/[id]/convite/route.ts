export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro, ErroApi } from "@/server/erros";
import { enviarConviteEquipe } from "@/server/admin/convite";
import type { PerfilEquipeAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/admin/equipe/[id]/convite — reenvia o e-mail de convite para uma
 * linha que já existe (primeira tentativa falhou, ou `SUPABASE_SERVICE_ROLE_KEY`
 * acabou de ser preenchida — BLOQUEIO B17: "a maior alavanca isolada desta
 * noite"). Não cria linha nova; só repete o passo 2 de `POST /api/admin/equipe`.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: perfil, error } = await supabase
      .from("perfis_equipe")
      .select("*")
      .eq("id", id)
      .maybeSingle<PerfilEquipeAdmin>();

    if (error) {
      registrarErro("api/admin/equipe/[id]/convite POST#buscar", error, { perfil_id: id });
      throw error;
    }
    if (!perfil) throw erroNaoEncontrado("Perfil de equipe não encontrado.");

    const resultado = await enviarConviteEquipe(perfil);

    if (!resultado.enviado) {
      if (resultado.motivo === "service_role_ausente") {
        throw new ErroApi(
          503,
          "convite_email_indisponivel",
          "Envio de e-mail indisponível — entregue o acesso por fora.",
          { perfil },
        );
      }
      return NextResponse.json({ perfil, convite: resultado }, { status: 200 });
    }

    const agora = new Date().toISOString();
    const { data: atualizado, error: erroAtualizar } = await supabase
      .from("perfis_equipe")
      .update({ convite_enviado_em: agora })
      .eq("id", id)
      .select("*")
      .single<PerfilEquipeAdmin>();

    if (erroAtualizar) {
      registrarErro("api/admin/equipe/[id]/convite POST#carimbar", erroAtualizar, { perfil_id: id });
      return NextResponse.json(
        { perfil: { ...perfil, convite_enviado_em: agora }, convite: resultado },
        { status: 200 },
      );
    }

    return NextResponse.json({ perfil: atualizado, convite: resultado });
  } catch (erro) {
    return respostaErro("api/admin/equipe/[id]/convite POST", erro);
  }
}
