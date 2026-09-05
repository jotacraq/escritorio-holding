import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { erroConflito, erroNaoEncontrado, registrarErro } from "@/server/erros";
import {
  TIPOS_CENARIO,
  type CenarioPatrimonial,
  type CenarioRubrica,
  type CenarioTotais,
  type ParametroMetodo,
  type RespostaCenarioJornada,
  type RespostaGravarRubrica,
} from "@/types/cenario";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
type Cliente = SupabaseClient<any, any, any>;

/**
 * Cenário Patrimonial (0057). Toda regra de valor vive no banco (CHECK
 * `ck_procedencia` + trigger `cenario_rubrica_calcula`); aqui só se valida a
 * FORMA do corpo e se traduz o erro do Postgres em código estável.
 */

export const RubricaSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, "Rubrica: minúsculas, dígitos e _ (ex.: custas_cartorio).");

export const CorpoGravarRubricaSchema = z
  .object({
    cenario: z.enum(TIPOS_CENARIO),
    rubrica: RubricaSchema,
    procedencia: z.enum(["calculado", "digitado", "ausente"]),
    valor: z.number().min(0).max(9_999_999_999_999).nullish(),
    base_calculo: z.number().min(0).max(9_999_999_999_999).nullish(),
    parametro_id: z.string().uuid().nullish(),
    nota: z.string().trim().max(2000).nullish(),
    ordem: z.number().int().min(0).max(999).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.procedencia === "digitado" && (c.valor === null || c.valor === undefined)) {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "Valor digitado é obrigatório." });
    }
    if (c.procedencia === "calculado") {
      if (c.base_calculo === null || c.base_calculo === undefined) {
        ctx.addIssue({ code: "custom", path: ["base_calculo"], message: "Base de cálculo é obrigatória para o sistema multiplicar." });
      }
      if (!c.parametro_id) {
        ctx.addIssue({ code: "custom", path: ["parametro_id"], message: "Escolha a alíquota vigente (Admin → Parâmetros)." });
      }
    }
  });
export type CorpoGravarRubricaValidado = z.infer<typeof CorpoGravarRubricaSchema>;

interface ErroPostgrest {
  code?: string;
  message: string;
}

/** Mensagem humana por código do trigger `cenario_rubrica_calcula` (0057/0061).
 * Códigos fora do mapa saem com o texto do próprio trigger. */
const MENSAGEM_POR_CODIGO: Record<string, string> = {
  parametro_inativo: "Esta alíquota foi desativada. Escolha a versão vigente em Admin → Parâmetros.",
  parametro_jurisdicao_incoerente: "A alíquota escolhida é de outra UF. Use a alíquota da UF do cliente (ou corrija a UF na Ficha).",
};

/** Traduz a violação de integridade do banco (23514 do CHECK/trigger) em 409
 * com código estável e o texto do trigger (`cenario_calculado_exige_parametro:
 * ...`) como mensagem — sem stack, sem id interno. */
export function traduzirErroCenario(error: ErroPostgrest): never {
  if (error.code === "23514") {
    const [codigo, resto] = error.message.split(":", 2);
    const conhecido = /^[a-z_]+$/.test(codigo.trim());
    const chave = conhecido ? codigo.trim() : "cenario_invalido";
    throw erroConflito(
      chave,
      MENSAGEM_POR_CODIGO[chave] ?? (conhecido && resto ? resto.trim() : "Combinação de procedência e valores recusada pelo banco."),
    );
  }
  throw error;
}

export async function listarCenario(supabase: Cliente, jornadaId: string): Promise<RespostaCenarioJornada> {
  const [cenariosRes, totaisRes, configRes] = await Promise.all([
    supabase.from("cenarios_patrimoniais").select("*").eq("jornada_id", jornadaId).order("cenario"),
    supabase.from("vw_cenarios_totais").select("*").eq("jornada_id", jornadaId),
    supabase.from("configuracoes").select("valor").eq("chave", "cenario.rubricas").maybeSingle(),
  ]);
  if (cenariosRes.error) {
    registrarErro("server/cenario.listarCenario", cenariosRes.error, { jornada_id: jornadaId });
    throw cenariosRes.error;
  }
  if (totaisRes.error) throw totaisRes.error;
  if (configRes.error) throw configRes.error;

  const cenarios = (cenariosRes.data as CenarioPatrimonial[] | null) ?? [];
  const ids = cenarios.map((c) => c.id);

  const rubricas: CenarioRubrica[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("cenario_rubricas")
      .select("*")
      .in("cenario_id", ids)
      .order("ordem")
      .order("rubrica");
    if (error) throw error;
    rubricas.push(...((data as CenarioRubrica[] | null) ?? []));
  }

  const parametroIds = Array.from(new Set(rubricas.map((r) => r.parametro_id).filter((x): x is string => !!x)));
  const parametros: Record<string, ParametroMetodo> = {};
  if (parametroIds.length > 0) {
    const { data, error } = await supabase.from("parametros_metodo").select("*").in("id", parametroIds);
    if (error) throw error;
    for (const p of (data as ParametroMetodo[] | null) ?? []) parametros[p.id] = p;
  }

  const valorConfig = (configRes.data as { valor: unknown } | null)?.valor;
  const rubricasPadrao = Array.isArray(valorConfig) ? valorConfig.filter((x): x is string => typeof x === "string") : [];

  return {
    cenarios,
    rubricas,
    totais: (totaisRes.data as CenarioTotais[] | null) ?? [],
    rubricas_padrao: rubricasPadrao,
    parametros,
    tipos: TIPOS_CENARIO,
  };
}

/** Upsert de UMA célula. Cabeçalho criado sob demanda. Nunca DELETE. */
export async function gravarRubrica(
  supabase: Cliente,
  jornadaId: string,
  usuarioId: string,
  corpo: CorpoGravarRubricaValidado,
): Promise<RespostaGravarRubrica> {
  const { data: existente, error: erroBusca } = await supabase
    .from("cenarios_patrimoniais")
    .select("*")
    .eq("jornada_id", jornadaId)
    .eq("cenario", corpo.cenario)
    .maybeSingle();
  if (erroBusca) throw erroBusca;

  let cenario = existente as CenarioPatrimonial | null;
  if (!cenario) {
    const { data, error } = await supabase
      .from("cenarios_patrimoniais")
      .insert({ jornada_id: jornadaId, cenario: corpo.cenario, criado_por: usuarioId, atualizado_por: usuarioId })
      .select("*")
      .single<CenarioPatrimonial>();
    if (error) {
      // corrida: outra aba criou o mesmo cabeçalho entre o select e o insert
      if ((error as ErroPostgrest).code === "23505") {
        const { data: denovo, error: erroDenovo } = await supabase
          .from("cenarios_patrimoniais")
          .select("*")
          .eq("jornada_id", jornadaId)
          .eq("cenario", corpo.cenario)
          .single<CenarioPatrimonial>();
        if (erroDenovo) throw erroDenovo;
        cenario = denovo;
      } else {
        registrarErro("server/cenario.gravarRubrica insert cabecalho", error, { jornada_id: jornadaId });
        throw error;
      }
    } else {
      cenario = data;
    }
  }
  if (!cenario) throw erroNaoEncontrado("Cenário não encontrado.");

  // O corpo NUNCA manda `valor`/`aliquota` no caso calculado: o trigger preenche.
  const linha = {
    cenario_id: cenario.id,
    rubrica: corpo.rubrica,
    procedencia: corpo.procedencia,
    valor: corpo.procedencia === "digitado" ? corpo.valor : null,
    base_calculo: corpo.procedencia === "calculado" ? corpo.base_calculo : null,
    parametro_id: corpo.procedencia === "calculado" ? corpo.parametro_id : null,
    nota: corpo.nota ?? null,
    ordem: corpo.ordem ?? 0,
    atualizado_por: usuarioId,
  };

  const { data: rubrica, error: erroRubrica } = await supabase
    .from("cenario_rubricas")
    .upsert(linha, { onConflict: "cenario_id,rubrica" })
    .select("*")
    .single<CenarioRubrica>();
  if (erroRubrica) traduzirErroCenario(erroRubrica as ErroPostgrest);

  const { data: totais, error: erroTotais } = await supabase
    .from("vw_cenarios_totais")
    .select("*")
    .eq("cenario_id", cenario.id)
    .maybeSingle();
  if (erroTotais) throw erroTotais;

  return { cenario, rubrica: rubrica as CenarioRubrica, totais: (totais as CenarioTotais | null) ?? null };
}
