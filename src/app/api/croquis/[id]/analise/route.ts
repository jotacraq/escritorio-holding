import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro , ErroApi , registrarErro } from "@/server/erros";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { gerarAnaliseCroqui } from "@/server/ia/croqui-analise";
import { ErroIa } from "@/server/ia/erros";
import { resolverModoIa } from "@/server/ia/demonstracao";
import { resolverTranscricaoSessao } from "@/server/croqui/transcricao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  // Transcrição bruta da Sessão de Viabilidade. Mínimo alto de propósito: a
  // Agente do Croqui não deve rodar sobre um trecho curto e "alucinar" o resto.
  //
  // ARQUITETURA-FASE-3.md §2.2 — agora OPCIONAL, compatível: o chamador antigo
  // (hoje nenhum, §0 item 3) que mandava a transcrição inteira no corpo
  // continua funcionando sem alteração. Ausente → lê a última transcrição
  // persistida da jornada (`POST /api/sessoes/[id]/transcricao`). Nenhuma das
  // duas → 409 `transcricao_ausente`.
  transcricao_sessao: z
    .string()
    .min(200, "transcricao_sessao muito curta para uma análise responsável")
    .optional(),
});

/**
 * POST /api/croquis/[id]/analise — a SEGUNDA IA (Agente do Croqui), pós-SV.
 * Recebe a transcrição no corpo OU lê a persistida da jornada + dados de
 * ficha já registrados, devolve as 14 seções carimbadas por categoria. Só
 * admin/advogada — mesmo recorte de quem vê patrimônio, porque esta IA
 * processa valor real.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const corpo = CorpoSchema.parse(await request.json());

    // Sem SUPABASE_SERVICE_ROLE_KEY isto e configuracao ausente, nao falha do

    // sistema: responde 503 dizendo o que falta, em vez de 500 generico que

    // polui o log de erro real e esconde a causa de quem for triar.

    let supabaseAdmin: ReturnType<typeof criarClienteAdmin>;

    try {

      supabaseAdmin = criarClienteAdmin();

    } catch (erroServiceRole) {

      registrarErro("src/app/api/croquis/[id]/analise/route.ts#service_role_ausente", erroServiceRole);

      throw new ErroApi(503, "servico_indisponivel", "Análise do croqui exige SUPABASE_SERVICE_ROLE_KEY — indisponivel agora.");

    }
    const { data: croqui, error: erroCroqui } = await supabaseAdmin
      .from("croquis")
      .select("id, jornada_id, jornadas(pessoa_id)")
      .eq("id", id)
      .maybeSingle<{ id: string; jornada_id: string; jornadas: { pessoa_id: string } | { pessoa_id: string }[] }>();

    if (erroCroqui) throw erroCroqui;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    const jornadaRelacionada = Array.isArray(croqui.jornadas) ? croqui.jornadas[0] : croqui.jornadas;
    if (!jornadaRelacionada) throw erroNaoEncontrado("Jornada da ficha não encontrada.");

    // Mesma ramificação de `gerarAnaliseCroqui` (resolverModoIa) — duplicada
    // aqui de propósito, para não editar `src/server/ia/croqui-analise.ts`
    // (fora da fronteira deste agente, ver relatório da onda): em modo
    // demonstração/indisponível a transcrição real não é necessária —
    // `gerarAnaliseCroqui` decide isso antes de sequer olhar para o parâmetro,
    // então resolver/exigir transcrição aqui só se aplica ao modo real.
    const modoIa = resolverModoIa();
    const transcricaoSessao =
      modoIa === "real"
        ? await resolverTranscricaoSessao(supabaseAdmin, croqui.jornada_id, corpo.transcricao_sessao)
        : (corpo.transcricao_sessao ?? "");

    const resultado = await gerarAnaliseCroqui(supabaseAdmin, {
      croquiId: croqui.id,
      jornadaId: croqui.jornada_id,
      pessoaId: jornadaRelacionada.pessoa_id,
      transcricaoSessao,
      criadoPor: usuario.id,
    });

    return NextResponse.json(
      {
        execucao_id: resultado.execucaoId,
        analise_id: resultado.analiseId,
        analise: resultado.analise,
        custo_usd: resultado.custoUsd,
      },
      { status: 201 },
    );
  } catch (erro) {
    if (erro instanceof ErroIa) {
      return NextResponse.json({ erro: erro.codigo, mensagem: erro.message }, { status: erro.status });
    }
    return respostaErro("POST /api/croquis/[id]/analise", erro);
  }
}
