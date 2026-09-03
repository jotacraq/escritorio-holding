export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { ProdutoAdmin } from "@/types/admin";

/** GET /api/admin/produtos — todos os produtos (ativos e inativos). */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .order("tipo", { ascending: true })
      .order("nome", { ascending: true });

    if (error) {
      registrarErro("api/admin/produtos GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as ProdutoAdmin[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/produtos GET", erro);
  }
}

const CorpoSchema = z.object({
  tipo: z.enum(["sessao_viabilidade", "croqui_estrutural", "holding"]),
  nome: z.string().trim().min(2).max(200),
  hotmart_produto_id: z.string().trim().min(1).max(100).nullish(),
});

interface ErroPostgrest {
  code?: string;
  message: string;
}

/**
 * POST /api/admin/produtos — cadastra o mapeamento produto Hotmart -> tipo
 * (BLOQUEIO B7 do plano v1). Sem esta linha, `processar_pagamento_hotmart`
 * (0011) marca o pagamento como `produto_nao_mapeado` — é exatamente o que a
 * aba Pendências mostra e esta tela resolve.
 */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: criado, error } = await supabase
      .from("produtos")
      .insert({
        tipo: corpo.tipo,
        nome: corpo.nome,
        hotmart_produto_id: corpo.hotmart_produto_id ?? null,
      })
      .select("*")
      .single<ProdutoAdmin>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.code === "23505") {
        throw erroConflito(
          "hotmart_produto_id_ja_usado",
          "Já existe um produto cadastrado com este ID da Hotmart.",
        );
      }
      registrarErro("api/admin/produtos POST", error, { corpo });
      throw error;
    }

    return NextResponse.json({ produto: criado }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/produtos POST", erro);
  }
}
