export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, ErroApi, registrarErro, respostaErro } from "@/server/erros";
import { gerarAnaliseCroqui } from "@/server/ia/croqui-analise";
import { ErroIa } from "@/server/ia/erros";
import { resolverModoIa } from "@/server/ia/demonstracao";
import { resolverTranscricaoSessao } from "@/server/croqui/transcricao";
import { garantirCroquiRascunho } from "@/server/croqui/rascunho";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  // Compatibilidade com quem já tem a transcrição em mãos e não quer
  // persistir antes (mesma regra de `/api/croquis/[id]/analise`, §2.2):
  // ausente → lê a última persistida da jornada.
  transcricao_sessao: z
    .string()
    .min(200, "transcricao_sessao muito curta para uma análise responsável")
    .optional(),
});

/**
 * POST /api/jornadas/[id]/analise-sessao — a porta FINA que a tela chama
 * (ARQUITETURA-FASE-3.md §2.2, terceira linha da tabela de rotas): garante
 * que existe um croqui `rascunho` para a jornada (cria com os 13 slides-base
 * do método se ainda não houver nenhum) e delega para a MESMA IA de
 * `POST /api/croquis/[id]/analise` — nenhum prompt novo, nenhum schema novo,
 * nenhuma trava de consentimento nova (CONFLITO C16: "Análise da Sessão" é o
 * Agente do Croqui com outro nome, não uma terceira IA). Evita a exigência
 * artificial de "crie o croqui antes de poder analisar a sessão", quando na
 * prática a análise é o INSUMO do croqui.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await context.params);
    const corpo = CorpoSchema.parse(await request.json().catch(() => ({})));

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id, pessoa_id")
      .eq("id", jornadaId)
      .maybeSingle<{ id: string; pessoa_id: string }>();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const croqui = await garantirCroquiRascunho(supabase, { jornadaId, usuarioId: usuario.id });

    // Sem SUPABASE_SERVICE_ROLE_KEY isto é configuracao ausente, nao falha do
    // sistema: responde 503 dizendo o que falta, em vez de 500 generico que
    // polui o log de erro real e esconde a causa de quem for triar. Mesmo
    // padrão de /api/briefings/gerar e /api/croquis/[id]/analise.
    let supabaseAdmin: ReturnType<typeof criarClienteAdmin>;
    try {
      supabaseAdmin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("api/jornadas/[id]/analise-sessao#service_role_ausente", erroServiceRole);
      throw new ErroApi(
        503,
        "servico_indisponivel",
        "Análise da Sessão exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.",
      );
    }

    // Mesma ramificação de `gerarAnaliseCroqui` (resolverModoIa) — duplicada
    // aqui de propósito, para não editar `src/server/ia/croqui-analise.ts`
    // (fora da fronteira deste agente, ver relatório da onda): em modo
    // demonstração/indisponível a transcrição real não é necessária —
    // `gerarAnaliseCroqui` decide isso antes de sequer olhar para o parâmetro.
    const modoIa = resolverModoIa();
    const transcricaoSessao =
      modoIa === "real"
        ? await resolverTranscricaoSessao(supabaseAdmin, jornadaId, corpo.transcricao_sessao)
        : (corpo.transcricao_sessao ?? "");

    const resultado = await gerarAnaliseCroqui(supabaseAdmin, {
      croquiId: croqui.id,
      jornadaId,
      pessoaId: jornada.pessoa_id,
      transcricaoSessao,
      criadoPor: usuario.id,
    });

    return NextResponse.json(
      {
        croqui_id: croqui.id,
        croqui_criado_agora: croqui.criado,
        execucao_id: resultado.execucaoId,
        analise_id: resultado.analiseId,
        analise: resultado.analise,
        custo_usd: resultado.custoUsd,
      },
      { status: 201 },
    );
  } catch (erro) {
    if (erro instanceof ErroIa) {
      return NextResponse.json(
        { erro: erro.codigo, mensagem: erro.message, detalhes: erro.detalhe },
        { status: erro.status },
      );
    }
    return respostaErro("POST /api/jornadas/[id]/analise-sessao", erro);
  }
}
