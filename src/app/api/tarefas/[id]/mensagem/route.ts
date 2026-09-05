export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { linkDocumentosValido, montarMensagemCroqui } from "@/server/regua/mensagem-croqui";
import type { Tarefa } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  /** URL devolvida por `POST /api/jornadas/[id]/links {tipo:'documentos'}` (só aparece uma vez — a tela repassa aqui). */
  link_documentos: z.string().url().max(500).optional(),
});

/**
 * POST /api/tarefas/[id]/mensagem — re-renderiza a mensagem pronta da tarefa
 * "Enviar link do croqui" incluindo o link `/p/d` que a tela acabou de gerar.
 * O token do link nunca é reexibido pelo servidor (§4.1 da Fase 2) — por isso
 * a tela manda a URL de volta em vez de a rota tentar recuperá-la.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    if (corpo.link_documentos && !linkDocumentosValido(corpo.link_documentos)) {
      throw erroValidacao({ campo: "link_documentos" }, "Só links de documentos deste sistema (/p/d/…) são aceitos.");
    }

    const supabase = await criarClienteServidor();
    const { data: tarefa, error } = await supabase.from("tarefas").select("*").eq("id", id).maybeSingle<Tarefa>();
    if (error) throw error;
    if (!tarefa) throw erroNaoEncontrado("Tarefa não encontrada.");
    if (tarefa.tipo !== "enviar_link_croqui") {
      throw erroConflito("tarefa_sem_mensagem", "Só a tarefa 'enviar_link_croqui' tem mensagem pronta.");
    }

    const mensagemPronta = await montarMensagemCroqui(supabase, { jornadaId: tarefa.jornada_id, linkDocumentos: corpo.link_documentos });
    return NextResponse.json({ mensagem_pronta: mensagemPronta });
  } catch (erro) {
    return respostaErro("api/tarefas/[id]/mensagem POST", erro);
  }
}
