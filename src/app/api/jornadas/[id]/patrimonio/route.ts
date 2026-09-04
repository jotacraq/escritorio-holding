export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { PatrimonioItem } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * PII sensível — só `admin`/`advogada` (ver `app.ve_patrimonio()`). `exigirVePatrimonio`
 * é a trava de rota; a policy `pat_sel`/`pat_wr` é a trava de banco. As duas, sempre.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("pessoa_id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: itens, error } = await supabase
      .from("patrimonio_itens")
      .select("*")
      .eq("pessoa_id", (jornada as { pessoa_id: string }).pessoa_id)
      .eq("ativo", true)
      .order("criado_em", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ itens: (itens as PatrimonioItem[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/patrimonio GET", erro);
  }
}

const CorpoSchema = z.object({
  tipo: z.enum(["imovel", "veiculo", "investimento", "previdencia", "empresa", "outro"]),
  descricao: z.string().trim().min(1).max(500),
  // `.nullish()`, nao `.optional()`: a tela manda `null` no campo que a
  // pessoa deixou em branco — e `null` nao e ausencia para o Zod. Com
  // `.optional()` toda criacao de item patrimonial respondia 422, o que
  // derrubava a aba inteira de patrimonio (achado do agente G, 04/09/2026).
  ano_aquisicao: z.number().int().min(1900).max(2100).nullish(),
  valor_historico: z.number().min(0).max(1_000_000_000).nullish(),
  valor_mercado: z.number().min(0).max(1_000_000_000).nullish(),
  destinacao: z.string().trim().max(200).nullish(),
  valor_locacao_mensal: z.number().min(0).max(10_000_000).nullish(),
  detalhes: z.record(z.string(), z.unknown()).nullish(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("pessoa_id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: item, error } = await supabase
      .from("patrimonio_itens")
      .insert({
        ...corpo,
        pessoa_id: (jornada as { pessoa_id: string }).pessoa_id,
        registrado_na_jornada_id: jornadaId,
        criado_por: usuario.id,
        atualizado_por: usuario.id,
      })
      .select("*")
      .single();

    if (error) {
      registrarErro("api/jornadas/[id]/patrimonio POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ item: item as PatrimonioItem }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/patrimonio POST", erro);
  }
}
