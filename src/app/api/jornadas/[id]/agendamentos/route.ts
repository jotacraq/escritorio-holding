export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { AgendamentoSessao, SessaoViabilidade } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    inicio_em: z.string().datetime({ offset: true }),
    fim_em: z.string().datetime({ offset: true }),
    advogada_id: z.string().uuid().optional(),
    observacoes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => new Date(v.fim_em) > new Date(v.inicio_em), {
    message: "`fim_em` precisa ser depois de `inicio_em`.",
    path: ["fim_em"],
  });

/** Código de exclusion violation do Postgres — a Dra. Elaine não pode estar em duas salas ao mesmo tempo. */
const SQLSTATE_EXCLUSION_VIOLATION = "23P01";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    // Sessão de Viabilidade é 1:1 com a jornada — cria na primeira vez que alguém agenda.
    const { data: sessaoExistente, error: erroSessao } = await supabase
      .from("sessoes_viabilidade")
      .select("*")
      .eq("jornada_id", jornadaId)
      .maybeSingle();
    if (erroSessao) throw erroSessao;

    let sessao = sessaoExistente;

    if (!sessao) {
      const { data: novaSessao, error: erroCriarSessao } = await supabase
        .from("sessoes_viabilidade")
        .insert({ jornada_id: jornadaId, advogada_id: corpo.advogada_id ?? null })
        .select("*")
        .single();
      if (erroCriarSessao) {
        registrarErro("api/jornadas/[id]/agendamentos POST sessao", erroCriarSessao, { jornada_id: jornadaId });
        throw erroCriarSessao;
      }
      sessao = novaSessao;
    }

    const { data: agendamento, error } = await supabase
      .from("agendamentos")
      .insert({
        sessao_id: (sessao as SessaoViabilidade).id,
        inicio_em: corpo.inicio_em,
        fim_em: corpo.fim_em,
        advogada_id: corpo.advogada_id ?? null,
        observacoes: corpo.observacoes ?? null,
        status: "agendado",
        origem: "equipe",
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === SQLSTATE_EXCLUSION_VIOLATION) {
        throw erroConflito(
          "horario_indisponivel",
          "Este horário já está ocupado para a advogada selecionada.",
        );
      }
      registrarErro("api/jornadas/[id]/agendamentos POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ agendamento: agendamento as AgendamentoSessao }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/agendamentos POST", erro);
  }
}
