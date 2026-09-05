export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { Tarefa } from "@/types/banco";

const LIMITE = 200;

const FiltrosSchema = z.object({
  jornada_id: z.string().uuid().optional(),
  /** default: só abertas. `todas=1` inclui concluídas. */
  todas: z.enum(["1", "true"]).optional(),
  /** `minhas=1`: só as com `responsavel_id` = eu. */
  minhas: z.enum(["1", "true"]).optional(),
  tipo: z.string().regex(/^[a-z_]{3,60}$/).optional(),
});

interface TarefaLinha extends Tarefa {
  jornadas: { pessoas: { nome: string } | { nome: string }[] | null } | { pessoas: { nome: string } | { nome: string }[] | null }[] | null;
}

/**
 * GET /api/tarefas — tarefas (`tarefas`, 0027 + `tipo` 0051) para o Painel do
 * Dia ("Minhas tarefas") e a Ficha 360. `tar_sel` já exige `eh_interno()`.
 */
export async function GET(request: NextRequest) {
  try {
    const usuario = await exigirInterno();
    const filtros = FiltrosSchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const supabase = await criarClienteServidor();
    let query = supabase
      .from("tarefas")
      .select("*, jornadas(pessoas(nome))")
      .order("vence_em", { ascending: true, nullsFirst: false })
      .order("criado_em", { ascending: true })
      .limit(LIMITE);

    if (!filtros.todas) query = query.is("concluida_em", null);
    if (filtros.jornada_id) query = query.eq("jornada_id", filtros.jornada_id);
    if (filtros.minhas) query = query.eq("responsavel_id", usuario.id);
    if (filtros.tipo) query = query.eq("tipo", filtros.tipo);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/tarefas GET", error, { filtros });
      throw error;
    }

    const itens = ((data as unknown as TarefaLinha[] | null) ?? []).map(({ jornadas, ...tarefa }) => {
      const jornada = Array.isArray(jornadas) ? jornadas[0] : jornadas;
      const pessoa = jornada ? (Array.isArray(jornada.pessoas) ? jornada.pessoas[0] : jornada.pessoas) : null;
      return { ...tarefa, pessoa_nome: pessoa?.nome ?? null };
    });

    return NextResponse.json({ itens });
  } catch (erro) {
    return respostaErro("api/tarefas GET", erro);
  }
}
