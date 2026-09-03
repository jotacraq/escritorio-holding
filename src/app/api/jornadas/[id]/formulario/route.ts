export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { Formulario, FormularioResposta } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const [{ data: formulario, error: erroFormulario }, { data: resposta, error: erroResposta }] =
      await Promise.all([
        supabase.from("formularios").select("*").eq("chave", "estrategico").eq("ativo", true).maybeSingle(),
        supabase.from("formularios_respostas").select("*").eq("jornada_id", jornadaId).maybeSingle(),
      ]);

    if (erroFormulario) throw erroFormulario;
    if (erroResposta) throw erroResposta;

    return NextResponse.json({
      formulario: (formulario as Formulario | null) ?? null,
      resposta: (resposta as FormularioResposta | null) ?? null,
    });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/formulario GET", erro);
  }
}

const CorpoSchema = z.object({
  formulario_id: z.string().uuid(),
  respostas: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: "`respostas` não pode ser vazio.",
  }),
});

/** Chave da pergunta de faixa de patrimônio no POP 02 (ver seed 0016 e ARQUITETURA §2.6). */
const CHAVE_PERGUNTA_FAIXA_PATRIMONIO = "p9";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    }));

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: resposta, error: erroUpsert } = await supabase
      .from("formularios_respostas")
      .upsert(
        {
          jornada_id: jornadaId,
          formulario_id: corpo.formulario_id,
          respostas: corpo.respostas,
          respondido_em: new Date().toISOString(),
        },
        { onConflict: "jornada_id" },
      )
      .select("*")
      .single();

    if (erroUpsert) {
      registrarErro("api/jornadas/[id]/formulario PUT", erroUpsert, { jornada_id: jornadaId });
      throw erroUpsert;
    }

    // A faixa declarada (P9) é o único dado patrimonial que a equipe toda enxerga —
    // espelhada em jornadas.faixa_patrimonio_declarada por ser lida direto no kanban.
    const faixa = corpo.respostas[CHAVE_PERGUNTA_FAIXA_PATRIMONIO];
    if (typeof faixa === "string" && faixa.trim().length > 0) {
      const { error: erroFaixa } = await supabase
        .from("jornadas")
        .update({ faixa_patrimonio_declarada: faixa })
        .eq("id", jornadaId);
      if (erroFaixa) {
        registrarErro("api/jornadas/[id]/formulario PUT faixa", erroFaixa, { jornada_id: jornadaId });
      }
    }

    return NextResponse.json({ resposta: resposta as FormularioResposta });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/formulario PUT", erro);
  }
}
