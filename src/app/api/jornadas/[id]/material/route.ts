export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import { ErroIa } from "@/server/ia/erros";
import { gerarMaterial } from "@/server/ia/material";
import { COLUNAS_MATERIAL_RESUMO, paraResumoMaterial, type LinhaMaterialGerado } from "@/server/material/resumo";
import type {
  ConteudoMaterial,
  MaterialGeradoDetalhe,
  RespostaGerarMaterial,
  RespostaListarMateriais,
} from "@/types/material";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({ forcar_regeracao: z.boolean().optional() });

/**
 * GET /api/jornadas/[id]/material — histórico de versões + a atual com
 * conteúdo (para a aba "Material" da Ficha 360, F-3A, e para a tela de
 * aprovação). Qualquer papel interno lê (mesmo recorte de `mg_sel`, 0031) —
 * conteúdo de material não é patrimônio, não exige `ve_patrimonio`.
 * `pdf_caminho` é caminho de bucket privado, não URL: baixar é
 * `GET .../material/[materialId]/pdf`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("materiais_gerados")
      .select(`${COLUNAS_MATERIAL_RESUMO}, conteudo, materiais_modelos(chave)`)
      .eq("jornada_id", jornadaId)
      .order("versao", { ascending: false });

    if (error) throw error;

    const linhas = (data ?? []) as unknown as LinhaMaterialGerado[];
    const linhaAtual = linhas.find((linha) => linha.atual) ?? null;
    const atual: MaterialGeradoDetalhe | null = linhaAtual
      ? { ...paraResumoMaterial(linhaAtual), conteudo: linhaAtual.conteudo as ConteudoMaterial }
      : null;

    const resposta: RespostaListarMateriais = { itens: linhas.map(paraResumoMaterial), atual };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/jornadas/[id]/material", erro);
  }
}

/**
 * POST /api/jornadas/[id]/material — gera o material pós-sessão (mesmo papel de
 * `/api/briefings/gerar`: admin, advogada, relacionamento). Usa `service_role`
 * porque o conteúdo e a fonte da dor não podem ser forjados via PostgREST
 * (mesmo motivo de `registrar_briefing`, 0009/0027) — a rota é a única porta.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(await request.json().catch(() => ({})));

    let supabaseAdmin: ReturnType<typeof criarClienteAdmin>;
    try {
      supabaseAdmin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("POST /api/jornadas/[id]/material#service_role_ausente", erroServiceRole, {
        jornada_id: jornadaId,
      });
      throw new ErroApi(503, "servico_indisponivel", "Geração de material exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.");
    }

    const resultado = await gerarMaterial(supabaseAdmin, {
      jornadaId,
      criadoPor: usuario.id,
      forcarRegeracao: corpo.forcar_regeracao,
    });

    const resposta: RespostaGerarMaterial = {
      execucao_id: resultado.execucaoId,
      material_id: resultado.materialId,
      fonte_dor: resultado.fonteDor,
      chave_modelo: resultado.chaveModelo,
      origem_dado: resultado.origemDado,
      motivo_modelo: resultado.motivoModelo,
    };
    return NextResponse.json(resposta, { status: 202 });
  } catch (erro) {
    if (erro instanceof ErroIa) {
      return NextResponse.json({ erro: erro.codigo, mensagem: erro.message }, { status: erro.status });
    }
    return respostaErro("POST /api/jornadas/[id]/material", erro);
  }
}
