import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfiguracaoBool, lerConfiguracaoInt } from "@/server/ia/configuracao";
import type { ConfigPollingCopiloto } from "@/types/copiloto";

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

/**
 * `copiloto_sessao.polling_ms` — CORREÇÃO de achado do frontend/coordenador
 * na revisão desta fatia: a chave existe em `configuracoes` desde a 0091,
 * com descrição prometendo controlar o intervalo de polling da tela, mas
 * NENHUMA rota a expunha ao cliente — o front hardcodou 3000ms porque não
 * tinha de onde ler. "Reversão que não desliga não é reversão" (achado do
 * Fable na Fatia 1) tem o mesmo formato aqui: "ajuste que não ajusta". Esta
 * função é o que torna a chave real — `GET /api/sessoes/[id]/copiloto` a lê
 * a cada chamada e devolve no payload (`polling: ConfigPollingCopiloto`).
 *
 * `sem_foco_ms` NÃO tem chave própria — é SEMPRE derivado de `em_foco_ms`
 * (proporção ~10/3, calculada a partir do default 3000/10000), porque §4.1 do plano só descreve o valor "sem foco" como
 * mitigação automática (10s quando a aba perde foco), nunca como parâmetro
 * operacional independente. Criar uma 11ª chave sem decisão de negócio por
 * trás seria configuração de fachada — o oposto do que esta correção resolve.
 *
 * Falha de leitura ou valor inválido (não-inteiro, <= 0) NUNCA propaga: cai
 * no default gravado pela própria 0091 (3000ms) — mesmo raciocínio de
 * `copilotoEstaAtivo`, "não saber" cai no lado seguro, nunca quebra a rota.
 */
export const CHAVE_POLLING_MS = "copiloto_sessao.polling_ms";
const PADRAO_POLLING_MS_EM_FOCO = 3000;
// 3s em foco → 10s sem foco (§4.1: "mitigação de conforto") = fator ~3,33.
// SEMPRE derivado de em_foco_ms (banco OU default) — nunca uma 2ª constante
// solta que possa divergir do "3x" documentado (achado da 1ª versão deste
// módulo: o default caía em 3000/10000 mas o valor do banco caía em N/(N*3),
// duas contas diferentes para o mesmo conceito).
const FATOR_SEM_FOCO_X1000 = 10_000 / PADRAO_POLLING_MS_EM_FOCO; // = 10/3, calculado a partir do próprio default

function derivarSemFocoMs(emFocoMs: number): number {
  return Math.round(emFocoMs * FATOR_SEM_FOCO_X1000);
}

export async function lerConfigPollingCopiloto(supabase: SupabaseClient): Promise<ConfigPollingCopiloto> {
  try {
    const emFocoMs = await lerConfiguracaoInt(supabase, CHAVE_POLLING_MS, PADRAO_POLLING_MS_EM_FOCO);
    const valorValido = Number.isInteger(emFocoMs) && emFocoMs > 0;
    const emFocoFinal = valorValido ? emFocoMs : PADRAO_POLLING_MS_EM_FOCO;
    return { em_foco_ms: emFocoFinal, sem_foco_ms: derivarSemFocoMs(emFocoFinal) };
  } catch {
    return { em_foco_ms: PADRAO_POLLING_MS_EM_FOCO, sem_foco_ms: derivarSemFocoMs(PADRAO_POLLING_MS_EM_FOCO) };
  }
}
