import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { erroConflito, registrarErro } from "@/server/erros";
import type { ParametroMetodo, RespostaParametrosMetodo } from "@/types/cenario";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
type Cliente = SupabaseClient<any, any, any>;

/**
 * Parâmetros do método (0056). Leitura por `parametro_vigente(chave, uf,
 * municipio)`; ausência é `null` — NUNCA um valor de fallback (B26/B27: o
 * número que a tela mostra tem de existir no banco, com versão).
 */

const CHAVE_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export const ChaveParametroSchema = z.string().min(3).max(80).regex(CHAVE_REGEX, "Chave inválida (ex.: itcmd.aliquota).");
export const UfSchema = z
  .string()
  .length(2)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/));

export const UnidadeParametroSchema = z.enum(["brl", "percentual", "parcelas", "dias", "meses", "quantidade"]);

/** Corpo de `POST /api/admin/parametros`. Base legal obrigatória para
 * imposto também aqui (o CHECK do banco é a segunda trava). */
export const CorpoCriarParametroSchema = z
  .object({
    chave: ChaveParametroSchema,
    valor: z.number().min(0).max(999_999_999),
    unidade: UnidadeParametroSchema,
    uf: UfSchema.nullish(),
    municipio: z.string().trim().min(1).max(120).nullish(),
    base_legal: z.string().trim().min(1).max(2000).nullish(),
    vigente_de: z.string().date().optional(),
    notas: z.string().trim().max(2000).nullish(),
    ativar: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    const tributo = c.chave.startsWith("itcmd.") || c.chave.startsWith("itbi.");
    if (tributo && !c.base_legal) {
      ctx.addIssue({ code: "custom", path: ["base_legal"], message: "Alíquota de imposto exige base legal (lei/decreto/URL)." });
    }
    if (tributo && !c.uf) {
      ctx.addIssue({ code: "custom", path: ["uf"], message: "Alíquota de imposto exige a UF." });
    }
    if (c.chave.startsWith("itbi.") && !c.municipio) {
      ctx.addIssue({ code: "custom", path: ["municipio"], message: "ITBI é municipal: informe o município." });
    }
    if (c.municipio && !c.uf) {
      ctx.addIssue({ code: "custom", path: ["uf"], message: "Município exige UF." });
    }
    if (tributo && c.unidade !== "percentual") {
      ctx.addIssue({ code: "custom", path: ["unidade"], message: "Alíquota de imposto é percentual." });
    }
  });
export type CorpoCriarParametroValidado = z.infer<typeof CorpoCriarParametroSchema>;

export interface FiltroJurisdicao {
  uf?: string | null;
  municipio?: string | null;
}

/** Versão ativa e vigente de UMA chave (ou `null`). */
export async function parametroVigente(
  supabase: Cliente,
  chave: string,
  jurisdicao: FiltroJurisdicao = {},
): Promise<ParametroMetodo | null> {
  const { data, error } = await supabase.rpc("parametro_vigente", {
    p_chave: chave,
    p_uf: jurisdicao.uf ?? null,
    p_municipio: jurisdicao.municipio ?? null,
  });
  if (error) {
    registrarErro("server/parametros.parametroVigente", error, { chave });
    throw error;
  }
  const linhas = (data as ParametroMetodo[] | null) ?? [];
  return linhas[0] ?? null;
}

/** Várias chaves numa passada — uma RPC por chave (são poucas: 1–4 por tela),
 * em paralelo. Resposta já na forma de `GET /api/parametros-metodo`. */
export async function parametrosVigentes(
  supabase: Cliente,
  chaves: string[],
  jurisdicao: FiltroJurisdicao = {},
): Promise<RespostaParametrosMetodo> {
  const unicas = Array.from(new Set(chaves));
  const resultados = await Promise.all(unicas.map((chave) => parametroVigente(supabase, chave, jurisdicao)));
  const parametros: Record<string, ParametroMetodo | null> = {};
  const ausentes: string[] = [];
  unicas.forEach((chave, i) => {
    parametros[chave] = resultados[i];
    if (!resultados[i]) ausentes.push(chave);
  });
  return { parametros, ausentes };
}

/** Lança 409 `parametro_ausente` nomeando a chave — para rotas que não podem
 * seguir sem o número (ex.: registrar oferta sem preço de tabela). */
export function exigirParametro(parametro: ParametroMetodo | null, chave: string): ParametroMetodo {
  if (!parametro) {
    throw erroConflito(
      "parametro_ausente",
      `Nenhuma versão ativa do parâmetro '${chave}'. Cadastre em Admin → Parâmetros.`,
      { chave },
    );
  }
  return parametro;
}
