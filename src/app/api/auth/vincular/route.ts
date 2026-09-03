export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { erroNaoAutenticado, registrarErro, respostaErro } from "@/server/erros";
import type { PerfilEquipe } from "@/types/banco";

/**
 * Casa o `auth.uid()` da sessão atual com a linha pré-autorizada em `perfis_equipe`
 * (mesmo e-mail, `auth_user_id is null`, `ativo`). Chamado uma vez após o primeiro
 * login — idempotente: se já estiver vinculado ou não houver convite, não faz nada.
 *
 * Quem se autentica sem convite continua com `app.papel() = null` depois disto —
 * RLS nega tudo, e este endpoint não cria perfil nenhum (fail-closed, por design).
 */
export async function POST() {
  try {
    const supabase = await criarClienteServidor();
    const {
      data: { user },
      error: erroAuth,
    } = await supabase.auth.getUser();

    if (erroAuth || !user) {
      throw erroNaoAutenticado();
    }

    const { error: erroRpc } = await supabase.rpc("vincular_perfil");
    if (erroRpc) {
      registrarErro("api/auth/vincular", erroRpc, { auth_user_id: user.id });
      throw erroRpc;
    }

    const { data: perfil, error: erroPerfil } = await supabase
      .from("perfis_equipe")
      .select("*")
      .eq("auth_user_id", user.id)
      .eq("ativo", true)
      .maybeSingle();

    if (erroPerfil) {
      registrarErro("api/auth/vincular", erroPerfil, { auth_user_id: user.id });
      throw erroPerfil;
    }

    const perfilTipado = perfil as PerfilEquipe | null;

    return NextResponse.json({
      vinculado: perfilTipado !== null,
      papel: perfilTipado?.papel ?? null,
    });
  } catch (erro) {
    return respostaErro("api/auth/vincular", erro);
  }
}
