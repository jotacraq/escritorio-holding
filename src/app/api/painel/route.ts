export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type {
  IndicadorEdicaoLinha,
  PagoSemContatoLinha,
  PendenciaPreparoLinha,
  PendenciaSistemaLinha,
  RespostaPainel,
  SessaoDoDiaLinha,
} from "@/types/agenda";

/**
 * Painel do dia (ARQUITETURA-FASE-2.md §4.6 / brain "Esteira do cliente"): os
 * cinco blocos que respondem "o que precisa da minha atenção agora". Sem
 * polling — a tela (`src/components/painel/usarPainelDia.ts`, F-1B) busca só
 * ao montar e sob clique em "Atualizar".
 *
 * Todas as cinco fontes são views `security_invoker = true` (0034): cada
 * bloco devolve exatamente o que a RLS de quem está logado permite — "vazio"
 * aqui é sempre "nada pendente de verdade", nunca "sem permissão disfarçado
 * de zero". Uma falha em UMA consulta não derruba as outras: cada bloco é
 * buscado e tratado de forma independente, e o envelope só reporta erro geral
 * se TODAS falharem (falha parcial vira bloco ausente, que o front já trata
 * como "não conseguiu carregar aquele pedaço" — `src/types/painel-ui.ts`).
 */
export async function GET() {
  try {
    await exigirInterno();
    const supabase = await criarClienteServidor();

    const [sessoesDoDia, pendenciasPreparo, pagosSemContato, pendenciasSistema, indicadoresSemana] =
      await Promise.all([
        supabase.from("vw_sessoes_do_dia").select("*"),
        supabase.from("vw_pendencias_preparo").select("*"),
        supabase.from("vw_pagos_sem_contato").select("*"),
        supabase.from("vw_pendencias_sistema").select("*"),
        supabase.from("vw_indicadores_pop01").select("*"),
      ]);

    const resposta: Partial<RespostaPainel> & { gerado_em: string } = {
      gerado_em: new Date().toISOString(),
    };

    if (sessoesDoDia.error) {
      registrarErro("api/painel GET vw_sessoes_do_dia", sessoesDoDia.error);
    } else {
      resposta.sessoes_do_dia = sessoesDoDia.data as SessaoDoDiaLinha[];
    }

    if (pendenciasPreparo.error) {
      registrarErro("api/painel GET vw_pendencias_preparo", pendenciasPreparo.error);
    } else {
      resposta.pendencias_preparo = pendenciasPreparo.data as PendenciaPreparoLinha[];
    }

    if (pagosSemContato.error) {
      registrarErro("api/painel GET vw_pagos_sem_contato", pagosSemContato.error);
    } else {
      resposta.pagos_sem_contato = pagosSemContato.data as PagoSemContatoLinha[];
    }

    if (pendenciasSistema.error) {
      registrarErro("api/painel GET vw_pendencias_sistema", pendenciasSistema.error);
    } else {
      resposta.pendencias_sistema = pendenciasSistema.data as PendenciaSistemaLinha[];
    }

    if (indicadoresSemana.error) {
      registrarErro("api/painel GET vw_indicadores_pop01", indicadoresSemana.error);
    } else {
      resposta.indicadores_semana = indicadoresSemana.data as IndicadorEdicaoLinha[];
    }

    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/painel GET", erro);
  }
}
