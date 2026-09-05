export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { PapelEquipe } from "@/types/banco";

export interface PerfilMe {
  id: string;
  nome: string;
  papel: PapelEquipe;
  /** `null` = tour de primeira vez ainda não dispensado (0052, §6.3). */
  onboarding_visto_em: string | null;
}

function paraMe(perfil: { id: string; nome: string; papel: PapelEquipe; onboarding_visto_em?: string | null }): PerfilMe {
  return { id: perfil.id, nome: perfil.nome, papel: perfil.papel, onboarding_visto_em: perfil.onboarding_visto_em ?? null };
}

/** GET /api/equipe/me — o próprio perfil (sem e-mail/auth_user_id). */
export async function GET() {
  try {
    const usuario = await exigirInterno();
    return NextResponse.json(paraMe(usuario));
  } catch (erro) {
    return respostaErro("api/equipe/me GET", erro);
  }
}

const CorpoSchema = z.object({ onboarding_visto: z.literal(true) });

/**
 * PATCH /api/equipe/me `{onboarding_visto: true}` — grava `now()` UMA vez via
 * RPC `marcar_onboarding_visto` (security definer restrita a `auth.uid()`;
 * `pe_admin_write` não deixa não-admin editar a própria linha). Idempotente.
 */
export async function PATCH(request: NextRequest) {
  try {
    await exigirInterno();
    CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("marcar_onboarding_visto")
      .single<{ id: string; nome: string; papel: PapelEquipe; onboarding_visto_em: string | null }>();
    if (error) {
      registrarErro("api/equipe/me PATCH", error);
      throw error;
    }
    return NextResponse.json(paraMe(data));
  } catch (erro) {
    return respostaErro("api/equipe/me PATCH", erro);
  }
}
