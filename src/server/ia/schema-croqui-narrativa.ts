import { z } from "zod";
import { CHAVES_TABELA } from "@/types/croqui-calculo";
import { CRITERIOS_ARQUITETURA } from "@/server/ia/schema-croqui-analise";

/**
 * Contrato de saída v3 do Agente do Croqui — **a IA só narra** (Fase 5 §6.1).
 *
 * O que mudou em relação à v1/v2: o número saiu. As 19 tabelas do croqui vêm
 * do motor determinístico (`src/server/motor-croqui/**`), com procedência por
 * célula e versão gravada em `croqui_calculos`. À IA sobra o que ela faz bem —
 * como apresentar cada tabela, que pergunta fazer, que objeção esperar, como
 * fechar. Some do schema, porque o motor já sabe: `historia`, `familia`,
 * `patrimonio`, `empresas`, `objetivos`, `riscos`, `croqui[]`, `disc` (vive no
 * Briefing), `peso_na_decisao` e `categoria` dentro de `criterios`.
 *
 * REGRA DURA, no prompt e aqui: a narrativa **não cita número que o motor
 * marcou `ausente`**. O contexto entrega "—" no lugar do valor e instrui a
 * falar da ausência ("falta a alíquota de ITCMD de MG"), nunca a estimar. Foi
 * um deck com "a família perde aproximadamente R$ 0,00" que gerou esta regra.
 *
 * TETO DE GRAMÁTICA (CONTINUAR-AQUI.md §0): o provedor compila o JSON Schema
 * do lado dele e recusa acima de ~3.905 bytes (medido em 04/09/2026 com o
 * briefing; a v2 do croqui mede 4.959 e por isso está inativa). Medir com
 * `npx tsx scripts/medir-schema-narrativa.ts` ou
 * `POST /api/admin/sonda-schema` ANTES de ativar qualquer prompt.
 * Ordem de corte, se estourar: `criterios` → `lacunas` → `perguntas.motivo`.
 */

/** As 19 tabelas do motor — a narrativa referencia, não recalcula. */
export const ChaveTabelaSchema = z.enum(CHAVES_TABELA);

export const RecomendacaoArquiteturaSchema = z.enum([
  "celula_1",
  "celula_2",
  "celula_3",
  "ponto_a_validar",
]);

export const CroquiNarrativaSchema = z.object({
  /** Uma nota de condução por tabela apresentada. Vai para as notas do slide. */
  como_apresentar: z.array(
    z.object({
      tabela: ChaveTabelaSchema,
      texto: z.string(),
    }),
  ),
  arquitetura: z.object({
    recomendacao: RecomendacaoArquiteturaSchema,
    justificativa: z.string(),
    criterios: z
      .array(
        z.object({
          criterio: z.enum(CRITERIOS_ARQUITETURA),
          resposta: z.string(),
        }),
      )
      .length(CRITERIOS_ARQUITETURA.length),
  }),
  perguntas: z.array(z.object({ pergunta: z.string(), motivo: z.string() })),
  objecoes: z.array(z.object({ objecao: z.string(), resposta_recomendada: z.string() })),
  fechamento: z.string(),
  grau_confianca: z.number().int().min(0).max(100),
  /** O que a narrativa NÃO pôde afirmar — inclui toda célula ausente citada. */
  lacunas: z.array(z.string()),
});

export type CroquiNarrativa = z.infer<typeof CroquiNarrativaSchema>;
export type ComoApresentar = CroquiNarrativa["como_apresentar"][number];
export type RecomendacaoArquitetura = z.infer<typeof RecomendacaoArquiteturaSchema>;

/** Chave do prompt versionado (`prompts_versoes`), publicada inativa na 0066. */
export const CHAVE_PROMPT_NARRATIVA = "agente_croqui_narrativa" as const;
