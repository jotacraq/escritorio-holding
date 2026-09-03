export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { EdicaoSeminario } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

const DataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");

const CorpoSchema = z
  .object({
    nome: z.string().trim().min(2).max(200).optional(),
    inicio_em: DataSchema.optional(),
    fim_em: DataSchema.optional(),
    ativa: z.boolean().optional(),
  })
  .refine(
    (corpo) =>
      corpo.nome !== undefined ||
      corpo.inicio_em !== undefined ||
      corpo.fim_em !== undefined ||
      corpo.ativa !== undefined,
    { message: "Informe ao menos um campo: nome, inicio_em, fim_em ou ativa." },
  );

interface ErroPostgrest {
  code?: string;
  message: string;
}

/**
 * PATCH /api/admin/edicoes/[id] — nunca DELETE (baixa é `ativa=false`).
 * `codigo` nunca muda por aqui: é a chave que `participacoes_seminario` e as
 * views de indicador usam para agrupar coorte — trocar por engano confunde
 * histórico com edição nova.
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
    if (corpo.inicio_em !== undefined) patch.inicio_em = corpo.inicio_em;
    if (corpo.fim_em !== undefined) patch.fim_em = corpo.fim_em;
    if (corpo.ativa !== undefined) patch.ativa = corpo.ativa;

    const { data: atualizada, error } = await supabase
      .from("edicoes_seminario")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle<EdicaoSeminario>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.code === "23514") {
        throw erroValidacao(null, "fim_em precisa ser igual ou posterior a inicio_em.");
      }
      registrarErro("api/admin/edicoes/[id] PATCH", error, { edicao_id: id });
      throw error;
    }
    if (!atualizada) throw erroNaoEncontrado("Edição não encontrada.");

    return NextResponse.json({ edicao: atualizada });
  } catch (erro) {
    return respostaErro("api/admin/edicoes/[id] PATCH", erro);
  }
}
