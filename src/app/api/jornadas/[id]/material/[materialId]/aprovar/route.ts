export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import type { FonteDorMaterial, OrigemDadoMaterial, RespostaAprovarMaterial } from "@/types/material";

const ParametroSchema = z.object({ id: z.string().uuid(), materialId: z.string().uuid() });

interface LinhaMaterialAprovado {
  id: string;
  versao: number;
  fonte_dor: FonteDorMaterial;
  dor_principal: string | null;
  origem_dado: OrigemDadoMaterial;
  atual: boolean;
  aprovado_por: string | null;
  aprovado_em: string | null;
  criado_em: string;
}

/**
 * POST /api/jornadas/[id]/material/[materialId]/aprovar — aprovação humana do
 * material pós-sessão (BLOQUEIO B14: publicidade da advocacia, assinada por
 * advogada — não é ação de "relacionamento"). Trava de ROTA + trava de banco
 * (`aprovar_material_gerado`, 0031, confere o papel de novo por `auth.uid()`)
 * — as duas são obrigatórias, mesmo padrão de `exigirPapel` documentado em
 * `src/server/auth.ts`.
 *
 * Usa o cliente da SESSÃO do usuário (não `service_role`): a RPC já faz seu
 * próprio gate de papel via `auth.uid()`, exatamente como `emitir_link_publico`/
 * `revogar_link_publico` (0028) — aprovar não precisa (nem deve) rodar fora da
 * identidade de quem aprovou.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  try {
    await exigirPapel("admin", "advogada");
    const { id: jornadaId, materialId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    // Confere que o material pertence de fato a esta jornada ANTES de chamar a
    // RPC — evita a URL de uma jornada aprovar (por engano, não por falha de
    // segurança: a RPC não recebe jornada_id) o material de outra.
    const { data: material, error: erroMaterial } = await supabase
      .from("materiais_gerados")
      .select("id")
      .eq("id", materialId)
      .eq("jornada_id", jornadaId)
      .maybeSingle();
    if (erroMaterial) throw erroMaterial;
    if (!material) {
      throw erroNaoEncontrado("Material não encontrado para esta jornada.");
    }

    const { data: linha, error } = await supabase
      .rpc("aprovar_material_gerado", { p_material_id: materialId })
      .single<LinhaMaterialAprovado>();

    if (error) {
      if (error.code === "P0002") throw erroNaoEncontrado("Material não encontrado.");
      throw error;
    }
    if (!linha) throw erroNaoEncontrado("Material não encontrado.");

    const resposta: RespostaAprovarMaterial = {
      material: {
        id: linha.id,
        versao: linha.versao,
        chave_modelo: null,
        fonte_dor: linha.fonte_dor,
        dor_principal: linha.dor_principal,
        origem_dado: linha.origem_dado,
        atual: linha.atual,
        aprovado_por: linha.aprovado_por,
        aprovado_em: linha.aprovado_em,
        criado_em: linha.criado_em,
      },
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/jornadas/[id]/material/[materialId]/aprovar", erro);
  }
}
