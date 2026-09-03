import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CroquiConteudoSchema } from "@/server/ia/schema-croqui-slides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

const CorpoAtualizacaoSchema = z.object({
  titulo: z.string().min(1).max(200).optional(),
  status: z.enum(["rascunho", "pronto", "apresentado"]).optional(),
  conteudo: CroquiConteudoSchema.optional(),
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const { data: croqui, error } = await supabase
      .from("croquis")
      .select(
        "id, jornada_id, versao, titulo, status, conteudo, criado_em, atualizado_em, " +
          "croqui_analises(id, versao, conteudo, grau_confianca, criado_em)",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    return NextResponse.json({ croqui });
  } catch (erro) {
    return respostaErro("GET /api/croquis/[id]", erro);
  }
}

async function atualizar(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const corpo = CorpoAtualizacaoSchema.parse(await request.json());

    if (Object.keys(corpo).length === 0) {
      throw erroValidacao(null, "Nada para atualizar.");
    }

    const supabase = await criarClienteServidor();
    const { data: croqui, error } = await supabase
      .from("croquis")
      .update({ ...corpo, atualizado_por: usuario.id })
      .eq("id", id)
      .select("id, jornada_id, versao, titulo, status, conteudo, atualizado_em")
      .maybeSingle();

    if (error) throw error;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    return NextResponse.json({ croqui });
  } catch (erro) {
    return respostaErro("PATCH /api/croquis/[id]", erro);
  }
}

export const PATCH = atualizar;
// Alias: `src/lib/api.ts` (já escrito) chama `atualizarCroqui` com método PUT.
// Mantemos os dois verbos apontando para o mesmo handler em vez de forçar o
// front a mudar — PATCH é o verbo semanticamente correto (atualização parcial).
export const PUT = atualizar;
