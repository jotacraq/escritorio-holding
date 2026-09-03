export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { CHAVE_DURACAO_PADRAO_MINUTOS, lerConfiguracaoInt } from "@/server/agenda/config";
import { CorpoCriarDisponibilidadeSchema } from "@/types/agenda";
import type { Disponibilidade } from "@/types/agenda";

const QuerySchema = z.object({ advogada_id: z.string().uuid().optional() });

/** Lista as janelas de disponibilidade (ativas e inativas — a tela decide o que mostrar). */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const { advogada_id: advogadaId } = QuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );

    const supabase = await criarClienteServidor();
    let query = supabase.from("disponibilidades").select("*").order("dia_semana").order("hora_inicio");
    if (advogadaId) query = query.eq("advogada_id", advogadaId);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/disponibilidades GET", error);
      throw error;
    }

    return NextResponse.json({ disponibilidades: (data ?? []) as Disponibilidade[] });
  } catch (erro) {
    return respostaErro("api/disponibilidades GET", erro);
  }
}

/**
 * Cria uma janela recorrente de disponibilidade. Restrito a admin/advogada
 * (mesmo recorte de RLS da tabela — guarda de papel além da RLS, CLAUDE.md):
 * é a agenda de trabalho da advogada, não uma configuração que qualquer
 * interno deveria poder alterar.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin", "advogada");
    const corpo = CorpoCriarDisponibilidadeSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    // BLOQUEIO B12: duração NÃO é constante em código — sem valor explícito no
    // corpo, lê o valor inicial ajustável em `configuracoes`.
    const duracaoMinutos =
      corpo.duracao_minutos ?? (await lerConfiguracaoInt(supabase, CHAVE_DURACAO_PADRAO_MINUTOS, 60));

    const { data, error } = await supabase
      .from("disponibilidades")
      .insert({
        advogada_id: corpo.advogada_id,
        dia_semana: corpo.dia_semana,
        hora_inicio: corpo.hora_inicio,
        hora_fim: corpo.hora_fim,
        duracao_minutos: duracaoMinutos,
        vale_de: corpo.vale_de ?? undefined,
        vale_ate: corpo.vale_ate ?? null,
        criado_por: usuario.id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23514") {
        // ck_disp_janela / ck_disp_vigencia — mesma janela inválida, checada de
        // novo pelo banco (defesa em profundidade além do refine do zod).
        throw erroValidacao({ postgres: error.message }, "Janela de horário inválida.");
      }
      registrarErro("api/disponibilidades POST", error, { advogada_id: corpo.advogada_id });
      throw error;
    }

    return NextResponse.json({ disponibilidade: data as Disponibilidade }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/disponibilidades POST", erro);
  }
}
