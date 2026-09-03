import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transcricao } from "@/types/conhecimento";

/**
 * Leitura de uma transcrição por id, conteúdo completo incluído. `null`
 * quando não existe OU quando a RLS (`app.ve_patrimonio()`) nega — os dois
 * casos colapsam de propósito, a rota trata como 404 uniforme (mesmo
 * racional de `src/app/api/relatorios/[id]/route.ts`).
 */
export async function obterTranscricaoPorId(
  supabase: SupabaseClient,
  id: string,
): Promise<Transcricao | null> {
  const { data, error } = await supabase.from("transcricoes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Transcricao | null) ?? null;
}
