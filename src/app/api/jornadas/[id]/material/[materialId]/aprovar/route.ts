export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { COLUNAS_MATERIAL_RESUMO, paraResumoMaterial, type LinhaMaterialGerado } from "@/server/material/resumo";
import { gerarEGravarPdfMaterial } from "@/server/material/storage";
import type { RespostaAprovarMaterial, ResultadoPdfMaterial } from "@/types/material";

const ParametroSchema = z.object({ id: z.string().uuid(), materialId: z.string().uuid() });

/**
 * POST /api/jornadas/[id]/material/[materialId]/aprovar — aprovação humana do
 * material pós-sessão (BLOQUEIO B14: publicidade da advocacia, assinada por
 * advogada — não é ação de "relacionamento"). Trava de ROTA + trava de banco
 * (`aprovar_material_gerado`, 0031, confere o papel de novo por `auth.uid()`)
 * — as duas são obrigatórias, mesmo padrão de `exigirPapel` documentado em
 * `src/server/auth.ts`.
 *
 * Aprovar usa o cliente da SESSÃO do usuário (não `service_role`): a RPC já faz
 * seu próprio gate de papel via `auth.uid()`.
 *
 * Fase 4 (§3.3): DEPOIS da aprovação, e só então, o PDF é gerado + subido ao
 * bucket privado + registrado (`registrar_pdf_material`, service_role). Falha
 * no PDF NÃO desfaz a aprovação — volta em `pdf.estado='falhou'` com o motivo
 * e a tela oferece "gerar de novo" (`POST .../pdf`). Sem
 * `SUPABASE_SERVICE_ROLE_KEY`, a aprovação vale e `pdf.estado='indisponivel'`.
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

    const { error } = await supabase.rpc("aprovar_material_gerado", { p_material_id: materialId }).single();
    if (error) {
      if (error.code === "P0002") throw erroNaoEncontrado("Material não encontrado.");
      throw error;
    }

    let pdf: ResultadoPdfMaterial;
    try {
      const supabaseAdmin = criarClienteAdmin();
      pdf = await gerarEGravarPdfMaterial(supabaseAdmin, { materialId });
    } catch (erroServiceRole) {
      registrarErro("POST /api/jornadas/[id]/material/[materialId]/aprovar#service_role_ausente", erroServiceRole, {
        material_id: materialId,
      });
      pdf = { estado: "indisponivel", motivo: "PDF exige SUPABASE_SERVICE_ROLE_KEY no servidor — aprovação registrada; gere o PDF depois." };
    }

    // Relê pela sessão (RLS `mg_sel`) para devolver o estado REAL da linha —
    // inclusive `pdf_*` gravados pela RPC — em vez de montar à mão.
    const { data: linha, error: erroLeitura } = await supabase
      .from("materiais_gerados")
      .select(`${COLUNAS_MATERIAL_RESUMO}, materiais_modelos(chave)`)
      .eq("id", materialId)
      .single<LinhaMaterialGerado>();
    if (erroLeitura || !linha) throw erroLeitura ?? erroNaoEncontrado("Material não encontrado.");

    const resposta: RespostaAprovarMaterial = { material: paraResumoMaterial(linha), pdf };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/jornadas/[id]/material/[materialId]/aprovar", erro);
  }
}
