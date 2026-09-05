import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CroquiConteudoSchema } from "@/server/ia/schema-croqui-slides";
import type { ContextoAnaliseCroqui } from "@/server/ia/contexto-croqui";
import { listarCenario } from "@/server/cenario";
import type { CenarioPatrimonial, CenarioRubrica, CenarioTotais, ParametroMetodo } from "@/types/cenario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Slide "economia" (ARQUITETURA-FASE-4.md §4.5): custo de NÃO agir
 * (`inventario`) × custo da estrutura recomendada (`holding_<recomendação>`),
 * lidos de `vw_cenarios_totais` (0057, agente D) — números DIGITADOS pela
 * advogada, ou multiplicados de base × alíquota que ela digitou. Qualquer
 * total `null` (rubrica ausente, view inexistente, sem recomendação) vira
 * `null` aqui e `<GraficoIndisponivel>` na tela, nomeando o que falta. Nunca
 * um número plausível.
 */
export interface EconomiaDoSlide {
  custo_inventario: number | null;
  custo_estrutura: number | null;
  cenario_estrutura: string | null;
  /** Rubricas ausentes por cenário — o que a tela nomeia quando falta número. */
  rubricas_ausentes: { inventario: number | null; estrutura: number | null };
}

const CENARIO_POR_RECOMENDACAO: Record<string, string> = {
  "1_celula": "holding_1_celula",
  "2_celulas": "holding_2_celulas",
  "3_celulas": "holding_3_celulas",
};

function montarEconomiaDoCenario(
  cenario: ContextoAnaliseCroqui["cenario"],
  recomendacao: string | null,
): EconomiaDoSlide {
  const cenarioEstrutura = recomendacao ? (CENARIO_POR_RECOMENDACAO[recomendacao] ?? null) : null;
  const linhaInventario = cenario?.find((c) => c.cenario === "inventario") ?? null;
  const linhaEstrutura = cenarioEstrutura ? (cenario?.find((c) => c.cenario === cenarioEstrutura) ?? null) : null;
  return {
    custo_inventario: linhaInventario?.total ?? null,
    custo_estrutura: linhaEstrutura?.total ?? null,
    cenario_estrutura: cenarioEstrutura,
    rubricas_ausentes: {
      inventario: linhaInventario?.rubricas_ausentes ?? null,
      estrutura: linhaEstrutura?.rubricas_ausentes ?? null,
    },
  };
}

/**
 * Cenário Patrimonial completo para o slide "economia" — a MESMA forma de
 * `DadosCenarioCroqui` (`components/croqui/GraficoDoSlide.tsx`) e de
 * `GET /api/jornadas/[id]/cenario`, para `apresentar/page.tsx` repassar em
 * `dadosGraficos.cenario` sem a 2ª leitura do adaptador (`apiCroqui.ts`).
 * Tolerante: view/tabela da 0057 ausente ou qualquer erro → `null` (o gráfico
 * mostra "cenário incompleto", nunca inventa). O que vai ao navegador do cliente
 * é só o que o slide desenha: valores digitados/calculados pela advogada e o
 * carimbo do parâmetro (alíquota, versão, base legal) — sem nota interna.
 */
export interface CenarioParaSlide {
  cenarios: CenarioPatrimonial[];
  rubricas: CenarioRubrica[];
  totais: CenarioTotais[];
  parametros: Record<string, ParametroMetodo>;
}

async function lerCenarioParaSlide(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  jornadaId: string,
): Promise<CenarioParaSlide | null> {
  try {
    const resposta = await listarCenario(supabase, jornadaId);
    if (resposta.totais.length === 0) return null;
    return {
      cenarios: resposta.cenarios,
      rubricas: resposta.rubricas.map((r) => ({ ...r, nota: null })),
      totais: resposta.totais,
      parametros: resposta.parametros,
    };
  } catch {
    return null;
  }
}

const CorpoAtualizacaoSchema = z.object({
  titulo: z.string().min(1).max(200).optional(),
  status: z.enum(["rascunho", "pronto", "apresentado"]).optional(),
  conteudo: CroquiConteudoSchema.optional(),
});

const CAMPOS_CROQUI =
  "id, jornada_id, versao, titulo, status, conteudo, criado_em, atualizado_em";

/**
 * GET /api/croquis/[id] — o croqui e, por padrão, as análises embutidas (o
 * editor precisa delas).
 *
 * `?modo=apresentacao` devolve o croqui SEM `croqui_analises` e com apenas o
 * recorte que os gráficos consomem (critérios de arquitetura e a recomendação
 * de 1/2/3 células). Existe porque o Modo Apresentação é **a tela que o cliente
 * vê**: mandar a análise inteira para aquele navegador colocaria grau de
 * confiança, categoria (fato/hipótese/inferência) e fontes internas no payload
 * de rede e no estado do React — invisíveis na tela, mas a um DevTools de
 * distância, com a família do lado. Achado MÉDIO do pentest de 04/09/2026.
 *
 * Não renderizar não é não enviar.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const apresentacao = request.nextUrl.searchParams.get("modo") === "apresentacao";

    const supabase = await criarClienteServidor();
    const { data: croqui, error } = await supabase
      .from("croquis")
      .select(apresentacao ? CAMPOS_CROQUI : `${CAMPOS_CROQUI}, croqui_analises(id, versao, conteudo, grau_confianca, criado_em)`)
      .eq("id", id)
      // Select condicional (string) — o parser de tipos do supabase-js não
      // resolve; o tipo mínimo que esta rota LÊ é `jornada_id`.
      .maybeSingle<{ jornada_id: string } & Record<string, unknown>>();

    if (error) throw error;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    if (!apresentacao) return NextResponse.json({ croqui });

    // Recorte para os gráficos: só o que desenha barra e matriz. Nada de
    // grau_confianca, categoria, fontes ou texto de hipótese.
    const [{ data: analise }, cenarioSlide] = await Promise.all([
      supabase
        .from("croqui_analises")
        .select("conteudo, schema_versao")
        .eq("croqui_id", id)
        .eq("atual", true)
        .maybeSingle<{
          conteudo: { arquitetura?: { criterios?: unknown; recomendacao?: unknown; alocacao?: unknown } };
          schema_versao: number | null;
        }>(),
      lerCenarioParaSlide(supabase, croqui.jornada_id),
    ]);
    // Uma leitura só: `economia` (resumo) deriva do cenário completo em vez de
    // consultar `vw_cenarios_totais` uma segunda vez.
    const cenario: ContextoAnaliseCroqui["cenario"] = cenarioSlide
      ? cenarioSlide.totais.map((t) => ({
          cenario: t.cenario,
          total: t.total == null ? null : Number(t.total),
          rubricas_ausentes: Number(t.rubricas_ausentes ?? 0),
        }))
      : null;

    // Cada critério carrega `categoria` (fato/hipótese/inferência) e
    // `peso_na_decisao` — leitura interna do método, que a matriz NÃO desenha.
    // Manda-se só `criterio` e o texto da resposta.
    const arquitetura = analise?.conteudo?.arquitetura;
    const criterios = Array.isArray(arquitetura?.criterios)
      ? (arquitetura.criterios as Array<{ criterio?: unknown; resposta?: { texto?: unknown } }>)
          .filter((c) => typeof c?.criterio === "string")
          .map((c) => ({
            criterio: c.criterio as string,
            resposta: { texto: typeof c.resposta?.texto === "string" ? c.resposta.texto : "" },
          }))
      : null;
    const recomendacao = typeof arquitetura?.recomendacao === "string" ? arquitetura.recomendacao : null;

    // v2 (0059, ARQUITETURA-FASE-4.md §4.5): onde cada bem fica (Cofre/Veículo/
    // Destino) — só `celula` + `item`; a `categoria` fica fora do payload do
    // cliente pelo mesmo motivo acima. v1 não tem alocação: `null`, e o
    // diagrama mostra o estado vazio honesto.
    const alocacao =
      (analise?.schema_versao ?? 1) >= 2 && Array.isArray(arquitetura?.alocacao)
        ? (arquitetura.alocacao as Array<{ celula?: unknown; item?: unknown }>)
            .filter((a) => typeof a?.celula === "string" && typeof a?.item === "string")
            .map((a) => ({ celula: a.celula as string, item: a.item as string }))
        : null;

    return NextResponse.json({
      croqui,
      graficos: {
        criterios,
        recomendacao_arquitetura: recomendacao,
        alocacao,
        economia: montarEconomiaDoCenario(cenario, recomendacao),
        cenario: cenarioSlide,
      },
    });
  } catch (erro) {
    return respostaErro("GET /api/croquis/[id]", erro);
  }
}

async function atualizar(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const corpo = CorpoAtualizacaoSchema.parse(await request.json());

    if (Object.keys(corpo).length === 0) {
      throw erroValidacao(null, "Nada para atualizar.");
    }

    const supabase = await criarClienteServidor();
    const { data: croqui, error } = await supabase
      .from("croquis")
      .update({ ...corpo, atualizado_por: usuario.id })
      .eq("id", id)
      .select("id, jornada_id, versao, titulo, status, conteudo, atualizado_em")
      .maybeSingle();

    if (error) {
      // 23514 — trigger app.trava_croqui_pronto_exige_revisao() (0043/0049):
      // status pronto/apresentado exigindo os 13 slides revisados, quando a
      // chave `croqui.exige_revisao_para_pronto` está ligada em `configuracoes`.
      if (error.code === "23514") {
        throw erroConflito(
          "croqui_pronto_exige_13_slides_revisados",
          "Este croqui não pode virar pronto: faltam slides revisados.",
        );
      }
      // 23505 — índice único parcial uniq_croqui_pronto (0010): só um croqui
      // pronto/apresentado por jornada.
      if (error.code === "23505") {
        throw erroConflito(
          "croqui_pronto_ja_existe_na_jornada",
          "Já existe um croqui pronto nesta jornada.",
        );
      }
      registrarErro("PATCH /api/croquis/[id]", error, { croqui_id: id });
      throw error;
    }
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    return NextResponse.json({ croqui });
  } catch (erro) {
    return respostaErro("PATCH /api/croquis/[id]", erro);
  }
}

export const PATCH = atualizar;
// Alias: `src/lib/api.ts` (já escrito) chama `atualizarCroqui` com método PUT.
// Mantemos os dois verbos apontando para o mesmo handler em vez de forçar o
// front a mudar — PATCH é o verbo semanticamente correto (atualização parcial).
export const PUT = atualizar;
