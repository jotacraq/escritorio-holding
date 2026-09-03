export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { RelatorioSessao, SessaoViabilidade } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

async function buscarSessaoDaJornada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  jornadaId: string,
): Promise<SessaoViabilidade> {
  const { data: sessao, error } = await supabase
    .from("sessoes_viabilidade")
    .select("*")
    .eq("jornada_id", jornadaId)
    .maybeSingle();
  if (error) throw error;
  if (!sessao) {
    throw erroNaoEncontrado(
      "Esta jornada ainda não tem Sessão de Viabilidade registrada — crie o agendamento antes do relatório.",
    );
  }
  return sessao as SessaoViabilidade;
}

/** Relatório carrega valor e detalhe patrimonial — mesmo recorte do patrimônio. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const sessao = await buscarSessaoDaJornada(supabase, jornadaId);

    const { data: relatorio, error } = await supabase
      .from("relatorios_sessao")
      .select("*")
      .eq("sessao_id", sessao.id)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ relatorio: (relatorio as RelatorioSessao | null) ?? null });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/relatorio GET", erro);
  }
}

const CorpoSchema = z.object({
  acompanhado: z.boolean().optional(),
  quem_acompanha: z.string().trim().max(200).optional(),
  acompanhante_decide: z.boolean().optional(),
  acompanhante_assistiu: z.boolean().optional(),
  data_contratacao: z.string().date().optional(),
  valor_pago_sessao: z.number().min(0).max(1_000_000_000).optional(),
  parcelas: z.number().int().min(1).max(60).optional(),
  motivacao_cliente: z.string().trim().max(5000).optional(),
  receita_familiar_mensal: z.number().min(0).max(1_000_000_000).optional(),
  ideia_custo_inventario: z.string().trim().max(2000).optional(),
  reserva_ou_seguro: z.string().trim().max(2000).optional(),
  ciente_itcmd: z.boolean().optional(),
  preocupacao_predominante: z.string().trim().max(2000).optional(),
  como_deseja_organizar: z.string().trim().max(2000).optional(),
  motiva_evitar_inventario: z.string().trim().max(2000).optional(),
  interesse_imediato: z.string().trim().max(2000).optional(),
  relacao_filhos_terceiros: z.string().trim().max(2000).optional(),
  porque_nos_procurou: z.string().trim().max(2000).optional(),
  falta_planejamento_preocupa: z.string().trim().max(2000).optional(),
  resultado_sessao: z.string().trim().max(2000).optional(),
  // NOTA: alíquota/link de tributos são digitados pela advogada — nenhum cálculo
  // automático de imposto acontece aqui (inventar regra tributária não é escopo do MVP).
  tributos: z.record(z.string(), z.unknown()).optional(),
  consideracoes_apresentacao_croqui: z.string().trim().max(5000).optional(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const sessao = await buscarSessaoDaJornada(supabase, jornadaId);

    // Upsert manual (não `.upsert()`) para `criado_por` nunca ser reescrito numa
    // atualização — é um campo de auditoria, não "último a mexer".
    const { data: existente, error: erroExistente } = await supabase
      .from("relatorios_sessao")
      .select("id")
      .eq("sessao_id", sessao.id)
      .maybeSingle();
    if (erroExistente) throw erroExistente;

    const query = existente
      ? supabase
          .from("relatorios_sessao")
          .update({ ...corpo, atualizado_por: usuario.id })
          .eq("sessao_id", sessao.id)
      : supabase
          .from("relatorios_sessao")
          .insert({ ...corpo, sessao_id: sessao.id, criado_por: usuario.id, atualizado_por: usuario.id });

    const { data: relatorio, error } = await query.select("*").single();

    if (error) {
      registrarErro("api/jornadas/[id]/relatorio PUT", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ relatorio: relatorio as RelatorioSessao });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/relatorio PUT", erro);
  }
}
