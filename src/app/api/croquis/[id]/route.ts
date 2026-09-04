import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CroquiConteudoSchema } from "@/server/ia/schema-croqui-slides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

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
      .maybeSingle();

    if (error) throw error;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    if (!apresentacao) return NextResponse.json({ croqui });

    // Recorte para os gráficos: só o que desenha barra e matriz. Nada de
    // grau_confianca, categoria, fontes ou texto de hipótese.
    const { data: analise } = await supabase
      .from("croqui_analises")
      .select("conteudo")
      .eq("croqui_id", id)
      .eq("atual", true)
      .maybeSingle<{ conteudo: { arquitetura?: { criterios?: unknown; recomendacao?: unknown } } }>();

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

    return NextResponse.json({
      croqui,
      graficos: {
        criterios,
        recomendacao_arquitetura: typeof arquitetura?.recomendacao === "string" ? arquitetura.recomendacao : null,
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
