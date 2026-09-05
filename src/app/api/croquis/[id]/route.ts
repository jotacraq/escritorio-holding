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

/**
 * Colunas do croqui devolvidas pelas duas rotas. `criado_em` entra só no GET:
 * o PATCH responde o que a edição mudou, e data de criação não muda.
 */
const CAMPOS_CROQUI = "id, jornada_id, versao, titulo, status, conteudo";

/**
 * GET /api/croquis/[id] — o croqui e as análises embutidas (o editor precisa
 * delas).
 *
 * O ramo `?modo=apresentacao` foi REMOVIDO (Fase 5, trava do Fable). Ele
 * existia para o Modo Apresentação antigo, que montava os gráficos a partir da
 * análise da IA e do Cenário Patrimonial; a apresentação atual
 * (`/croquis/[croquiId]/apresentar`) desenha as 19 tabelas do motor
 * determinístico e lê `GET /api/jornadas/[id]/croqui-calculo`. Depois que o
 * `ModoApresentacao` saiu, o ramo ficou com zero chamadores — e junto com ele
 * `buscarCroquiParaApresentar` em `src/lib/api.ts` (também removida).
 *
 * A razão de segurança que o criou continua valendo e passou a ser resolvida
 * na origem: o navegador da apresentação é a tela que o CLIENTE vê, e mandar
 * grau de confiança, categoria (fato/hipótese/inferência) e fontes internas
 * para lá seria vazamento de payload, invisível na tela mas a um DevTools de
 * distância, com a família do lado. A apresentação de hoje não busca análise
 * nenhuma — não renderizar não é não enviar, então ela não envia.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const { data: croqui, error } = await supabase
      .from("croquis")
      .select(`${CAMPOS_CROQUI}, criado_em, atualizado_em, croqui_analises(id, versao, conteudo, grau_confianca, criado_em)`)
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

    return NextResponse.json({ croqui });
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
      .select(`${CAMPOS_CROQUI}, atualizado_em`)
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
