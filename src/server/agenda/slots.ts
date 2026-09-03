import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlotDisponivel } from "@/types/agenda";
import { CHAVE_HORIZONTE_DIAS_OFERTA, lerConfiguracaoInt } from "./config";

/**
 * Lista os horários livres da advogada num intervalo, chamando a RPC
 * `public.listar_slots_disponiveis` (0029), que por sua vez delega para
 * `app.slots_disponiveis` — derivado na consulta, nunca materializado (ver
 * ARQUITETURA-FASE-2.md §4.2 / §8 Escalabilidade).
 *
 * `de`/`ate` são opcionais: sem eles, a janela é "agora até o horizonte de
 * oferta configurado" (`configuracoes.agenda.horizonte_dias_oferta`) — nunca
 * um número de dias fixo no código.
 */
export async function listarSlotsDisponiveis(
  supabase: SupabaseClient,
  params: { advogadaId: string; de?: string; ate?: string },
): Promise<SlotDisponivel[]> {
  const de = params.de ?? new Date().toISOString();

  let ate = params.ate;
  if (!ate) {
    const horizonteDias = await lerConfiguracaoInt(supabase, CHAVE_HORIZONTE_DIAS_OFERTA, 21);
    ate = new Date(Date.now() + horizonteDias * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data, error } = await supabase.rpc("listar_slots_disponiveis", {
    p_advogada: params.advogadaId,
    p_de: de,
    p_ate: ate,
  });

  if (error) throw error;
  return (data ?? []) as SlotDisponivel[];
}
