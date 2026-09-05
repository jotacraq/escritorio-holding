import { z } from "zod";
import {
  AfirmacaoSchema,
  CategoriaAfirmacaoSchema,
  CRITERIOS_ARQUITETURA,
  DiscDecisorSchema,
} from "@/server/ia/schema-croqui-analise";
import { TIPOS_SLIDE_CROQUI, TipoSlideCroquiSchema } from "@/server/ia/schema-croqui-slides";

/**
 * A PONTE análise → 13 slides (ARQUITETURA-FASE-3.md §3.2). Contrato de saída
 * v2 do Agente do Croqui — croqui digitado por tipo de slide (com categoria,
 * fontes e pontos) em vez do `croqui: string[]` solto da v1
 * (`src/server/ia/schema-croqui-analise.ts`, `CroquiAnaliseSchema`), que §3.1
 * prova não ser mapeável deterministicamente para os 13 slides tipados.
 *
 * IMPORTANTE — divergência a resolver por outro agente (ver relatório da
 * onda): este arquivo define o CONTRATO da v2 e é consumido por
 * `gerarSlidesDaAnalise()` (`./gerar-slides.ts`), mas o PROMPT v2 do
 * `agente_croqui_analise` (previsto na 0042, §3.2, dono: agente A/
 * backend-ia) ainda não foi publicado neste checkout — `0042_prompts_v2.sql`
 * só contém a v2 do `protocolo_01_briefing`. Até esse prompt existir e
 * `src/server/ia/croqui-analise.ts` passar a chamar
 * `registrar_croqui_analise(..., p_schema_versao := 2)`, nenhuma análise real
 * produz este formato — `croqui_analises.schema_versao` (0043) nasce sempre
 * `1`, e `gerarSlidesDaAnalise()` devolve a base do método intocada para
 * esse caso (nunca inventa correspondência).
 *
 * `narrativa` (v1) SAI daqui de propósito (§3.2): o campo equivalente
 * (`como_apresentar`) migrou para dentro de cada slide, onde é usado — um
 * array duplicado a menos na saída paga.
 */

export const SlideAnaliseSchema = z.object({
  tipo: TipoSlideCroquiSchema,
  conteudo: z.string().min(1), // o que aparece para o cliente — ≤600 caracteres por orçamento de escrita (prompt, não Zod: §1.4)
  pontos: z.array(z.string()), // até 4 bullets, ≤120 ch cada — cardinalidade é instrução de prompt, não `.max()` (§1.4)
  como_apresentar: z.string(), // nota do apresentador — ≤300 ch
  categoria: CategoriaAfirmacaoSchema,
  fontes: z.array(z.string()), // de onde saiu — até 3
});
export type SlideAnalise = z.infer<typeof SlideAnaliseSchema>;

export const CelulaAlocacaoSchema = z.enum(["unica", "cofre", "veiculo", "destino"]);
export type CelulaAlocacao = z.infer<typeof CelulaAlocacaoSchema>;

export const AlocacaoItemSchema = z.object({
  celula: CelulaAlocacaoSchema,
  item: z.string(), // descrição do bem/participação
  categoria: CategoriaAfirmacaoSchema,
});
export type AlocacaoItem = z.infer<typeof AlocacaoItemSchema>;

/**
 * NOVO na v2 (ARQUITETURA-FASE-4.md §4.4): afirmação de patrimônio com o
 * valor DECLARADO pelo cliente na transcrição — número só quando o cliente
 * disse um número; senão `null`. A IA não calcula nem estima: é extração de
 * fato declarado, carimbada como tal. Na tela vira o botão "usar como valor
 * de mercado deste bem", que grava em `patrimonio_itens.valor_mercado` com
 * `origem_valor='transcricao'` (0059) por ação HUMANA, nunca automaticamente.
 *
 * `.nullable()` vira `type:[number,null]` na gramática — é o motivo de a v2
 * nascer inativa e passar pela sonda (`chave: 'croqui_v2'`) antes.
 * `.default(null)`: o campo continua OBRIGATÓRIO no JSON Schema enviado ao
 * modelo (`required`), mas um conteúdo v2 gravado sem ele (fixtures/testes
 * anteriores a este campo) ainda valida — `parse` preenche `null`, que é
 * exatamente "não declarou". A chave `default` é removida do schema estrito
 * por `json-schema-estrito.ts`.
 */
export const AfirmacaoPatrimonioSchema = AfirmacaoSchema.extend({
  valor_declarado: z.number().nullable().default(null),
});
export type AfirmacaoPatrimonio = z.infer<typeof AfirmacaoPatrimonioSchema>;

export const CroquiAnaliseV2Schema = z.object({
  resumo_executivo: z.string(),
  historia: z.array(AfirmacaoSchema),
  familia: z.array(AfirmacaoSchema),
  patrimonio: z.array(AfirmacaoPatrimonioSchema),
  empresas: z.array(AfirmacaoSchema),
  objetivos: z.array(AfirmacaoSchema),
  riscos: z.array(AfirmacaoSchema),
  disc: z.array(DiscDecisorSchema),
  arquitetura: z.object({
    recomendacao: z.enum(["1_celula", "2_celulas", "3_celulas", "ponto_a_validar"]),
    criterios: z
      .array(
        z.object({
          criterio: z.enum(CRITERIOS_ARQUITETURA),
          resposta: AfirmacaoSchema,
          peso_na_decisao: z.string(),
        }),
      )
      .length(CRITERIOS_ARQUITETURA.length),
    justificativa_geral: z.string(),
    // NOVO na v2 (§3.2): onde cada bem/participação fica na arquitetura de
    // 1/2/3 células — é o dado que os slides 7-10 (Células/Controle) e o
    // diagrama Cofre/Veículo/Destino (§3.4) desenham.
    alocacao: z.array(AlocacaoItemSchema),
  }),
  // NOVO na v2: 13 objetos tipados (um por slide), na ordem do método —
  // substitui o `croqui: string[]` solto da v1.
  croqui: z.array(SlideAnaliseSchema).length(TIPOS_SLIDE_CROQUI.length),
  perguntas: z.array(z.object({ pergunta: z.string(), motivo: z.string() })),
  objecoes: z.array(z.object({ objecao: z.string(), resposta_recomendada: z.string() })),
  fechamento: z.string(),
  grau_confianca: z.number().int().min(0).max(100),
  lacunas: z.array(z.string()),
});
/**
 * `z.input` (não `z.infer`): o único campo com `.default()` é
 * `patrimonio[].valor_declarado`, e no tipo de ENTRADA ele é opcional — o que
 * descreve honestamente um conteúdo v2 gravado antes do campo existir e
 * mantém válido quem monta o objeto sem ele (fixtures, testes). Depois de
 * `parse()` o valor sempre existe (`null` quando não declarado).
 */
export type CroquiAnaliseV2 = z.input<typeof CroquiAnaliseV2Schema>;
