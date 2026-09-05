import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { celulasDoModelo, resolverModeloDoCroqui } from "@/server/radar/modelo";
import type { MarcoExecucao, RespostaExecucao } from "@/types/jornada-automacoes";

/** Códigos de "essa tabela ainda não existe neste banco" (0067 não aplicada). */
const CODIGOS_AUSENTE = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

interface LinhaMarco {
  id: string;
  ordem: number;
  rotulo: string;
  fase: MarcoExecucao["fase"];
  prazo_dias: number | null;
  depende_de: string[] | null;
  paralelo: boolean;
}

/**
 * A sub-esteira de execução de uma jornada (§8.1, 0067): o cronograma real do
 * escritório entre a assinatura e a entrega.
 *
 * O catálogo é do método; o que é do cliente é só a lista de marcos JÁ
 * concluídos (`execucao_jornada_marcos`, que nasce vazia). Por isso a resposta
 * distingue "não há modelo" (`modelo: null`, `total: 0` — o trilho mostra "sem
 * informação") de "modelo com 19 marcos e nenhum concluído" (`feitos: 0`).
 *
 * Sem UI nesta rodada (a tela é da Onda 3): quem consome hoje é o trilho, via
 * `sinaisComExecucao`.
 */
export async function listarExecucao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<RespostaExecucao> {
  const vazio: RespostaExecucao = { modelo: null, marcos: [], feitos: 0, total: 0, entrega_em: null };

  const modeloCroqui = await resolverModeloDoCroqui(supabase, jornadaId);
  const celulas = celulasDoModelo(modeloCroqui);

  // Modelo de execução por número de células. Sem croqui definido, cai no
  // modelo ativo de maior cobertura — e só se existir UM catálogo ativo.
  const consulta = supabase.from("execucao_modelos").select("id, chave, celulas").eq("ativo", true).order("celulas", { ascending: false });
  const { data: modelos, error: erroModelo } = celulas > 0 ? await consulta.eq("celulas", celulas) : await consulta.limit(1);

  if (erroModelo) {
    if (CODIGOS_AUSENTE.has(erroModelo.code ?? "")) return vazio;
    registrarErro("server/execucao.listarExecucao#modelo", erroModelo, { jornada_id: jornadaId });
    throw erroModelo;
  }
  const modelo = (modelos as Array<{ id: string; chave: string }> | null)?.[0] ?? null;
  if (!modelo) return vazio;

  const [marcos, concluidos] = await Promise.all([
    carregarMarcos(supabase, jornadaId, modelo.id),
    carregarConcluidos(supabase, jornadaId),
  ]);

  const itens: MarcoExecucao[] = marcos.map((m) => {
    const feito = concluidos.get(m.id) ?? null;
    return {
      id: m.id,
      ordem: m.ordem,
      rotulo: m.rotulo,
      fase: m.fase,
      prazo_dias: m.prazo_dias,
      depende_de: m.depende_de ?? [],
      paralelo: m.paralelo,
      concluido_em: feito?.concluido_em ?? null,
      nota: feito?.nota ?? null,
    };
  });

  const entrega = itens.find((m) => m.fase === "entrega") ?? null;
  return {
    modelo: modelo.chave,
    marcos: itens,
    feitos: itens.filter((m) => m.concluido_em !== null).length,
    total: itens.length,
    entrega_em: entrega?.concluido_em ?? null,
  };
}

async function carregarMarcos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
  modeloId: string,
): Promise<LinhaMarco[]> {
  const { data, error } = await supabase
    .from("execucao_marcos")
    .select("id, ordem, rotulo, fase, prazo_dias, depende_de, paralelo")
    .eq("modelo_id", modeloId)
    .order("ordem", { ascending: true })
    .returns<LinhaMarco[]>();
  if (error) {
    registrarErro("server/execucao.carregarMarcos", error, { jornada_id: jornadaId });
    return [];
  }
  return data ?? [];
}

async function carregarConcluidos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<Map<string, { concluido_em: string; nota: string | null }>> {
  const { data, error } = await supabase
    .from("execucao_jornada_marcos")
    .select("marco_id, concluido_em, nota")
    .eq("jornada_id", jornadaId)
    .returns<Array<{ marco_id: string; concluido_em: string; nota: string | null }>>();
  if (error) {
    if (!CODIGOS_AUSENTE.has(error.code ?? "")) {
      registrarErro("server/execucao.carregarConcluidos", error, { jornada_id: jornadaId });
    }
    return new Map();
  }
  return new Map((data ?? []).map((linha) => [linha.marco_id, { concluido_em: linha.concluido_em, nota: linha.nota }]));
}
