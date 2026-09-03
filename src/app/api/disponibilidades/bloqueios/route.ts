export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { CorpoCriarBloqueioSchema } from "@/types/agenda";
import type { AgendaBloqueio } from "@/types/agenda";

const QuerySchema = z.object({
  advogada_id: z.string().uuid().optional(),
  incluir_cancelados: z.enum(["true", "false"]).optional(),
});

/** Lista os bloqueios pontuais (folga, feriado, compromisso fora da agenda). */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const { advogada_id: advogadaId, incluir_cancelados: incluirCancelados } = QuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );

    const supabase = await criarClienteServidor();
    let query = supabase.from("agenda_bloqueios").select("*").order("inicio_em", { ascending: true });
    if (advogadaId) query = query.eq("advogada_id", advogadaId);
    if (incluirCancelados !== "true") query = query.is("cancelado_em", null);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/disponibilidades/bloqueios GET", error);
      throw error;
    }

    return NextResponse.json({ bloqueios: (data ?? []) as AgendaBloqueio[] });
  } catch (erro) {
    return respostaErro("api/disponibilidades/bloqueios GET", erro);
  }
}

/** Cria uma exceção pontual. Restrito a admin/advogada, mesmo recorte da RLS. */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin", "advogada");
    const corpo = CorpoCriarBloqueioSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("agenda_bloqueios")
      .insert({
        advogada_id: corpo.advogada_id,
        inicio_em: corpo.inicio_em,
        fim_em: corpo.fim_em,
        motivo: corpo.motivo,
        criado_por: usuario.id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23514") {
        throw erroValidacao({ postgres: error.message }, "Janela do bloqueio inválida.");
      }
      registrarErro("api/disponibilidades/bloqueios POST", error, { advogada_id: corpo.advogada_id });
      throw error;
    }

    return NextResponse.json({ bloqueio: data as AgendaBloqueio }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/disponibilidades/bloqueios POST", erro);
  }
}
