/**
 * Tipos do domínio de PESQUISA EM FONTE PÚBLICA (Fase 2, B-4B —
 * `0036_pesquisas_publicas.sql`). Mesmo espírito de `src/types/agenda.ts`:
 * interface de linha escrita à mão a partir da migration, schema de corpo em
 * zod ao lado. Arquivo novo e exclusivo deste agente — não depende de
 * `src/types/banco.ts` (fronteira de outro agente).
 *
 * LEIA ANTES DE ESTENDER: BLOQUEIO B4 (docs/ARQUITETURA.md) — este módulo é
 * registro MANUAL. `entra_no_briefing` é travado em `false` por CHECK no
 * banco; nenhum schema aqui aceita `true` para esse campo, de propósito —
 * ver comentário da constraint em 0036_pesquisas_publicas.sql.
 */

import { z } from "zod";

export interface PesquisaPublica {
  id: string;
  jornada_id: string;
  pessoa_id: string;
  fonte: string;
  url: string | null;
  consultado_em: string;
  consultado_por: string;
  base_legal: string;
  resumo: string;
  entra_no_briefing: false;
  origem_dado: "real" | "exemplo";
  criado_em: string;
}

/**
 * Corpo de `POST /api/pesquisas-publicas`. `pessoa_id` NÃO entra aqui —
 * é sempre derivado no servidor a partir de `jornadas.pessoa_id` (mesmo
 * cuidado de `src/app/api/jornadas/[id]/patrimonio/route.ts`): o cliente não
 * escolhe de quem é a pesquisa que está registrando, só a jornada.
 * `consultado_por` também não entra — vem de `usuarioAtual()`.
 */
export const CorpoRegistrarPesquisaSchema = z.object({
  jornada_id: z.string().uuid(),
  fonte: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((valor) => /^https?:\/\//i.test(valor), {
      message: "URL precisa começar com http:// ou https://.",
    })
    .optional(),
  consultado_em: z.string().datetime({ offset: true }).optional(),
  base_legal: z.string().trim().min(5).max(2000),
  resumo: z.string().trim().min(1).max(10_000),
});

export type CorpoRegistrarPesquisa = z.infer<typeof CorpoRegistrarPesquisaSchema>;

export const QueryListarPesquisasSchema = z.object({
  jornada_id: z.string().uuid(),
});
