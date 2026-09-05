import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro, ErroApi } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroIa } from "@/server/ia/erros";
import {
  erroNarrativaInativa,
  gerarNarrativaCroqui,
  lerNarrativaAtual,
  narrativaAtiva,
} from "@/server/croqui/narrativa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

interface CroquiComJornada {
  id: string;
  jornada_id: string;
  jornadas: { pessoa_id: string } | { pessoa_id: string }[] | null;
}

/**
 * O croqui lido com o cliente da SESSÃO: quem pede tem de enxergar aquele
 * croqui pela RLS, não só ter passado pelo gate de papel da rota. Devolve
 * também `pessoa_id` — a narrativa manda patrimônio ao provedor e o
 * consentimento é por PESSOA.
 */
async function lerCroqui(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  id: string,
): Promise<{ id: string; jornadaId: string; pessoaId: string }> {
  const { data, error } = await supabase
    .from("croquis")
    .select("id, jornada_id, jornadas(pessoa_id)")
    .eq("id", id)
    .maybeSingle<CroquiComJornada>();

  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Croqui não encontrado.");

  const jornada = Array.isArray(data.jornadas) ? data.jornadas[0] : data.jornadas;
  if (!jornada) throw erroNaoEncontrado("Jornada da ficha não encontrada.");

  return { id: data.id, jornadaId: data.jornada_id, pessoaId: jornada.pessoa_id };
}

/** Sem a chave, o que falta é AMBIENTE, não código: 503 rotulado, nunca 500 genérico. */
function clienteAdminOuIndisponivel() {
  try {
    return criarClienteAdmin();
  } catch (erroServiceRole) {
    registrarErro("src/app/api/croquis/[id]/narrativa/route.ts#service_role_ausente", erroServiceRole);
    throw new ErroApi(
      503,
      "servico_indisponivel",
      "A narrativa do croqui exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.",
    );
  }
}

/**
 * `ErroIa` não é `ErroApi`: entregue a `respostaErro` viraria 500 `erro_interno`
 * e apagaria o código de que a tela depende (`narrativa_inativa`,
 * `croqui_calculo_ausente`, `consentimento_ausente`, `limite_ia_atingido`).
 * Mesmo tratamento de `POST /api/croquis/[id]/analise`.
 */
function respostaErroNarrativa(contexto: string, erro: unknown) {
  if (erro instanceof ErroIa) {
    return NextResponse.json({ erro: erro.codigo, mensagem: erro.message }, { status: erro.status });
  }
  return respostaErro(contexto, erro);
}

/**
 * GET /api/croquis/[id]/narrativa — a narrativa atual (ou `null`) e se o
 * agente está ligado.
 *
 * `ativo` vai no payload para a tela dizer a verdade em vez de mostrar um
 * botão que só devolve 409: com o prompt inativo, o rótulo é "ative após a
 * bancada", não "gerar". Só `admin`/`advogada` — a narrativa cita número do
 * croqui e perfil da família (RLS `cn_sel`, 0070).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const croqui = await lerCroqui(supabase, id);

    // `ativo` sai de `prompts_versoes`, que `authenticated` interno já lê
    // (policy `pv_sel`, 0009) — não precisa de service_role e não vaza corpo
    // de prompt: a consulta seleciona só o `id`.
    const [narrativa, ativo] = await Promise.all([
      lerNarrativaAtual(supabase, croqui.id),
      narrativaAtiva(supabase).catch(() => false),
    ]);

    return NextResponse.json({ narrativa, ativo });
  } catch (erro) {
    return respostaErroNarrativa("GET /api/croquis/[id]/narrativa", erro);
  }
}

/**
 * POST /api/croquis/[id]/narrativa — gera a narrativa v3 do croqui.
 *
 * O corpo é vazio de propósito: tudo o que a IA lê vem do cálculo já gravado
 * (`croqui_calculos.atual`) e do contexto da jornada. Não há como injetar
 * número nem texto pela requisição — mesma regra de
 * `POST /api/jornadas/[id]/croqui-calculo`.
 *
 * Respostas rotuladas, todas antes de gastar token:
 *   401 não autenticado · 403 sem `ve_patrimonio` · 404 croqui inexistente
 *   409 `narrativa_inativa` — prompt ainda não liberado pela bancada
 *   409 `croqui_calculo_ausente` — nenhuma versão fixada para narrar
 *   409 `consentimento_ausente` — sem `tratamento_ia` da pessoa
 *   429 `limite_ia_atingido` — cooldown/teto diário (`executarComAuditoria`)
 *   503 `servico_indisponivel` — sem IA configurada, sem service_role ou sem a 0070
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const croqui = await lerCroqui(supabase, id);

    // O estado de PRODUTO responde antes do estado de AMBIENTE, e com o
    // cliente da SESSÃO: `prompts_versoes` já é legível por equipe interna
    // (`pv_sel`, 0009), então saber que o agente ainda não foi liberado não
    // depende de service_role. Sem esta ordem, uma instalação sem a chave
    // responderia 503 "falta SUPABASE_SERVICE_ROLE_KEY" para um botão que o
    // escritório ainda nem ligou — manda procurar variável de ambiente em vez
    // de dizer "ative após a bancada". `gerarNarrativaCroqui` repete a
    // checagem (defesa em profundidade para outro chamador).
    if (!(await narrativaAtiva(supabase))) throw erroNarrativaInativa();

    const supabaseAdmin = clienteAdminOuIndisponivel();

    const resultado = await gerarNarrativaCroqui(supabaseAdmin, {
      croquiId: croqui.id,
      jornadaId: croqui.jornadaId,
      pessoaId: croqui.pessoaId,
      criadoPor: usuario.id,
    });

    return NextResponse.json(
      {
        execucao_id: resultado.execucaoId,
        narrativa_id: resultado.narrativaId,
        narrativa: resultado.narrativa,
        custo_usd: resultado.custoUsd,
      },
      { status: 201 },
    );
  } catch (erro) {
    return respostaErroNarrativa("POST /api/croquis/[id]/narrativa", erro);
  }
}
