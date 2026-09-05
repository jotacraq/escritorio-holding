export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { COLUNAS_MATERIAL_RESUMO, paraResumoMaterial, type LinhaMaterialGerado } from "@/server/material/resumo";
import { assinarUrlPdfMaterial, gerarEGravarPdfMaterial } from "@/server/material/storage";
import type { RespostaAprovarMaterial, RespostaUrlPdfMaterial } from "@/types/material";

const ParametroSchema = z.object({ id: z.string().uuid(), materialId: z.string().uuid() });

function clienteAdminOu503(contexto: string, extra: Record<string, unknown>) {
  try {
    return criarClienteAdmin();
  } catch (erroServiceRole) {
    registrarErro(`${contexto}#service_role_ausente`, erroServiceRole, extra);
    throw new ErroApi(503, "servico_indisponivel", "PDF do material exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.");
  }
}

/** Metadados lidos pela SESSÃO (RLS `mg_sel`) — a rota nunca confia só no id da URL. */
async function lerMaterialDaJornada(jornadaId: string, materialId: string): Promise<LinhaMaterialGerado> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("materiais_gerados")
    .select(`${COLUNAS_MATERIAL_RESUMO}, materiais_modelos(chave)`)
    .eq("id", materialId)
    .eq("jornada_id", jornadaId)
    .maybeSingle<LinhaMaterialGerado>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Material não encontrado para esta jornada.");
  return data;
}

/**
 * GET /api/jornadas/[id]/material/[materialId]/pdf — URL assinada (300 s) do PDF
 * para a EQUIPE (qualquer papel interno, mesmo recorte de `mg_sel`: material
 * não é patrimônio). 404 quando o material ainda não tem PDF — a tela mostra
 * `pdf_erro`/"gerar de novo" em vez de tentar baixar.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const contexto = "GET /api/jornadas/[id]/material/[materialId]/pdf";
  try {
    await exigirInterno();
    const { id: jornadaId, materialId } = ParametroSchema.parse(await params);

    const material = await lerMaterialDaJornada(jornadaId, materialId);
    if (!material.pdf_caminho) {
      throw new ErroApi(404, "pdf_indisponivel", "Este material ainda não tem PDF gerado.");
    }

    const supabaseAdmin = clienteAdminOu503(contexto, { material_id: materialId });
    const assinada = await assinarUrlPdfMaterial(supabaseAdmin, material.pdf_caminho);
    const resposta: RespostaUrlPdfMaterial = assinada;
    return NextResponse.json(resposta, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaErro(contexto, erro);
  }
}

/**
 * POST /api/jornadas/[id]/material/[materialId]/pdf — (re)gera o PDF de um
 * material JÁ aprovado (botão "gerar de novo" depois de `pdf_erro`, ou material
 * aprovado antes da Fase 4). Mesmo papel da aprovação (admin/advogada). Rascunho
 * → 409: PDF só existe para aprovado (constraint 0055).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const contexto = "POST /api/jornadas/[id]/material/[materialId]/pdf";
  try {
    await exigirPapel("admin", "advogada");
    const { id: jornadaId, materialId } = ParametroSchema.parse(await params);

    const material = await lerMaterialDaJornada(jornadaId, materialId);
    if (!material.aprovado_em) {
      throw new ErroApi(409, "material_nao_aprovado", "Aprove o material antes de gerar o PDF — rascunho nunca vira arquivo.");
    }

    const supabaseAdmin = clienteAdminOu503(contexto, { material_id: materialId });
    const pdf = await gerarEGravarPdfMaterial(supabaseAdmin, { materialId });

    const atualizado = await lerMaterialDaJornada(jornadaId, materialId);
    const resposta: RespostaAprovarMaterial = { material: paraResumoMaterial(atualizado), pdf };
    // 200 mesmo quando `pdf.estado='falhou'`: o material continua válido e o
    // resultado do PDF vai no corpo — mesmo contrato da rota de aprovação.
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro(contexto, erro);
  }
}
