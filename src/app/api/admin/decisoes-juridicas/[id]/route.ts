export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { DecisaoJuridicaAdmin } from "@/types/admin";

const ParametroSchema = z.object({ id: z.string().uuid() });

const CorpoSchema = z.object({
  motivo_revogacao: z.string().trim().min(1).max(2000),
});

/**
 * PATCH /api/admin/decisoes-juridicas/[id] — ÚNICA operação de escrita sobre
 * uma decisão já existente: revogar. `decisoes_juridicas` não tem rota de
 * edição de conteúdo (a trigger `app.impede_edicao_decisao_juridica`, 0048,
 * bloqueia UPDATE em escopo/descricao/base_legal/subprocessador mesmo que
 * uma rota tentasse) — mudar de ideia é `POST` de decisão nova depois de
 * revogar esta. `motivo_revogacao` é obrigatório: revogação sem motivo
 * escrito reabriria a mesma lacuna de auditoria que esta tabela existe para
 * fechar.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: revogada, error } = await supabase
      .from("decisoes_juridicas")
      .update({
        revogada_em: new Date().toISOString(),
        revogada_por: usuario.id,
        motivo_revogacao: corpo.motivo_revogacao,
      })
      .eq("id", id)
      .is("revogada_em", null)
      .select("*")
      .maybeSingle<DecisaoJuridicaAdmin>();

    if (error) {
      registrarErro("api/admin/decisoes-juridicas/[id] PATCH", error, { decisao_id: id });
      throw error;
    }
    if (!revogada) {
      throw erroNaoEncontrado(
        "Decisão jurídica não encontrada, ou já estava revogada.",
      );
    }

    return NextResponse.json({ decisao: revogada });
  } catch (erro) {
    return respostaErro("api/admin/decisoes-juridicas/[id] PATCH", erro);
  }
}
