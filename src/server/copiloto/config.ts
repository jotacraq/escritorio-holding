import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";

/**
 * O interruptor 1 de 5 do plano de reversão (docs/ARQUITETURA-FASE-10.md
 * §2.5): `copiloto_sessao.ativo`. A descrição gravada em `configuracoes`
 * (0091) promete "com ele desligado a aba não aparece e nenhuma rota do
 * copiloto grava nada" — esta função é o que torna essa frase verdadeira.
 *
 * MESMA REGRA DURA de `lerConfigAgente` (agente-whatsapp/config.ts): chave
 * ausente, falha de leitura ou valor de outro tipo caem todos em `false`. O
 * copiloto desligado é o default E o estado seguro — nunca o contrário.
 */
export const CHAVE_COPILOTO_ATIVO = "copiloto_sessao.ativo";

export async function copilotoEstaAtivo(supabase: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(supabase, CHAVE_COPILOTO_ATIVO, false);
  } catch {
    // Falha de leitura NUNCA liga o copiloto — mesmo raciocínio do agente de WhatsApp.
    return false;
  }
}
