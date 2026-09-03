export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { CorpoAtualizarDisponibilidadeSchema } from "@/types/agenda";
import type { Disponibilidade } from "@/types/agenda";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * Atualiza uma janela (inclusive desativar via `ativa:false` — nunca DELETE,
 * baixa lógica é a convenção do projeto inteiro). Restrito a admin/advogada,
 * mesmo recorte de `POST /api/disponibilidades`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada");
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoAtualizarDisponibilidadeSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    if (corpo.hora_inicio && corpo.hora_fim && corpo.hora_fim <= corpo.hora_inicio) {
      throw erroValidacao(null, "`hora_fim` precisa ser depois de `hora_inicio`.");
    }

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("disponibilidades")
      .update(corpo)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23514") {
        throw erroValidacao({ postgres: error.message }, "Janela de horário inválida.");
      }
      registrarErro("api/disponibilidades/[id] PATCH", error, { id });
      throw error;
    }
    if (!data) throw erroNaoEncontrado("Disponibilidade não encontrada.");

    return NextResponse.json({ disponibilidade: data as Disponibilidade });
  } catch (erro) {
    return respostaErro("api/disponibilidades/[id] PATCH", erro);
  }
}
