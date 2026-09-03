export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { LigacaoEstrategica } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** Campos do POP 03 / 03-B (ver ARQUITETURA §2.6). Tudo opcional exceto `pop`,
 * porque a ligação pode ser salva em etapas (rascunho enquanto o colaborador liga). */
const CorpoLigacaoSchema = z.object({
  pop: z.enum(["03", "03-B"]).default("03"),
  duracao_segundos: z.number().int().min(0).max(3600).optional(),
  respostas: z.record(z.string(), z.unknown()).optional(),
  expectativa_principal: z.string().trim().max(2000).optional(),
  preocupacao_principal: z.string().trim().max(2000).optional(),
  assunto_atencao_especial: z.string().trim().max(2000).optional(),
  objecoes_percebidas: z.array(z.string().trim().max(500)).max(20).optional(),
  pessoas_mencionadas: z.array(z.string().trim().max(200)).max(20).optional(),
  ritmo: z.enum(["rapido", "moderado", "pausado"]).optional(),
  estilo_resposta: z.enum(["muito_objetiva", "objetiva", "detalhada", "conta_historias"]).optional(),
  sinais: z.array(z.string().trim().max(100)).max(20).optional(),
  frases_marcantes: z.array(z.string().trim().max(500)).max(3).optional(),
  processo_decisorio: z
    .enum(["influenciador", "comunicador", "decisor_conjunto", "decide_sozinho"])
    .optional(),
  decisores_presentes_na_sessao: z.boolean().optional(),
  transcricao: z.string().trim().max(50_000).optional(),
  observacoes: z.string().trim().max(5000).optional(),
});

async function verificarJornada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  jornadaId: string,
) {
  const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Jornada não encontrada.");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoLigacaoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    await verificarJornada(supabase, jornadaId);

    const { data: ligacao, error } = await supabase
      .from("ligacoes_estrategicas")
      .insert({ ...corpo, jornada_id: jornadaId, colaborador_id: usuario.id })
      .select("*")
      .single();

    if (error) {
      registrarErro("api/jornadas/[id]/ligacao POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ ligacao: ligacao as LigacaoEstrategica }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/ligacao POST", erro);
  }
}

/** Atualiza a ligação mais recente da jornada (uso: continuar um rascunho). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoLigacaoSchema.partial().parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: existente, error: erroExistente } = await supabase
      .from("ligacoes_estrategicas")
      .select("id")
      .eq("jornada_id", jornadaId)
      .order("realizada_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (erroExistente) throw erroExistente;
    if (!existente) {
      throw erroNaoEncontrado("Nenhuma ligação registrada para esta jornada ainda — use POST para criar.");
    }

    const { data: ligacao, error } = await supabase
      .from("ligacoes_estrategicas")
      .update(corpo)
      .eq("id", (existente as { id: string }).id)
      .select("*")
      .single();

    if (error) {
      registrarErro("api/jornadas/[id]/ligacao PUT", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ ligacao: ligacao as LigacaoEstrategica });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/ligacao PUT", erro);
  }
}
