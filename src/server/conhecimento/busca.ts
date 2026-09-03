import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParametroBusca, ResultadoBusca } from "@/types/conhecimento";

/**
 * Busca full-text sobre `transcricoes.conteudo` (Módulo 4, `0032`).
 *
 * Toda a segurança mora na RPC `public.buscar_transcricoes_por_termo`:
 * `p_termo`/`p_tipo`/`p_desfecho` chegam como bind parameter (o cliente
 * supabase-js nunca concatena SQL), a função é `security invoker` (a RLS de
 * `transcricoes`/`casos_conhecimento` — `app.ve_patrimonio()` — filtra por
 * baixo) e usa `websearch_to_tsquery`, que nunca lança erro de sintaxe de
 * tsquery — não existe caminho para um termo de busca virar mensagem de erro
 * que ecoe trecho de transcrição de volta ao cliente.
 *
 * Esta função não faz nada além de repassar parâmetros e devolver a linha —
 * a rota (`src/app/api/conhecimento/busca/route.ts`) já garante
 * `exigirVePatrimonio()` antes de chegar aqui; a RLS é a segunda trava, não a
 * primeira.
 */
export async function buscarTranscricoes(
  supabase: SupabaseClient,
  params: ParametroBusca,
): Promise<ResultadoBusca[]> {
  const { data, error } = await supabase.rpc("buscar_transcricoes_por_termo", {
    p_termo: params.termo,
    p_tipo: params.tipo ?? null,
    p_desfecho: params.desfecho ?? null,
    p_limite: params.limite ?? 20,
    p_offset: params.offset ?? 0,
  });

  if (error) throw error;
  return (data ?? []) as ResultadoBusca[];
}
