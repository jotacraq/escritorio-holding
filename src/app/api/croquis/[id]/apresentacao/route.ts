import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  acao: z.enum(["iniciar", "encerrar"]),
  slides_vistos: z.number().int().min(0).max(13).optional(),
});

/**
 * POST /api/croquis/[id]/apresentacao — inicia ou encerra uma apresentação do
 * croqui em modo tela cheia (F6). Ao ENCERRAR, avança a etapa da jornada para
 * `croqui_apresentado` (§3 do ARQUITETURA.md) por escrita normal via RLS (o
 * papel do usuário já precisa satisfazer `jor_upd` em 0004), não por edição do
 * schema de jornadas (fora da minha fronteira).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const corpo = CorpoSchema.parse(await request.json());

    const supabase = await criarClienteServidor();

    const { data: croqui, error: erroCroqui } = await supabase
      .from("croquis")
      .select("id, jornada_id")
      .eq("id", id)
      .maybeSingle<{ id: string; jornada_id: string }>();

    if (erroCroqui) throw erroCroqui;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    if (corpo.acao === "iniciar") {
      const { data: apresentacao, error } = await supabase
        .from("croqui_apresentacoes")
        .insert({ croqui_id: croqui.id, apresentador_id: usuario.id })
        .select("id, croqui_id, iniciada_em")
        .single();

      if (error || !apresentacao) throw error ?? new Error("falha_ao_iniciar_apresentacao");
      return NextResponse.json({ apresentacao }, { status: 201 });
    }

    // acao === "encerrar": fecha a apresentação em aberto mais recente.
    const { data: apresentacaoAberta } = await supabase
      .from("croqui_apresentacoes")
      .select("id")
      .eq("croqui_id", croqui.id)
      .is("encerrada_em", null)
      .order("iniciada_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (!apresentacaoAberta) {
      throw erroConflito("nenhuma_apresentacao_em_aberto", "Não há apresentação em aberto para encerrar.");
    }

    const { data: apresentacaoEncerrada, error: erroEncerrar } = await supabase
      .from("croqui_apresentacoes")
      .update({ encerrada_em: new Date().toISOString(), slides_vistos: corpo.slides_vistos ?? null })
      .eq("id", apresentacaoAberta.id)
      .select("id, croqui_id, iniciada_em, encerrada_em, slides_vistos")
      .single();

    if (erroEncerrar || !apresentacaoEncerrada) {
      throw erroEncerrar ?? new Error("falha_ao_encerrar_apresentacao");
    }

    // Best-effort: se a transição de etapa não for válida (0004), a apresentação
    // já foi encerrada e não desfazemos isso — só registramos.
    const { error: erroEtapa } = await supabase
      .from("jornadas")
      .update({ etapa: "croqui_apresentado" })
      .eq("id", croqui.jornada_id)
      .neq("etapa", "croqui_apresentado");

    if (erroEtapa) {
      registrarErro("POST /api/croquis/[id]/apresentacao#avancar_etapa", erroEtapa, {
        jornada_id: croqui.jornada_id,
      });
    }

    return NextResponse.json({ apresentacao: apresentacaoEncerrada });
  } catch (erro) {
    return respostaErro("POST /api/croquis/[id]/apresentacao", erro);
  }
}
