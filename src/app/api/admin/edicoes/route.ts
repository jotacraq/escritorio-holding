export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { EdicaoSeminario } from "@/types/admin";

/** GET /api/admin/edicoes — todas as edições, mais recente primeiro. */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("edicoes_seminario")
      .select("*")
      .order("inicio_em", { ascending: false });

    if (error) {
      registrarErro("api/admin/edicoes GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as EdicaoSeminario[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/edicoes GET", erro);
  }
}

const DataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");

const CorpoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(50),
    nome: z.string().trim().min(2).max(200),
    inicio_em: DataSchema,
    fim_em: DataSchema,
  })
  .refine((corpo) => corpo.fim_em >= corpo.inicio_em, {
    message: "fim_em precisa ser igual ou posterior a inicio_em.",
    path: ["fim_em"],
  });

interface ErroPostgrest {
  code?: string;
  message: string;
}

/** POST /api/admin/edicoes — nova edição do seminário. `ativa=true` por padrão da tabela. */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: criada, error } = await supabase
      .from("edicoes_seminario")
      .insert({
        codigo: corpo.codigo,
        nome: corpo.nome,
        inicio_em: corpo.inicio_em,
        fim_em: corpo.fim_em,
      })
      .select("*")
      .single<EdicaoSeminario>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.code === "23505") {
        throw erroConflito("codigo_ja_usado", "Já existe uma edição com este código.");
      }
      if (pg.code === "23514") {
        throw erroValidacao(null, "fim_em precisa ser igual ou posterior a inicio_em.");
      }
      registrarErro("api/admin/edicoes POST", error, { corpo });
      throw error;
    }

    return NextResponse.json({ edicao: criada }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/edicoes POST", erro);
  }
}
