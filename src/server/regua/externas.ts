import type { SupabaseClient } from "@supabase/supabase-js";
import { etapaExpurgoLigacoesIa, processarFilaLigacoesIa, reaperLigacoesIa } from "@/server/ligacao-ia";
import { canalWhatsappViaChatwoot } from "@/server/chatwoot/canal";
import { enviarWhatsapp } from "@/server/chatwoot/cliente";
import { etapaExpurgoSegmentosCopiloto } from "@/server/copiloto/expurgo";

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

/**
 * Retenção de voz (LGPD B19, Fase 7). Última etapa do cron de propósito: é
 * limpeza, e nada do que roda depois dela depende do que ela apaga. Sem
 * `ligacao_ia.retencao_dias` configurada devolve `pulada: 'sem_retencao'` e não
 * toca em linha nenhuma.
 */
export async function etapaExpurgoLigacoes(admin: SupabaseClient): Promise<ResultadoEtapaExterna> {
  return (await etapaExpurgoLigacoesIa(admin)) as unknown as ResultadoEtapaExterna;
}

/**
 * Expurgo de `sessoes_copiloto_segmentos` (LGPD B69/B19, Fase 10 Fatia 5).
 * MESMA posição do expurgo de ligações no cron: última etapa de propósito —
 * é limpeza, nada do que roda antes dela depende do que ela apaga (a
 * transcrição consolidada, que o Agente do Croqui lê, já foi gravada em
 * `transcricoes` pela Fatia 3, antes de qualquer segmento poder ser
 * considerado). Sem `copiloto_sessao.expurgo_ativo=true`, devolve
 * `pulada: 'expurgo_desligado'` e não toca em linha nenhuma — é o estado de
 * fábrica e deve seguir assim até a Dra. Elaine decidir (B69).
 */
export async function etapaExpurgoCopiloto(admin: SupabaseClient): Promise<ResultadoEtapaExterna> {
  return (await etapaExpurgoSegmentosCopiloto(admin)) as unknown as ResultadoEtapaExterna;
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
