export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type {
  CustoIaMensal,
  CustoIaPorJornada,
  CustoIaPorPrompt,
  CustoIaResposta,
  ResumoCustoIa,
} from "@/types/admin";

/**
 * GET /api/admin/custo-ia — "Custo é informação de gestão — mesmo recorte de
 * quem vê patrimônio" (regra da tarefa): gate é `exigirVePatrimonio()`
 * (admin + advogada), não `exigirPapel("admin")` como o resto do Admin. A RLS
 * de origem (`ex_sel` em `execucoes_ia`, 0009) já é `app.ve_patrimonio()` —
 * as duas camadas concordam.
 *
 * As três views (`vw_custo_ia_mensal`, `vw_custo_ia_por_prompt`,
 * `vw_custo_ia_por_jornada`, 0033) NUNCA colapsam `modo='real'` com
 * `modo='demonstracao'` — o resumo abaixo soma cada `modo` separadamente, e o
 * total de demonstração é sempre exibido como o que é (deveria ser ~0 USD,
 * `execucoes_ia.custo_usd` de execução `modo='demonstracao'` nasce 0 por
 * regra do modo demonstração, §3.3 do plano — mas o cálculo aqui não assume
 * isso, soma o que o banco de fato tem).
 */
export async function GET() {
  try {
    await exigirVePatrimonio();

    const supabase = await criarClienteServidor();

    const [porMes, porPrompt, porJornada] = await Promise.all([
      supabase.from("vw_custo_ia_mensal").select("*"),
      supabase.from("vw_custo_ia_por_prompt").select("*"),
      supabase.from("vw_custo_ia_por_jornada").select("*").limit(50),
    ]);

    if (porMes.error) {
      registrarErro("api/admin/custo-ia GET#por_mes", porMes.error);
      throw porMes.error;
    }
    if (porPrompt.error) {
      registrarErro("api/admin/custo-ia GET#por_prompt", porPrompt.error);
      throw porPrompt.error;
    }
    if (porJornada.error) {
      registrarErro("api/admin/custo-ia GET#por_jornada", porJornada.error);
      throw porJornada.error;
    }

    const mensal = (porMes.data as CustoIaMensal[] | null) ?? [];

    const resumo: ResumoCustoIa = mensal.reduce<ResumoCustoIa>(
      (acc, linha) => {
        if (linha.modo === "real") {
          acc.custo_real_total_usd += Number(linha.custo_usd_total ?? 0);
          acc.execucoes_reais += Number(linha.execucoes ?? 0);
        } else {
          acc.custo_demonstracao_total_usd += Number(linha.custo_usd_total ?? 0);
          acc.execucoes_demonstracao += Number(linha.execucoes ?? 0);
        }
        return acc;
      },
      { custo_real_total_usd: 0, custo_demonstracao_total_usd: 0, execucoes_reais: 0, execucoes_demonstracao: 0 },
    );

    const resposta: CustoIaResposta = {
      resumo,
      por_mes: mensal,
      por_prompt: (porPrompt.data as CustoIaPorPrompt[] | null) ?? [],
      por_jornada: (porJornada.data as CustoIaPorJornada[] | null) ?? [],
    };

    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/admin/custo-ia GET", erro);
  }
}
