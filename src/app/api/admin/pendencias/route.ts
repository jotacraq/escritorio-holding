export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { PendenciaSistema, PendenciasResposta } from "@/types/admin";

/**
 * GET /api/admin/pendencias — a aba que a tarefa marca como "a que mais
 * vale": o que está travado e só apareceria hoje rodando SQL à mão.
 *
 * DECISÃO (ver comentário no topo de `0033_admin.sql`): consome
 * `vw_pendencias_sistema` (0034, B-1B), que já cobre `webhook_falho`,
 * `mensagem_falhou` e `link_expirando` com a RLS certa por baixo
 * (`security_invoker` + `wh_sel_pendencias`/`ma_sel`/`lp_sel`) — não
 * duplica a view nem reimplementa a leitura de `webhooks_eventos`. O que
 * esta rota acrescenta é o que a view (read-only) não faz: `materiais_
 * aguardando_aprovacao` como stub explícito (tabela não existe ainda) e a
 * porta de AÇÃO sobre cada tipo (ver `POST /api/admin/webhooks/[id]/
 * reprocessar` e `POST /api/admin/mensagens/[id]/reenfileirar`, ambas nesta
 * mesma migration/PR).
 */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.from("vw_pendencias_sistema").select("*");

    if (error) {
      registrarErro("api/admin/pendencias GET", error);
      throw error;
    }

    const resposta: PendenciasResposta = {
      sistema: (data as PendenciaSistema[] | null) ?? [],
      materiais_aguardando_aprovacao: {
        disponivel: false,
        motivo:
          "Tabela 'materiais_pos_sessao' ainda não existe (migration 0031, ONDA 3, não escrita nesta noite). " +
          "Quando existir, esta aba passa a listar o material pendente de aprovação humana (BLOQUEIO B14).",
      },
    };

    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/admin/pendencias GET", erro);
  }
}
