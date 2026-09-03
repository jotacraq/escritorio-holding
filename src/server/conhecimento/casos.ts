import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CasoComTranscricoes,
  CasoConhecimentoLinha,
  ContagemDesfecho,
  ParametroListaCasos,
  Transcricao,
} from "@/types/conhecimento";

/**
 * Lista de casos (Sessão de Viabilidade pareada, ou não, com apresentação de
 * Croqui) — `vw_casos_conhecimento` (0032), `security_invoker`: a RLS de
 * `casos_conhecimento`/`transcricoes` decide quem vê linha, esta função não
 * faz bypass nenhum.
 */
export async function listarCasos(
  supabase: SupabaseClient,
  params: ParametroListaCasos,
): Promise<CasoConhecimentoLinha[]> {
  const limite = params.limite ?? 50;
  const offset = params.offset ?? 0;

  let query = supabase
    .from("vw_casos_conhecimento")
    .select("*")
    .order("sv_data_reuniao", { ascending: false, nullsFirst: false })
    .range(offset, offset + limite - 1);

  if (params.desfecho) {
    query = query.eq("desfecho_observado", params.desfecho);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CasoConhecimentoLinha[];
}

/**
 * Os dois números do CONFLITO C13 (`vw_conhecimento_contagem_desfecho`).
 * Nunca reduzir isto a um percentual antes de chegar na tela — a tela é quem
 * decide como mostrar "indefinido" ao lado de "avançou para croqui", nunca
 * como "não converteu".
 */
export async function obterContagemDesfecho(supabase: SupabaseClient): Promise<ContagemDesfecho[]> {
  const { data, error } = await supabase.from("vw_conhecimento_contagem_desfecho").select("*");
  if (error) throw error;
  return (data ?? []) as ContagemDesfecho[];
}

/**
 * Leitura lado a lado: um caso com o conteúdo completo das duas transcrições
 * (quando existirem). `null` quando o caso não existe OU quando a RLS nega —
 * os dois casos colapsam de propósito (a rota trata como 404 uniforme, nunca
 * distinguindo "não existe" de "sem permissão").
 */
export async function obterCasoComTranscricoes(
  supabase: SupabaseClient,
  casoId: string,
): Promise<CasoComTranscricoes | null> {
  const { data: caso, error: erroCaso } = await supabase
    .from("vw_casos_conhecimento")
    .select("*")
    .eq("caso_id", casoId)
    .maybeSingle<CasoConhecimentoLinha>();

  if (erroCaso) throw erroCaso;
  if (!caso) return null;

  const ids = [caso.transcricao_sv_id, caso.transcricao_croqui_id].filter(
    (id): id is string => id != null,
  );

  const { data: transcricoes, error: erroTranscricoes } = await supabase
    .from("transcricoes")
    .select("*")
    .in("id", ids);

  if (erroTranscricoes) throw erroTranscricoes;

  const lista = (transcricoes ?? []) as Transcricao[];

  return {
    caso,
    sessao_viabilidade: lista.find((t) => t.id === caso.transcricao_sv_id) ?? null,
    apresentacao_croqui:
      caso.transcricao_croqui_id != null
        ? (lista.find((t) => t.id === caso.transcricao_croqui_id) ?? null)
        : null,
  };
}
