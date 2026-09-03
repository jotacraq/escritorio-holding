export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { ProdutoAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    nome: z.string().trim().min(2).max(200).optional(),
    hotmart_produto_id: z.string().trim().min(1).max(100).nullish(),
    ativo: z.boolean().optional(),
  })
  .refine(
    (corpo) => corpo.nome !== undefined || corpo.hotmart_produto_id !== undefined || corpo.ativo !== undefined,
    { message: "Informe ao menos um campo: nome, hotmart_produto_id ou ativo." },
  );

interface ErroPostgrest {
  code?: string;
  message: string;
}

/**
 * PATCH /api/admin/produtos/[id] — nunca troca `tipo` (é o que decide o nível
 * pago que `app.atualiza_nivel_pago` credita — trocar por engano reclassifica
 * pagamento já registrado) nem DELETE (baixa é `ativo=false`).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const patch: Record<string, unknown> = {};
    if (corpo.nome !== undefined) patch.nome = corpo.nome;
    if (corpo.hotmart_produto_id !== undefined) patch.hotmart_produto_id = corpo.hotmart_produto_id ?? null;
    if (corpo.ativo !== undefined) patch.ativo = corpo.ativo;

    const { data: atualizado, error } = await supabase
      .from("produtos")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle<ProdutoAdmin>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.code === "23505") {
        throw erroConflito(
          "hotmart_produto_id_ja_usado",
          "Já existe um produto cadastrado com este ID da Hotmart.",
        );
      }
      registrarErro("api/admin/produtos/[id] PATCH", error, { produto_id: id });
      throw error;
    }
    if (!atualizado) throw erroNaoEncontrado("Produto não encontrado.");

    return NextResponse.json({ produto: atualizado });
  } catch (erro) {
    return respostaErro("api/admin/produtos/[id] PATCH", erro);
  }
}
