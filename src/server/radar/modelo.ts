import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { ModeloCroquiRadar } from "@/types/jornada-automacoes";

/**
 * Qual modelo do croqui está em jogo nesta jornada — a pergunta que o radar de
 * entrega e a sub-esteira de execução fazem antes de listar qualquer coisa.
 *
 * Ordem de leitura, da fonte mais forte para a mais fraca:
 *   1. `croqui_calculos` atual (0062, M1) — o cálculo fixado é a decisão tomada.
 *   2. `cenarios_patrimoniais` (0057) — o cenário mais avançado já montado.
 *   3. `null` — não sabemos, e o radar de entrega fica vazio em vez de chutar
 *      "3 células" para todo mundo.
 *
 * Tolerante a tabela ausente: a 0062 é do M1 e pode não ter sido aplicada
 * ainda. Erro de tabela inexistente cai para a fonte seguinte, em silêncio.
 */
const CODIGOS_AUSENTE = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

const CENARIO_PARA_MODELO: Record<string, ModeloCroquiRadar> = {
  inventario: "inventario",
  doacao: "doacao",
  holding_1_celula: "celula_1",
  holding_2_celulas: "celula_2",
  holding_3_celulas: "celula_3",
};

/** Do mais avançado para o menos: o modelo que manda é o de mais células. */
const FORCA: ModeloCroquiRadar[] = ["celula_3", "celula_2", "celula_1", "doacao", "inventario"];

export function celulasDoModelo(modelo: ModeloCroquiRadar | null): number {
  if (modelo === "celula_3") return 3;
  if (modelo === "celula_2") return 2;
  if (modelo === "celula_1") return 1;
  return 0;
}

export async function resolverModeloDoCroqui(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<ModeloCroquiRadar | null> {
  const doCalculo = await modeloDoCalculoAtual(supabase, jornadaId);
  if (doCalculo) return doCalculo;
  return modeloDosCenarios(supabase, jornadaId);
}

async function modeloDoCalculoAtual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<ModeloCroquiRadar | null> {
  try {
    const { data, error } = await supabase
      .from("croqui_calculos")
      .select("entrada_snapshot")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle<{ entrada_snapshot: { modelos?: unknown } | null }>();
    if (error) {
      if (!CODIGOS_AUSENTE.has(error.code ?? "")) {
        registrarErro("server/radar.modeloDoCalculoAtual", error, { jornada_id: jornadaId });
      }
      return null;
    }
    const modelos = data?.entrada_snapshot?.modelos;
    if (!Array.isArray(modelos)) return null;
    return maisForte(modelos.filter((m): m is string => typeof m === "string"));
  } catch (erro) {
    registrarErro("server/radar.modeloDoCalculoAtual", erro, { jornada_id: jornadaId });
    return null;
  }
}

async function modeloDosCenarios(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<ModeloCroquiRadar | null> {
  try {
    const { data, error } = await supabase
      .from("cenarios_patrimoniais")
      .select("cenario")
      .eq("jornada_id", jornadaId)
      .returns<Array<{ cenario: string }>>();
    if (error) {
      if (!CODIGOS_AUSENTE.has(error.code ?? "")) {
        registrarErro("server/radar.modeloDosCenarios", error, { jornada_id: jornadaId });
      }
      return null;
    }
    return maisForte((data ?? []).map((linha) => CENARIO_PARA_MODELO[linha.cenario] ?? linha.cenario));
  } catch (erro) {
    registrarErro("server/radar.modeloDosCenarios", erro, { jornada_id: jornadaId });
    return null;
  }
}

function maisForte(valores: string[]): ModeloCroquiRadar | null {
  for (const candidato of FORCA) {
    if (valores.includes(candidato)) return candidato;
  }
  return null;
}
