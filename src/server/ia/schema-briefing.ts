import { z } from "zod";

/**
 * Contrato de saída do Briefing Estratégico — Protocolo 01 (sic-hf-brain,
 * "02 - Metodo/Protocolo 01 - Briefing Estrategico.md"). As 12 seções, nesta
 * ordem exata. Cada conclusão carrega evidência; sem evidência, a seção é
 * hipótese, não fato — a REGRA DE OURO do protocolo virando restrição de schema.
 */

export const DiscSchema = z.enum(["D", "I", "S", "C"]);

export const ArquetipoPatrimonialSchema = z.enum([
  "Construtor",
  "Patriarca",
  "Protetor",
  "Empresario",
  "Planejador",
  "Investidor",
  "Realizador",
  "Nenhum_se_aplica",
]);

export const ProbabilidadeSchema = z.enum(["alta", "media", "baixa"]);

export const TomLinguagemSchema = z.enum([
  "tecnica",
  "emocional",
  "objetiva",
  "detalhada",
  "acolhedora",
  "firme",
  "consultiva",
]);

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
export const NivelSchema = z.enum(["alta", "media", "baixa", "indefinida"]);
export const VelocidadeDecisoriaSchema = z.enum(["rapida", "media", "lenta", "indefinida"]);
export const NivelAutoridadeSchema = z.enum([
  "decide_sozinho",
  "decide_com_conjuge",
  "decide_com_socios",
  "nao_decide",
  "indefinido",
]);
export const SimNaoIndefinidoSchema = z.enum(["sim", "nao", "indefinido"]);
export const RitmoSessaoSchema = z.enum(["lento", "moderado", "rapido"]);

export const BriefingSchema = z.object({
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
  processo_decisorio: z.object({
    velocidade: VelocidadeDecisoriaSchema,
    velocidade_nota: z.string(),
    necessidade_seguranca: NivelSchema,
    necessidade_seguranca_nota: z.string(),
    necessidade_validacao: NivelSchema,
    necessidade_validacao_nota: z.string(),
    necessidade_detalhe: NivelSchema,
    necessidade_detalhe_nota: z.string(),
    // Exigidos pelo POP 03 e ausentes do schema até aqui — o método estava
    // sendo perdido (ARQUITETURA-FASE-3.md §1.5).
    nivel_autoridade: NivelAutoridadeSchema,
    nivel_autoridade_nota: z.string(),
    decisores_presentes_na_sessao: SimNaoIndefinidoSchema,
    decisores_presentes_na_sessao_nota: z.string(),
    decisores: z.array(z.string()),
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
    ritmo_nota: z.string(),
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

export type Briefing = z.infer<typeof BriefingSchema>;
