import { z } from "zod";

/**
 * Contrato de saída do Agente do Croqui — a SEGUNDA IA (pós-Sessão de
 * Viabilidade). Fonte: sic-hf-brain/02 - Metodo/Agente do Croqui.md e
 * Contexto-Mestre §2, §14, §45. Toda afirmação carimbada por categoria — nunca
 * texto livre sem proveniência.
 */

export const CategoriaAfirmacaoSchema = z.enum([
  "fato_declarado",
  "dado_documental",
  "inferencia",
  "ponto_a_validar",
]);
export type CategoriaAfirmacao = z.infer<typeof CategoriaAfirmacaoSchema>;

export const AfirmacaoSchema = z.object({
  texto: z.string().min(1),
  categoria: CategoriaAfirmacaoSchema,
});

export const DiscDecisorSchema = z.object({
  decisor: z.string(),
  perfil_predominante: z.enum(["D", "I", "S", "C"]),
  evidencias: z.array(z.string()),
  confianca: z.number().int().min(0).max(100),
});

// Os 9 critérios de escolha entre 1/2/3 células (§14 do Contexto-Mestre).
export const CRITERIOS_ARQUITETURA = [
  "quantidade_de_nucleos_familiares",
  "empresa_operacional_relevante",
  "imoveis_de_renda",
  "patrimonio_pessoal_relevante",
  "concentracao_em_empresa",
  "niveis_diferentes_de_participacao_dos_herdeiros",
  "fundador_deseja_permanecer_no_controle",
  "necessidade_de_separar_patrimonio_gestao_e_destino",
  "beneficio_justifica_a_complexidade",
] as const;

export const CroquiAnaliseSchema = z.object({
  resumo_executivo: z.string(),
  historia: z.array(AfirmacaoSchema),
  familia: z.array(AfirmacaoSchema),
  patrimonio: z.array(AfirmacaoSchema),
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
  }),
  croqui: z.array(z.string()), // referências aos 13 slides padrão, com o que muda em cada um
  narrativa: z.array(z.object({ slide: z.string(), como_apresentar: z.string() })),
  perguntas: z.array(z.object({ pergunta: z.string(), motivo: z.string() })),
  objecoes: z.array(z.object({ objecao: z.string(), resposta_recomendada: z.string() })),
  fechamento: z.string(),
  grau_confianca: z.number().int().min(0).max(100),
  lacunas: z.array(z.string()),
});
export type CroquiAnalise = z.infer<typeof CroquiAnaliseSchema>;
