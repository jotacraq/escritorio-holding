import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Replica em TS a lógica de `app.tem_consentimento` (migration 0005): o
 * consentimento VIGENTE é o último registro não revogado daquele tipo. Consultamos
 * a tabela direto (não via RPC) porque a função vive no schema `app`, que não é
 * necessariamente exposto ao PostgREST — isto funciona sempre, com service_role.
 *
 * DUAS CÓPIAS DO MESMO PREDICADO (nota do fable-orchestrator, Fase 10): esta
 * função e `app.tem_consentimento` (0005) precisam continuar idênticas — hoje
 * são. Se um dia a 0005 mudar a regra de "vigente" (ex.: passar a considerar
 * `expira_em`, ou desempatar por outro critério), ESTE arquivo tem que mudar
 * junto, ou o TS e o SQL divergem em silêncio: uma rota que checa aqui e uma
 * trigger que checa lá (ex.: `app.exige_decisao_copiloto_ao_vivo`, 0093)
 * podiam decidir coisas diferentes para a MESMA pessoa. Ver o comentário
 * espelhado em `supabase/migrations/0005_consentimentos.sql`.
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
