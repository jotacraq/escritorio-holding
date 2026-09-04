import type { SupabaseClient } from "@supabase/supabase-js";
import { construirSlidesBase } from "@/server/ia/schema-croqui-slides";

export interface CroquiRascunho {
  id: string;
  versao: number;
  /** `true` quando este croqui acabou de ser criado por esta chamada. */
  criado: boolean;
}

/**
 * Garante que existe um croqui em `rascunho` para a jornada antes de rodar a
 * Análise da Sessão (ARQUITETURA-FASE-3.md §2.2, rota
 * `POST /api/jornadas/[id]/analise-sessao`): a análise é INSUMO do croqui,
 * não o contrário — a advogada não deveria precisar criar o croqui à mão
 * antes de analisar a sessão.
 *
 * Se o croqui mais recente da jornada já está em `rascunho`, reaproveita (é
 * o rascunho que ela está iterando). Se não existe nenhum, OU o mais recente
 * já foi para `pronto`/`apresentado`, cria uma versão NOVA em `rascunho` —
 * nunca reabre um croqui já aprovado: a trava de revisão (0043,
 * `app.trava_croqui_pronto_exige_revisao`) existe exatamente para impedir
 * que a IA reescreva, por baixo, um croqui que a advogada já assinou.
 *
 * Usa o cliente com SESSÃO do chamador (RLS `cro_wr` — `ve_patrimonio()` —
 * aplica de verdade), mesmo padrão de `POST /api/croquis` já existente.
 */
export async function garantirCroquiRascunho(
  supabase: SupabaseClient,
  params: { jornadaId: string; usuarioId: string },
): Promise<CroquiRascunho> {
  const { jornadaId, usuarioId } = params;

  const { data: ultimo, error: erroUltimo } = await supabase
    .from("croquis")
    .select("id, versao, status")
    .eq("jornada_id", jornadaId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; versao: number; status: string }>();

  if (erroUltimo) throw erroUltimo;

  if (ultimo && ultimo.status === "rascunho") {
    return { id: ultimo.id, versao: ultimo.versao, criado: false };
  }

  const proximaVersao = (ultimo?.versao ?? 0) + 1;
  const { data: criado, error: erroCriacao } = await supabase
    .from("croquis")
    .insert({
      jornada_id: jornadaId,
      versao: proximaVersao,
      titulo: `Croqui Estrutural — v${proximaVersao}`,
      status: "rascunho",
      conteudo: construirSlidesBase(),
      criado_por: usuarioId,
      atualizado_por: usuarioId,
    })
    .select("id, versao")
    .single<{ id: string; versao: number }>();

  if (erroCriacao || !criado) {
    throw erroCriacao ?? new Error("falha_ao_criar_croqui_rascunho");
  }

  return { id: criado.id, versao: criado.versao, criado: true };
}
