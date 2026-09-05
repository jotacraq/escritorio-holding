import type { SupabaseClient } from "@supabase/supabase-js";
import { processarFilaLigacoesIa, reaperLigacoesIa } from "@/server/ligacao-ia";
import { canalWhatsappViaChatwoot } from "@/server/chatwoot/canal";
import { enviarWhatsapp } from "@/server/chatwoot/cliente";

/**
 * Módulos de OUTROS agentes da Onda 1 que o cron e a régua consomem (contratos
 * §9 (iii) e §2.5 do plano):
 *   - `@/server/ligacao-ia` (agente B): `processarFilaLigacoesIa(admin)` e
 *     `reaperLigacoesIa(admin)`;
 *   - `@/server/chatwoot/*` (agente B): `canalWhatsappViaChatwoot(admin)` decide
 *     se a régua pode enviar WhatsApp sozinha; `enviarWhatsapp` envia.
 * Os módulos já existem na árvore (entregues por B na mesma onda); a
 * tolerância a falha fica no cron (`rodarEtapa`, cada etapa isolada) e, aqui,
 * em `carregarChatwoot` (não configurado → fila manual intacta).
 */

export interface ResultadoEtapaExterna {
  pulada?: "modulo_ausente" | "nao_configurado";
  erro?: string;
  [chave: string]: unknown;
}

export async function etapaLigacoesIa(admin: SupabaseClient): Promise<ResultadoEtapaExterna> {
  return (await processarFilaLigacoesIa(admin)) as unknown as ResultadoEtapaExterna;
}

export async function etapaReaperLigacoesIa(admin: SupabaseClient): Promise<ResultadoEtapaExterna> {
  return (await reaperLigacoesIa(admin)) as unknown as ResultadoEtapaExterna;
}

export interface ClienteChatwoot {
  enviarWhatsapp: (params: { telefone: string; texto: string }) => Promise<{
    sucesso: boolean;
    provedorId: string | null;
    conversaId: string | null;
    erro: string | null;
  }>;
}

/**
 * `null` = `configuracoes['regua.canal_whatsapp'] <> 'chatwoot'` OU env vars do
 * Chatwoot ausentes — nos dois casos a fila de WhatsApp continua manual
 * (copiar → wa.me → marcar enviada).
 */
export async function carregarChatwoot(admin: SupabaseClient): Promise<ClienteChatwoot | null> {
  try {
    if (!(await canalWhatsappViaChatwoot(admin))) return null;
    return { enviarWhatsapp };
  } catch {
    return null;
  }
}
