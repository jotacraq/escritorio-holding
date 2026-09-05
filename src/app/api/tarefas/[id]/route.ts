export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { montarMensagemCroqui } from "@/server/regua/mensagem-croqui";
import type { Tarefa } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z.object({
  concluida: z.literal(true),
  /** Nota humana curta (vai para a timeline, tipo 'nota'). */
  nota: z.string().trim().max(500).optional(),
});

/**
 * GET /api/tarefas/[id] — a tarefa + (para `tipo='enviar_link_croqui'`) a
 * mensagem pronta renderizada do template `croqui_convite`, com as pendências
 * rotuladas (checkout não cadastrado, sem oferta, sem link de documentos).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data: tarefa, error } = await supabase.from("tarefas").select("*").eq("id", id).maybeSingle<Tarefa>();
    if (error) throw error;
    if (!tarefa) throw erroNaoEncontrado("Tarefa não encontrada.");

    const mensagemPronta = tarefa.tipo === "enviar_link_croqui" ? await montarMensagemCroqui(supabase, { jornadaId: tarefa.jornada_id }) : null;

    return NextResponse.json({ tarefa, mensagem_pronta: mensagemPronta });
  } catch (erro) {
    return respostaErro("api/tarefas/[id] GET", erro);
  }
}

/**
 * PATCH /api/tarefas/[id] `{concluida: true, nota?}` — "Marquei como enviado".
 * `concluida_em`/`concluida_por` são carimbados pelo banco
 * (`app.protege_tarefa`, 0051: quem está logado, agora; imutável depois).
 * Grava evento `nota` na timeline com ator humano.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: atual, error: erroAtual } = await supabase.from("tarefas").select("*").eq("id", id).maybeSingle<Tarefa>();
    if (erroAtual) throw erroAtual;
    if (!atual) throw erroNaoEncontrado("Tarefa não encontrada.");
    if (atual.concluida_em) {
      throw erroConflito("tarefa_ja_concluida", "Esta tarefa já foi concluída.");
    }

    const { data: concluida, error } = await supabase
      .from("tarefas")
      .update({ concluida_em: new Date().toISOString(), concluida_por: usuario.id })
      .eq("id", id)
      .is("concluida_em", null)
      .select("*")
      .single<Tarefa>();
    if (error) {
      registrarErro("api/tarefas/[id] PATCH", error, { tarefa_id: id });
      throw error;
    }

    const tituloEvento =
      atual.tipo === "enviar_link_croqui" ? "Link do croqui enviado pessoalmente" : `Tarefa concluída: ${atual.titulo}`;
    const { error: erroTimeline } = await supabase.from("eventos_timeline").insert({
      jornada_id: atual.jornada_id,
      tipo: "nota",
      titulo: tituloEvento,
      descricao: corpo.nota ?? null,
      dados: { tarefa_id: id, tipo: atual.tipo },
      ator_perfil_id: usuario.id,
      ator_tipo: "humano",
    });
    if (erroTimeline) {
      // A tarefa já está concluída; a timeline é registro secundário — loga, não desfaz.
      registrarErro("api/tarefas/[id] PATCH#timeline", erroTimeline, { tarefa_id: id });
    }

    return NextResponse.json({ tarefa: concluida });
  } catch (erro) {
    return respostaErro("api/tarefas/[id] PATCH", erro);
  }
}
