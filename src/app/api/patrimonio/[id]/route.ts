export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { PatrimonioItem } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    tipo: z.enum(["imovel", "veiculo", "investimento", "previdencia", "empresa", "outro"]),
    descricao: z.string().trim().min(1).max(500),
    ano_aquisicao: z.number().int().min(1900).max(2100).nullable(),
    valor_historico: z.number().min(0).max(1_000_000_000).nullable(),
    valor_mercado: z.number().min(0).max(1_000_000_000).nullable(),
    destinacao: z.string().trim().max(200).nullable(),
    valor_locacao_mensal: z.number().min(0).max(10_000_000).nullable(),
    detalhes: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nenhum campo para atualizar." });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: item, error } = await supabase
      .from("patrimonio_itens")
      .update({ ...corpo, atualizado_por: usuario.id })
      .eq("id", id)
      .eq("ativo", true)
      .select("*")
      .maybeSingle();

    if (error) {
      registrarErro("api/patrimonio/[id] PUT", error, { patrimonio_id: id });
      throw error;
    }
    if (!item) throw erroNaoEncontrado("Item de patrimônio não encontrado.");

    return NextResponse.json({ item: item as PatrimonioItem });
  } catch (erro) {
    return respostaErro("api/patrimonio/[id] PUT", erro);
  }
}

/** "Nada de DELETE" — baixa é `ativo = false`, nunca DELETE de verdade. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: item, error } = await supabase
      .from("patrimonio_itens")
      .update({ ativo: false, atualizado_por: usuario.id })
      .eq("id", id)
      .eq("ativo", true)
      .select("id")
      .maybeSingle();

    if (error) {
      registrarErro("api/patrimonio/[id] DELETE", error, { patrimonio_id: id });
      throw error;
    }
    if (!item) throw erroNaoEncontrado("Item de patrimônio não encontrado.");

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return respostaErro("api/patrimonio/[id] DELETE", erro);
  }
}
