export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { PerfilEquipeAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z
  .object({
    ativo: z.boolean().optional(),
    papel: z.enum(["admin", "advogada", "relacionamento", "assistente"]).optional(),
    nome: z.string().trim().min(2).max(200).optional(),
  })
  .refine((corpo) => corpo.ativo !== undefined || corpo.papel !== undefined || corpo.nome !== undefined, {
    message: "Informe ao menos um campo: ativo, papel ou nome.",
  });

/**
 * PATCH /api/admin/equipe/[id] — ativar/desativar e ajustar papel/nome.
 * NUNCA DELETE (regra da tarefa): baixa de acesso é `ativo=false`, que a RLS
 * (`app.eh_interno()`/`app.papel()`) já trata como "sem convite ativo" em
 * toda consulta do sistema — não precisa apagar linha nenhuma.
 * `email`/`auth_user_id` nunca mudam por aqui: e-mail é a chave de casamento
 * do primeiro login (`app.vincular_perfil`, 0002) — trocar por engano quebra
 * o vínculo de quem já tem convite pendente.
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
    if (corpo.ativo !== undefined) patch.ativo = corpo.ativo;
    if (corpo.papel !== undefined) patch.papel = corpo.papel;
    if (corpo.nome !== undefined) patch.nome = corpo.nome;

    const { data: atualizado, error } = await supabase
      .from("perfis_equipe")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle<PerfilEquipeAdmin>();

    if (error) {
      registrarErro("api/admin/equipe/[id] PATCH", error, { perfil_id: id });
      throw error;
    }
    if (!atualizado) throw erroNaoEncontrado("Perfil de equipe não encontrado.");

    return NextResponse.json({ perfil: atualizado });
  } catch (erro) {
    return respostaErro("api/admin/equipe/[id] PATCH", erro);
  }
}
