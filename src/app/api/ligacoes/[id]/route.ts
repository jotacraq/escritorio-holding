export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { LigacaoEstrategica } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    duracao_segundos: z.number().int().min(0).max(3600),
    respostas: z.record(z.string(), z.unknown()),
    expectativa_principal: z.string().trim().max(2000),
    preocupacao_principal: z.string().trim().max(2000),
    assunto_atencao_especial: z.string().trim().max(2000),
    objecoes_percebidas: z.array(z.string().trim().max(500)).max(20),
    pessoas_mencionadas: z.array(z.string().trim().max(200)).max(20),
    ritmo: z.enum(["rapido", "moderado", "pausado"]),
    estilo_resposta: z.enum(["muito_objetiva", "objetiva", "detalhada", "conta_historias"]),
    sinais: z.array(z.string().trim().max(100)).max(20),
    frases_marcantes: z.array(z.string().trim().max(500)).max(3),
    processo_decisorio: z.enum(["influenciador", "comunicador", "decisor_conjunto", "decide_sozinho"]),
    decisores_presentes_na_sessao: z.boolean(),
    transcricao: z.string().trim().max(50_000),
    observacoes: z.string().trim().max(5000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nenhum campo para atualizar." });

/** Edição direta de uma ligação por id (ex.: tela de histórico que não carrega a jornada inteira). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: ligacao, error } = await supabase
      .from("ligacoes_estrategicas")
      .update(corpo)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      registrarErro("api/ligacoes/[id] PUT", error, { ligacao_id: id });
      throw error;
    }
    if (!ligacao) throw erroNaoEncontrado("Ligação não encontrada.");

    return NextResponse.json({ ligacao: ligacao as LigacaoEstrategica });
  } catch (erro) {
    return respostaErro("api/ligacoes/[id] PUT", erro);
  }
}
