export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import { processarEventoHotmart } from "@/server/pagamentos/hotmart";
import { produtoIdDoPayload, type PayloadHotmart } from "@/server/pagamentos/roteador";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({ produto_id: z.string().uuid() });

interface LinhaEvento {
  id: string;
  origem: string;
  assinatura_valida: boolean;
  erro: string | null;
  bruto: PayloadHotmart;
}

interface LinhaProduto {
  id: string;
  nome: string;
  ativo: boolean;
  hotmart_produto_id: string | null;
}

/**
 * POST /api/admin/webhooks/[id]/mapear-produto — a ação que faltava atrás da
 * pendência `produto_nao_mapeado` (D8).
 *
 * "Reprocessar" não resolve produto não mapeado: reprocessar cai exatamente no
 * mesmo lugar. A ação certa é OUTRA — ligar o `data.product.id` que veio no
 * payload a um dos três produtos e SÓ ENTÃO reprocessar. Fila cujo botão não
 * resolve treina o time a fechar tudo sem ler.
 *
 * O id vem do PAYLOAD ASSINADO já gravado, nunca do corpo da requisição: quem
 * clica escolhe o produto, não o identificador. Assim um admin não consegue
 * carimbar um id arbitrário em `produtos` por esta porta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);
    const { produto_id: produtoId } = CorpoSchema.parse(await request.json());

    const supabase = await criarClienteServidor();

    const { data: evento, error: erroEvento } = await supabase
      .from("webhooks_eventos")
      .select("id, origem, assinatura_valida, erro, bruto")
      .eq("id", id)
      .maybeSingle<LinhaEvento>();
    if (erroEvento) throw erroEvento;
    if (!evento) throw erroNaoEncontrado("Evento de webhook não encontrado.");
    if (evento.origem !== "hotmart") {
      throw new ErroApi(409, "origem_sem_produto", "Só evento da Hotmart tem produto para mapear.");
    }
    if (!evento.assinatura_valida) {
      throw new ErroApi(409, "assinatura_invalida", "Evento com assinatura inválida nunca é reprocessado.");
    }

    const hotmartProdutoId = produtoIdDoPayload(evento.bruto);
    if (!hotmartProdutoId) {
      throw new ErroApi(409, "sem_produto_no_payload", "Este evento não trouxe `data.product.id` — não há ID para mapear.");
    }

    const { data: produto, error: erroProduto } = await supabase
      .from("produtos")
      .select("id, nome, ativo, hotmart_produto_id")
      .eq("id", produtoId)
      .maybeSingle<LinhaProduto>();
    if (erroProduto) throw erroProduto;
    if (!produto) throw erroNaoEncontrado("Produto não encontrado.");
    if (!produto.ativo) {
      throw new ErroApi(409, "produto_inativo", "Produto desativado não mapeia pagamento. Reative antes.");
    }
    if (produto.hotmart_produto_id && produto.hotmart_produto_id !== hotmartProdutoId) {
      throw new ErroApi(
        409,
        "produto_ja_mapeado",
        `"${produto.nome}" já está ligado ao ID ${produto.hotmart_produto_id}. Troque o ID em Admin → Produtos se for mesmo o caso.`,
      );
    }

    const { data: ocupante, error: erroOcupante } = await supabase
      .from("produtos")
      .select("id, nome")
      .eq("hotmart_produto_id", hotmartProdutoId)
      .neq("id", produtoId)
      .maybeSingle<{ id: string; nome: string }>();
    if (erroOcupante) throw erroOcupante;
    if (ocupante) {
      throw new ErroApi(409, "id_ja_usado", `O ID ${hotmartProdutoId} já pertence a "${ocupante.nome}".`);
    }

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("api/admin/webhooks/[id]/mapear-produto#service_role", erroServiceRole, { evento_id: id });
      throw new ErroApi(503, "servico_indisponivel", "Mapear e reprocessar exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.");
    }

    if (produto.hotmart_produto_id !== hotmartProdutoId) {
      const { error: erroUpdate } = await supabase
        .from("produtos")
        .update({ hotmart_produto_id: hotmartProdutoId })
        .eq("id", produtoId);
      if (erroUpdate) {
        registrarErro("api/admin/webhooks/[id]/mapear-produto#update", erroUpdate, { evento_id: id, produto_id: produtoId });
        throw erroUpdate;
      }
    }

    const { error: erroReprocessar } = await supabase.rpc("reprocessar_webhook", { p_evento_id: id });
    if (erroReprocessar) {
      const mensagem = (erroReprocessar as { message: string }).message;
      if (mensagem.startsWith("sem_permissao")) throw erroSemPermissao();
      if (mensagem.startsWith("evento_nao_encontrado")) throw erroNaoEncontrado("Evento de webhook não encontrado.");
      registrarErro("api/admin/webhooks/[id]/mapear-produto#reprocessar", erroReprocessar, { evento_id: id });
      throw erroReprocessar;
    }

    const resultado = await processarEventoHotmart(admin, id, { forcar: true });
    return NextResponse.json({
      ok: true,
      hotmart_produto_id: hotmartProdutoId,
      produto: { id: produto.id, nome: produto.nome },
      resultado,
    });
  } catch (erro) {
    return respostaErro("api/admin/webhooks/[id]/mapear-produto POST", erro);
  }
}
