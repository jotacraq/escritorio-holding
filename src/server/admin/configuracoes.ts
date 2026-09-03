import { z } from "zod";
import type { ConfiguracaoChave } from "@/types/admin";

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
};

export const CHAVES_CONFIGURACAO = Object.keys(SCHEMAS_CONFIGURACAO) as ConfiguracaoChave[];

export function ehChaveConfiguracaoConhecida(chave: string): chave is ConfiguracaoChave {
  return Object.prototype.hasOwnProperty.call(SCHEMAS_CONFIGURACAO, chave);
}
