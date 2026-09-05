import { z } from "zod";
import type { ConfiguracaoChave, ConfiguracaoChaveSomenteLeitura } from "@/types/admin";

/**
 * `configuracoes` (0027) nega INSERT/DELETE de propósito: chave nova é
 * migration, nunca escrita livre pela tela — evita "chave fantasma" que
 * nenhum código lê. A rota (`PATCH /api/admin/configuracoes/[chave]`) só
 * aceita UPDATE de uma das chaves abaixo, e valida o FORMATO do `valor`
 * contra o schema exato desta chave — nunca aceita jsonb arbitrário.
 *
 * Os limites (`.max(...)`) não vêm do método (nenhum POP define teto de
 * cooldown ou de slots) — são sanidade operacional para impedir um valor
 * digitado errado de travar o sistema (ex.: `agenda.duracao_padrao_minutos`
 * em 0 ou 100000). BLOQUEIO B12 do plano: os PADRÕES em si não vêm do método.
 *
 * Fase 4: as chaves de integração (`sala.provedor`, `regua.canal_whatsapp`,
 * `ligacao_ia.*`) e do método (`material.*`, `cenario.rubricas`,
 * `croqui.exige_revisao_para_pronto`) entram com o mesmo rigor — enum fechado
 * onde o servidor lê por nome (`server/integracoes/config.ts`).
 */
export const SCHEMAS_CONFIGURACAO: Record<ConfiguracaoChave, z.ZodType> = {
  "link.validade_dias": z
    .object({
      formulario: z.number().int().positive().max(365),
      agendamento: z.number().int().positive().max(365),
      documentos: z.number().int().positive().max(365),
      material: z.number().int().positive().max(365),
    })
    .strict(),
  "link.limite_por_minuto": z.number().int().positive().max(1000),
  "link.limite_por_dia": z.number().int().positive().max(100_000),
  "ia.cooldown_segundos": z.number().int().min(0).max(86_400),
  "ia.teto_execucoes_dia_por_usuario": z.number().int().positive().max(1000),
  "agenda.duracao_padrao_minutos": z.number().int().positive().max(600),
  "agenda.slots_ofertados_ao_cliente": z.number().int().positive().max(50),
  // 0049 — trava dos 13 slides revisados antes de `pronto` (desligada por decisão de 04/09).
  "croqui.exige_revisao_para_pronto": z.boolean(),
  // 0052 — sala de reunião: "manual" (cola o link na Ficha) | "n8n" (webhook assinado).
  "sala.provedor": z.enum(["manual", "n8n"]),
  // 0054 — WhatsApp da régua: "manual" (fila de copiar) | "chatwoot" (API).
  "regua.canal_whatsapp": z.enum(["manual", "chatwoot"]),
  // 0053 — ligação por IA. `automatica=false` até decisão LGPD (B33).
  "ligacao_ia.provedor": z.enum(["manual", "n8n"]),
  "ligacao_ia.automatica": z.boolean(),
  "ligacao_ia.max_tentativas": z.number().int().min(0).max(10),
  "ligacao_ia.intervalo_retentativa_minutos": z.number().int().positive().max(10_080),
  "ligacao_ia.timeout_minutos": z.number().int().positive().max(240),
  // 0055 — material pós-sessão em PDF.
  "material.anexar_pdf": z.boolean(),
  "material.rodape_juridico": z.string().trim().min(1).max(2000),
  // 0057 — rubricas de UI do Cenário Patrimonial (B37). Mesmo alfabeto de `cenario_rubricas.rubrica`.
  "cenario.rubricas": z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "rubrica: minúsculas, dígitos e _"))
    .min(1)
    .max(20),
};

export const CHAVES_CONFIGURACAO = Object.keys(SCHEMAS_CONFIGURACAO) as ConfiguracaoChave[];

/**
 * Escritas só pelo sistema (o cron grava `regua.ultimo_cron_em` a cada
 * passagem). Não têm schema de propósito: um PATCH nelas é 404 — a tela
 * mostra o valor como prova de vida e nunca oferece "Salvar".
 */
export const CHAVES_CONFIGURACAO_SOMENTE_LEITURA: readonly ConfiguracaoChaveSomenteLeitura[] = ["regua.ultimo_cron_em"];

export function ehChaveConfiguracaoConhecida(chave: string): chave is ConfiguracaoChave {
  return Object.prototype.hasOwnProperty.call(SCHEMAS_CONFIGURACAO, chave);
}

export function ehChaveSomenteLeitura(chave: string): chave is ConfiguracaoChaveSomenteLeitura {
  return (CHAVES_CONFIGURACAO_SOMENTE_LEITURA as readonly string[]).includes(chave);
}
