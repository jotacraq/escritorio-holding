export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";

const LIMITE = 200;

const FiltrosSchema = z.object({
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
});

interface JornadaRelacionada {
  pessoa_id: string;
  pessoas: { nome: string } | { nome: string }[] | null;
}

interface SessaoRelacionada {
  jornada_id: string;
  jornadas: JornadaRelacionada | JornadaRelacionada[] | null;
}

interface AgendamentoLinha {
  id: string;
  sessao_id: string;
  inicio_em: string;
  fim_em: string;
  status: "agendado" | "confirmado" | "realizado" | "nao_compareceu" | "cancelado" | "remarcado";
  origem: "equipe" | "cliente" | "ia";
  observacoes: string | null;
  advogada_id: string | null;
  sessoes_viabilidade: SessaoRelacionada | SessaoRelacionada[] | null;
}

/**
 * GET /api/agendamentos — próximos agendamentos, para a Agenda (F7). Não há
 * rota dedicada em §3 (só criar/atualizar por jornada) — inferida a partir do
 * índice parcial `idx_agendamentos_proximos` (só `agendado`/`confirmado`).
 * Aceita janela `de`/`ate` por query; sem `de`, o piso é agora (nunca mostra
 * passado). `age_sel` na RLS já exige `app.eh_interno()`; a rota checa de novo.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(params);

    if (filtros.de && filtros.ate && new Date(filtros.ate) < new Date(filtros.de)) {
      throw erroValidacao({ campo: "ate" }, "`ate` precisa ser depois de `de`.");
    }

    const supabase = await criarClienteServidor();
    let query = supabase
      .from("agendamentos")
      .select(
        "id, sessao_id, inicio_em, fim_em, status, origem, observacoes, advogada_id, sessoes_viabilidade(jornada_id, jornadas(pessoa_id, pessoas(nome)))",
      )
      .in("status", ["agendado", "confirmado"])
      .gte("inicio_em", filtros.de ?? new Date().toISOString())
      .order("inicio_em", { ascending: true })
      .limit(LIMITE);

    if (filtros.ate) query = query.lte("inicio_em", filtros.ate);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/agendamentos GET", error, { filtros });
      throw error;
    }

    const linhas = (data as unknown as AgendamentoLinha[] | null) ?? [];
    const itens = linhas.map((linha) => {
      const sessao = Array.isArray(linha.sessoes_viabilidade) ? linha.sessoes_viabilidade[0] : linha.sessoes_viabilidade;
      const jornada = sessao ? (Array.isArray(sessao.jornadas) ? sessao.jornadas[0] : sessao.jornadas) : null;
      const pessoa = jornada ? (Array.isArray(jornada.pessoas) ? jornada.pessoas[0] : jornada.pessoas) : null;
      return {
        id: linha.id,
        sessao_id: linha.sessao_id,
        jornada_id: sessao?.jornada_id,
        pessoa_nome: pessoa?.nome,
        inicio_em: linha.inicio_em,
        fim_em: linha.fim_em,
        status: linha.status,
        origem: linha.origem,
        observacoes: linha.observacoes,
        advogada_id: linha.advogada_id,
      };
    });

    return NextResponse.json({ itens });
  } catch (erro) {
    return respostaErro("api/agendamentos GET", erro);
  }
}
