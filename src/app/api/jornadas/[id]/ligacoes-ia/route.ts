export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import { dispararAgora, enfileirarLigacaoIa } from "@/server/ligacao-ia";
import type { LigacaoIa, RespostaLigacaoIa, RespostaListarLigacoesIa } from "@/types/integracoes";

const ParametroSchema = z.object({ id: z.string().uuid() });

/** GET /api/jornadas/[id]/ligacoes-ia — histórico da jornada (RLS `lia_sel`: toda a equipe). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("ligacoes_ia")
      .select("*")
      .eq("jornada_id", jornadaId)
      .order("criado_em", { ascending: false })
      .limit(50);
    if (error) throw error;
    const resposta: RespostaListarLigacoesIa = { itens: (data ?? []) as LigacaoIa[] };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/jornadas/[id]/ligacoes-ia", erro);
  }
}

/**
 * POST /api/jornadas/[id]/ligacoes-ia — botão "Ligar por IA agora" da Ficha →
 * Sessão (B33: sempre disponível, independente de `ligacao_ia.automatica`).
 * Enfileira e dispara na hora; sem n8n configurado vira tarefa humana
 * rotulada (nunca falha silenciosa). Exige service_role: a fila não tem
 * policy de INSERT para authenticated (0053).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const { id: jornadaId } = ParametroSchema.parse(await params);

    // A trava de ROTA: a jornada precisa existir para quem está logado (RLS).
    const supabase = await criarClienteServidor();
    const { data: jornada, error: erroJornada } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw new ErroApi(404, "nao_encontrado", "Jornada não encontrada.");

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("POST /api/jornadas/[id]/ligacoes-ia#service_role", erroServiceRole, { jornada_id: jornadaId });
      throw new ErroApi(503, "servico_indisponivel", "Ligação por IA exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.");
    }

    const { ligacao, aviso } = await enfileirarLigacaoIa(admin, { jornadaId, solicitadaPor: usuario.id });

    // Dispara já (não espera o cron). Falha aqui não desfaz o enfileiramento:
    // a ligação fica visível com o erro e o reaper/cron cuidam do resto.
    let disparo: Awaited<ReturnType<typeof dispararAgora>> = null;
    try {
      disparo = await dispararAgora(admin, ligacao.id);
    } catch (erroDisparo) {
      registrarErro("POST /api/jornadas/[id]/ligacoes-ia#disparar", erroDisparo, { ligacao_id: ligacao.id });
    }

    const { data: atual } = await admin.from("ligacoes_ia").select("*").eq("id", ligacao.id).maybeSingle();
    const resposta: RespostaLigacaoIa = {
      ligacao: (atual as LigacaoIa | null) ?? ligacao,
      ...(aviso ? { aviso } : disparo === "falha" ? { aviso: "A ligação não pôde ser disparada agora; veja o motivo no histórico. O sistema tenta de novo pela régua." } : {}),
    };
    return NextResponse.json(resposta, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/jornadas/[id]/ligacoes-ia", erro);
  }
}
