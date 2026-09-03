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
    velocidade: z.string(),
    necessidade_seguranca: z.string(),
    necessidade_validacao: z.string(),
    necessidade_detalhe: z.string(),
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
    ritmo: z.string(),
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
