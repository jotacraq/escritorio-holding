import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Replica em TS a lógica de `app.tem_consentimento` (migration 0005): o
 * consentimento VIGENTE é o último registro não revogado daquele tipo. Consultamos
 * a tabela direto (não via RPC) porque a função vive no schema `app`, que não é
 * necessariamente exposto ao PostgREST — isto funciona sempre, com service_role.
 */
export async function temConsentimento(
  supabaseAdmin: SupabaseClient,
  pessoaId: string,
  tipo: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("consentimentos")
    .select("concedido, revogado_em")
    .eq("pessoa_id", pessoaId)
    .eq("tipo", tipo)
    .order("concedido_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ concedido: boolean; revogado_em: string | null }>();

  if (error || !data) return false;
  return data.concedido === true && data.revogado_em === null;
}
