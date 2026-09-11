import { z } from "zod";

/**
 * Contrato de saída do Copiloto ao Vivo — Fase 10, Fatia 2
 * (docs/ARQUITETURA-FASE-10.md §4.3). 5 campos, um único enum curto (`tipo`,
 * 4 valores) — mesma lição do briefing (schema-briefing.ts): enum em
 * gramática estrita é alternação, e alternações se multiplicam com o resto
 * do schema. O teto medido no projeto é 3.905 B compila / 4.428 B não
 * (04/09/2026, achado do briefing v2); este schema nasce pequeno de
 * propósito — a SONDA (`POST /api/admin/sonda-schema`) é quem confirma o
 * byte count real antes de ativar o prompt 0094, não uma conta de cabeça
 * feita aqui.
 *
 * ARMADILHA (mesma de `schema-briefing.ts`): NENHUM campo ganha `.max()`/
 * `.min()` de string ou `.int()`/`.min()`/`.max()` de número — essas viram
 * `minLength`/`maximum`/`minimum` no JSON Schema, que o modo `strict:true`
 * do OpenRouter RECUSA (ver `provedor/json-schema-estrito.ts`). Os tetos de
 * caractere que o §4.3 do plano define (240/200/120/160) são regra de
 * PROMPT (0094), não de Zod — e são reforçados aqui só como corte defensivo
 * no `validarSaidaCopiloto`, depois que a resposta já voltou.
 */

export const TipoObservacaoSchema = z.enum(["fato", "hipotese", "inferencia", "recomendacao"]);

const ProximaPerguntaSchema = z
  .object({
    texto: z.string(),
    motivo: z.string(),
    evidencia: z.string(),
  })
  .nullable();

const ItemFaltaSchema = z.object({
  item: z.string(),
  evidencia: z.string(),
});

const ObservacaoSchema = z
  .object({
    tipo: TipoObservacaoSchema,
    texto: z.string(),
    evidencia: z.string(),
    confianca: z.number(),
  })
  .nullable();

const DesvioSugeridoSchema = z
  .object({
    bloco_id: z.string(),
    motivo: z.string(),
    confianca: z.number(),
  })
  .nullable();

export const SugestaoCopilotoIaSchema = z.object({
  proxima_pergunta: ProximaPerguntaSchema,
  falta_no_bloco: z.array(ItemFaltaSchema),
  observacao: ObservacaoSchema,
  desvio_sugerido: DesvioSugeridoSchema,
  confianca_geral: z.number(),
});

export type SugestaoCopilotoIa = z.infer<typeof SugestaoCopilotoIaSchema>;

/** Tetos de caractere do §4.3 do plano — aplicados no VALIDADOR pós-Zod
 * (server/copiloto/validar.ts), nunca no schema Zod (ver ARMADILHA acima). */
export const TETO_TEXTO_PERGUNTA = 240;
export const TETO_MOTIVO_PERGUNTA = 200;
export const TETO_EVIDENCIA_PERGUNTA = 200;
export const TETO_ITEM_FALTA = 120;
export const TETO_EVIDENCIA_FALTA = 160;
export const TETO_TEXTO_OBSERVACAO = 240;
export const TETO_EVIDENCIA_OBSERVACAO = 200;
export const TETO_MOTIVO_DESVIO = 240;

/** Máximo de itens em `falta_no_bloco` (§4.3 do plano: "lista de no máximo 4 objetos"). */
export const MAX_ITENS_FALTA_NO_BLOCO = 4;
