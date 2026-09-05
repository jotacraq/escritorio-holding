import { z } from "zod";

/**
 * Contrato de saída do Briefing Estratégico — Protocolo 01 (sic-hf-brain,
 * "02 - Metodo/Protocolo 01 - Briefing Estrategico.md"). As 12 seções, nesta
 * ordem exata. Cada conclusão carrega evidência; sem evidência, a seção é
 * hipótese, não fato — a REGRA DE OURO do protocolo virando restrição de schema.
 */

export const DiscSchema = z.enum(["D", "I", "S", "C"]);

/**
 * Era `z.enum` com 8 opções. Enum em gramática estrita é alternação, e
 * alternações se multiplicam entre si — foi parte do estouro medido em
 * 04/09/2026. A lista fechada continua no texto do prompt, onde custa zero
 * gramática; aqui basta a string. Quem consome normaliza.
 */
export const ArquetipoPatrimonialSchema = z.string();

export const ProbabilidadeSchema = z.enum(["alta", "media", "baixa"]);

/** Mesmo motivo de ArquetipoPatrimonialSchema: a lista vive no prompt. */
export const TomLinguagemSchema = z.string();

/**
 * Schema v2 (L3, ARQUITETURA-FASE-3.md §1.5): campos onde o próprio método já
 * enumera as opções viram enum + `nota` — menos tokens escritos e uma tela
 * legível (chip, não parágrafo). Nada é removido: a `nota` carrega a evidência
 * que embasa a escolha, então nenhuma informação do Protocolo 01 se perde.
 *
 * ARMADILHA: nenhum destes ganha `.max()`/`.min()` — cardinalidade e limite de
 * caractere são regra de PROMPT (`orcamento-escrita.ts`), nunca de Zod, para
 * não reproduzir a classe de falha de 03/09 (`maxItems`/`minLength` no JSON
 * Schema estrito). Ver `provedor/json-schema-estrito.ts`.
 */
/**
 * MEDIDO em producao (04/09/2026): os enums da v2 estouraram o compilador de
 * gramatica da Anthropic — `invalid_request_error: The compiled grammar is too
 * large, which would cause performance issues`. O briefing parou de sair
 * INTEIRO, com `tsc`, `eslint` e `build` verdes, porque o schema so e
 * compilado do outro lado da rede.
 *
 * A v1 tinha 4 enums e passava; a v2 subiu para 11 e nao passa. Enum em
 * schema estrito nao e um campo: e uma alternacao na gramatica, e elas se
 * multiplicam entre si.
 *
 * Por isso os campos abaixo sao `z.string()` e NAO `z.enum()`. A lista fechada
 * continua existindo — ela esta escrita no texto do prompt (v2 da 0042, secao
 * "CAMPOS ESTRUTURADOS"), que e onde ela custa zero gramatica. Quem consome
 * normaliza. Os 4 enums originais ficam: sao os que a tela usa para decidir
 * cor e rotulo, e cabem no orcamento de gramatica que ja se provou.
 *
 * Se for reintroduzir enum aqui, MEÇA contra a API antes de considerar pronto.
 */
export const NivelSchema = z.string();
export const VelocidadeDecisoriaSchema = z.string();
export const NivelAutoridadeSchema = z.string();
export const SimNaoIndefinidoSchema = z.string();
export const RitmoSessaoSchema = z.string();

/**
 * Schema v2 — a forma que `protocolo_01_briefing` v1/v2 produzem hoje em
 * produção (MEDIDO em 04/09/2026: 3.813 bytes de JSON Schema estrito, compila).
 * Fica congelado: toda linha de `prompts_versoes` com `versao <= 2` valida
 * contra ele (`schemaBriefingParaVersao`). Nunca ganha campo novo — campo
 * novo entra na versão seguinte, medido pela sonda antes de ativar.
 */
export const BriefingV2Schema = z.object({
  resumo_executivo: z.string().min(1),
  perfil_disc: z.object({
    predominante: DiscSchema,
    secundario: DiscSchema,
    confianca: z.number().int().min(0).max(100),
    evidencias: z.array(z.string()),
  }),
  arquetipo_patrimonial: z.object({
    escolhido: ArquetipoPatrimonialSchema,
    justificativa: z.string(),
    evidencias: z.array(z.string()),
  }),
  o_que_protege: z.object({
    objeto: z.string(),
    justificativa: z.string(),
  }),
  motivadores: z.object({
    principal: z.string(),
    secundarios: z.array(z.string()),
    justificativa: z.string(),
  }),
  objecoes_provaveis: z.array(
    z.object({
      objecao: z.string(),
      probabilidade: ProbabilidadeSchema,
      justificativa: z.string(),
    }),
  ),
  // MEDIDO contra o provedor (sonda de 04/09/2026): a gramática estrita da
  // Anthropic aceitou 3.905 bytes de schema e recusou 4.428. Este bloco era o
  // mais pesado de todos — 953 bytes sozinho — e foi o que estourou o teto e
  // derrubou 100% dos briefings.
  //
  // Sete campos "_nota" viraram UMA lista de evidências. A informação é a
  // mesma (a evidência que embasa cada categoria), o prompt continua pedindo
  // uma evidência por categoria, e o schema custa um terço.
  //
  // `nivel_autoridade` e `decisores_presentes_na_sessao` ficam: são exigidos
  // pelo POP 03 e estavam faltando — era método sendo perdido.
  //
  // Antes de acrescentar campo aqui, rode POST /api/admin/sonda-schema. Não
  // dá para descobrir isso no build: o schema só compila do outro lado da rede.
  processo_decisorio: z.object({
    velocidade: VelocidadeDecisoriaSchema,
    necessidade_seguranca: NivelSchema,
    necessidade_validacao: NivelSchema,
    necessidade_detalhe: NivelSchema,
    nivel_autoridade: NivelAutoridadeSchema,
    decisores_presentes_na_sessao: SimNaoIndefinidoSchema,
    decisores: z.array(z.string()),
    /** Uma evidência observada por categoria acima — o que sustenta a escolha. */
    evidencias: z.array(z.string()),
  }),
  linguagem_recomendada: z.object({
    tom: z.array(TomLinguagemSchema),
    justificativa: z.string(),
  }),
  pontos_de_atencao: z.array(
    z.object({ nao_fazer: z.string(), motivo: z.string() }),
  ),
  perguntas_para_aprofundar: z.array(
    z.object({ pergunta: z.string(), motivo: z.string() }),
  ),
  frases_para_o_fechamento: z.array(
    z.object({ frase_literal: z.string(), como_usar: z.string() }),
  ),
  estrategia_sessao: z.object({
    ritmo: RitmoSessaoSchema,
    mais_tempo_em: z.array(z.string()),
    menos_tempo_em: z.array(z.string()),
    momento_croqui: z.string(),
    momento_investimento: z.string(),
    tratamento_objecoes: z.string(),
  }),
  estrategia_fechamento: z.string(),
  grau_confianca: z.number().int().min(0).max(100),
  lacunas: z.array(z.string()),
});

/**
 * Schema v3 (ARQUITETURA-FASE-4.md §5.2) — v2 + `linguagem_do_cliente`, a
 * seção "como ele fala": palavras que o cliente repete, expressões literais
 * (verificadas por `fidelidade.ts`) e o registro (formal/coloquial…).
 *
 * POR QUE É UMA STRING E NÃO UM OBJETO COM ARRAYS: o teto de gramática do
 * provedor (3.905 bytes compila, 4.428 não — CONTINUAR-AQUI.md §0) não deixa.
 * MEDIDO em 04/09/2026 com `Buffer.byteLength(JSON.stringify(paraJsonSchemaEstrito(...)))`:
 *   - v2 (base) ............................................ 3.813 bytes
 *   - v2 + objeto {palavras_repetidas[], expressoes_literais[], registro} 4.146 bytes (ESTOURA)
 *   - v2 + objeto com 3 strings ............................ 4.096 bytes (ESTOURA)
 *   - v2 + 2 strings na raiz ............................... 3.884 bytes
 *   - v2 + `linguagem_do_cliente: string` (esta) ........... 3.877 bytes ✓ (≤ 3.900)
 * O fallback previsto no §5.2 ("viram uma string separada por `;`, o
 * consumidor divide") é o que está aqui, com formato fixo de 3 linhas
 * (ver `linguagem-cliente.ts`: `FORMATO_LINGUAGEM_DO_CLIENTE` no prompt e
 * `separarLinguagemDoCliente()` para a tela e para a fidelidade). Nenhuma
 * seção antiga foi comprimida — a tela continua lendo tudo que já lia.
 *
 * A gramática só é compilada do outro lado da rede: antes de ATIVAR a v3
 * (0059), rodar `POST /api/admin/sonda-schema {"chave":"briefing_v3"}` e
 * colar o resultado na migration.
 */
export const BriefingSchema = BriefingV2Schema.extend({
  linguagem_do_cliente: z.string(),
});

export type BriefingV2 = z.infer<typeof BriefingV2Schema>;
export type BriefingV3 = z.infer<typeof BriefingSchema>;
/**
 * Tipo que circula pelo sistema: v3 com a seção nova OPCIONAL — um briefing
 * gravado por prompt v1/v2 não a tem, e a tela mostra vazio, não inventa.
 */
export type Briefing = BriefingV2 & { linguagem_do_cliente?: string };

/**
 * Bi-versão (mesmo padrão de `croqui-analise.ts`): a versão ATIVA de
 * `prompts_versoes` decide o schema — v3 só passa a ser exigido quando a v3
 * for promovida, o que só acontece depois da sonda e da bancada (0059).
 */
export function schemaBriefingParaVersao(versao: number): z.ZodType<Briefing> {
  return versao >= 3 ? BriefingSchema : BriefingV2Schema;
}
