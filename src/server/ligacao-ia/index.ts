/**
 * Ponto de entrada da ligação por IA (Fase 4 · F2, agente B).
 *
 * Contrato com o cron único do agente A (`POST /api/cron/regua`, §1.6):
 *   import { processarFilaLigacoesIa, reaperLigacoesIa } from "@/server/ligacao-ia";
 *   ... processarFilaRegua → processarFilaLigacoesIa(admin) → reaperLigacoesIa(admin) → sincronizarSalas
 * Cada uma recebe o cliente service_role e devolve um resumo numérico; nenhuma
 * lança por ligação individual (só por falha de infraestrutura, p.ex. RPC ausente).
 */
export { processarFilaLigacoesIa, dispararAgora, dispararLigacao } from "./processar";
export { reaperLigacoesIa } from "./reaper";
export { aplicarResultado, tratarFalha, enviarFallbackLink } from "./resultado";
export { enfileirarLigacaoIa, prepararOferta, urlDoLinkAgendamento } from "./fila";
export { n8nLigacaoConfigurado, faltamN8nLigacao, testarN8nLigacao, VARIAVEIS_N8N_LIGACAO } from "./n8n";
export { rotuloHorario } from "./horarios";
export type { ProvedorLigacaoIa, OfertaHorarios, ContextoDisparo } from "./tipos";
