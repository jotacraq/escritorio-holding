export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { faltamChatwoot } from "@/server/chatwoot/cliente";
import { lerConfigAgente } from "@/server/agente-whatsapp/config";
import { CHAVE_PROMPT_AGENTE, inicioDoDiaSp } from "@/server/agente-whatsapp/ia";
import type { AgenteResposta, AgenteResumo } from "@/types/agente";

/**
 * GET /api/admin/agente-whatsapp — o interruptor e a conta do dia.
 *
 * Admin-only. Devolve o ESTADO REAL, incluindo o que falta para o agente
 * poder funcionar: as `CHATWOOT_*` ausentes aparecem pelo NOME (nunca pelo
 * valor), e `prompt_ativo: false` é informação, não erro — o prompt nasce
 * inativo por desenho (D17).
 *
 * A prova que a trava do Fable pede — "com `agente_whatsapp.ativo = false`,
 * ZERO execução de IA" — se lê aqui: `execucoes_ia_hoje` conta as execuções
 * DESTE prompt no dia.
 */

const AUSENTE = new Set(["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"]);

const COLUNAS_RESPOSTA =
  "id, mensagem_recebida_id, jornada_id, conversa_externa_id, intencao, confianca, acao, texto, custo_usd, enviada_em, erro, criado_em";

export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const admin = criarClienteAdmin();
    const desde = inicioDoDiaSp();

    const config = await lerConfigAgente(admin);

    const promptConsulta = await supabase
      .from("prompts_versoes")
      .select("id, versao, ativo")
      .eq("chave", CHAVE_PROMPT_AGENTE)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; versao: number; ativo: boolean }>();
    if (promptConsulta.error && !AUSENTE.has(promptConsulta.error.code ?? "")) throw promptConsulta.error;
    const prompt = promptConsulta.data ?? null;

    const respostasConsulta = await supabase
      .from("agente_whatsapp_respostas")
      .select(COLUNAS_RESPOSTA)
      .order("criado_em", { ascending: false })
      .limit(20);
    if (respostasConsulta.error && !AUSENTE.has(respostasConsulta.error.code ?? "")) throw respostasConsulta.error;
    const respostas = ((respostasConsulta.data ?? []) as unknown as AgenteResposta[]) ?? [];

    const doDiaConsulta = await supabase
      .from("agente_whatsapp_respostas")
      .select("custo_usd")
      .gte("criado_em", desde)
      .returns<Array<{ custo_usd: number | null }>>();
    if (doDiaConsulta.error && !AUSENTE.has(doDiaConsulta.error.code ?? "")) throw doDiaConsulta.error;
    const doDia = doDiaConsulta.data ?? [];

    let execucoesIaHoje = 0;
    if (prompt) {
      const execucoes = await supabase
        .from("execucoes_ia")
        .select("id", { count: "exact", head: true })
        .eq("prompt_versao_id", prompt.id)
        .gte("criado_em", desde);
      if (execucoes.error && !AUSENTE.has(execucoes.error.code ?? "")) throw execucoes.error;
      execucoesIaHoje = execucoes.count ?? 0;
    }

    const corpo: AgenteResumo = {
      ativo: config.ativo,
      envs_faltando: faltamChatwoot(),
      prompt_chave: CHAVE_PROMPT_AGENTE,
      prompt_versao: prompt?.versao ?? null,
      prompt_ativo: prompt?.ativo ?? false,
      silencio_humano_minutos: config.silencioHumanoMinutos,
      esquivas_ate_humano: config.esquivasAteHumano,
      intervalo_link_horas: config.intervaloLinkHoras,
      teto_respostas_hora: config.tetoRespostasHora,
      teto_ia_jornada_dia: config.tetoIaJornadaDia,
      teto_ia_dia: config.tetoIaDia,
      respostas_hoje: doDia.length,
      execucoes_ia_hoje: execucoesIaHoje,
      custo_usd_hoje: Number(doDia.reduce((soma, r) => soma + (Number(r.custo_usd) || 0), 0).toFixed(6)),
      ultimas_respostas: respostas,
    };
    return NextResponse.json(corpo);
  } catch (erro) {
    return respostaErro("api/admin/agente-whatsapp GET", erro);
  }
}
