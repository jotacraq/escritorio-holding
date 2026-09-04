export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { DecisaoJuridicaAdmin } from "@/types/admin";

/**
 * GET /api/admin/decisoes-juridicas — histórico completo (ativas e
 * revogadas), mais recente primeiro. Não filtra por escopo: hoje só existe
 * um (`conhecimento.analise_ia_transcricoes`, 0048), e a tela precisa ver o
 * histórico inteiro para auditoria, não só a decisão vigente.
 *
 * Guard de papel é `exigirVePatrimonio` (admin OU advogada), não
 * `exigirPapel("admin")` — regra da tarefa: "mesma regra de quem vê
 * patrimônio e decide sobre IA no restante do sistema". A RLS (`dj_sel`,
 * 0048) já exige `app.ve_patrimonio()`; o guard de rota é a segunda trava
 * (nunca só uma das duas, mesmo padrão de src/server/auth.ts).
 */
export async function GET() {
  try {
    await exigirVePatrimonio();

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("decisoes_juridicas")
      .select("*")
      .order("decidido_em", { ascending: false });

    if (error) {
      registrarErro("api/admin/decisoes-juridicas GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as DecisaoJuridicaAdmin[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/decisoes-juridicas GET", erro);
  }
}

const CorpoSchema = z.object({
  escopo: z.literal("conhecimento.analise_ia_transcricoes"),
  descricao: z.string().trim().min(1).max(2000),
  base_legal: z.string().trim().min(1).max(4000),
  subprocessador: z.string().trim().min(1).max(500),
});

/**
 * POST /api/admin/decisoes-juridicas — registra uma decisão jurídica nova.
 * NUNCA sobrescreve: se já existe decisão ATIVA para o mesmo escopo, o INSERT
 * falha na `uniq_decisao_juridica_ativa` (0048) — quem quer trocar a decisão
 * revoga a anterior primeiro (`PATCH .../[id]`, motivo_revogacao obrigatório)
 * e só então registra a nova. Isto não é validado em TS antes do INSERT de
 * propósito: a unique index do banco é a autoridade final (mesmo raciocínio
 * de "índice novo prova o predicado" — aqui é unicidade, não performance).
 *
 * O TEXTO da decisão (base_legal, subprocessador, descricao) é responsabili-
 * dade de quem chama esta rota — nada aqui infere ou sugere conteúdo
 * jurídico. Ver nota no topo de 0048_decisoes_juridicas.sql.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirVePatrimonio();
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: criada, error } = await supabase
      .from("decisoes_juridicas")
      .insert({
        escopo: corpo.escopo,
        descricao: corpo.descricao,
        base_legal: corpo.base_legal,
        subprocessador: corpo.subprocessador,
        decidido_por: usuario.id,
      })
      .select("*")
      .single<DecisaoJuridicaAdmin>();

    if (error) {
      registrarErro("api/admin/decisoes-juridicas POST", error, { escopo: corpo.escopo });
      throw error;
    }

    return NextResponse.json({ decisao: criada }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/decisoes-juridicas POST", erro);
  }
}
