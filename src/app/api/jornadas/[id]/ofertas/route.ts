export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { exigirParametro, parametrosVigentes } from "@/server/parametros";
import { CHAVE_PARAMETRO, type PrecoCroqui } from "@/types/cenario";
import type { Oferta } from "@/types/roteiro";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * Preço do Croqui vem de `parametros_metodo` (0056, B27) — não de constante
 * TS. Ausência é `null` + chave em `parametro_ausente`, nunca um número
 * escondido: a tela mostra `<SeloStub>` e o Admin cadastra.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
async function precoCroqui(supabase: any): Promise<PrecoCroqui> {
  const { parametros, ausentes } = await parametrosVigentes(supabase, [
    CHAVE_PARAMETRO.croquiPadrao,
    CHAVE_PARAMETRO.croquiIncentivo,
  ]);
  return {
    padrao: parametros[CHAVE_PARAMETRO.croquiPadrao]?.valor ?? null,
    incentivo: parametros[CHAVE_PARAMETRO.croquiIncentivo]?.valor ?? null,
    parametro_ausente: ausentes,
  };
}

/**
 * GET /api/jornadas/[id]/ofertas — histórico de ofertas da jornada + bloco
 * `preco` (`PrecoCroqui`: `{ padrao, incentivo, parametro_ausente[] }`).
 * Leitura é `eh_interno()` na RLS (`of_sel`, 0011) — mais aberta que a
 * escrita (`admin`/`advogada`, `of_wr`): quem atende o pós-sessão precisa
 * ver o que foi ofertado, mesmo sem poder registrar oferta nova.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const [{ data: itens, error }, preco] = await Promise.all([
      supabase.from("ofertas").select("*").eq("jornada_id", jornadaId).order("ofertada_em", { ascending: false }),
      precoCroqui(supabase),
    ]);

    if (error) {
      registrarErro("api/jornadas/[id]/ofertas GET", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ itens: (itens as Oferta[] | null) ?? [], preco });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/ofertas GET", erro);
  }
}

/**
 * R$ 7.200 padrão / R$ 4.500 "Incentivo do Resolvedor" (PARTE 11 do script) —
 * `valor_ofertado` tem um default por `condicao`, mas aceita ajuste (a
 * advogada negocia ao vivo). `valor_padrao` sempre fica no preço de tabela,
 * como referência — nunca deriva de `valor_ofertado`.
 */
const CorpoSchema = z.object({
  produto_id: z.string().uuid().optional(),
  condicao: z.enum(["padrao", "incentivo_resolvedor"]),
  valor_ofertado: z.number().min(0).max(1_000_000).optional(),
  valida_ate: z.string().datetime({ offset: true }).optional(),
});

/**
 * POST /api/jornadas/[id]/ofertas — registra O QUE foi ofertado, ANTES do
 * pagamento chegar (CONFLITO C8: sem isto, o valor do webhook não reconcilia
 * com nada). Só `admin`/`advogada` (`of_wr`) — mesmo recorte de quem vê
 * patrimônio, porque preço negociado é informação sensível de gestão.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    let produtoId = corpo.produto_id ?? null;
    if (produtoId) {
      const { data: produto, error: erroProduto } = await supabase
        .from("produtos")
        .select("id, tipo")
        .eq("id", produtoId)
        .maybeSingle();
      if (erroProduto) throw erroProduto;
      if (!produto) throw erroNaoEncontrado("Produto não encontrado.");
      if ((produto as { tipo: string }).tipo !== "croqui_estrutural") {
        throw erroValidacao(
          { produto_id: produtoId },
          "A oferta da Sessão de Viabilidade é sempre do Croqui Estrutural (PARTE 11 do script).",
        );
      }
    } else {
      const { data: produtoAtivo, error: erroProdutoAtivo } = await supabase
        .from("produtos")
        .select("id")
        .eq("tipo", "croqui_estrutural")
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      if (erroProdutoAtivo) throw erroProdutoAtivo;
      if (!produtoAtivo) {
        throw erroConflito(
          "produto_nao_configurado",
          "Nenhum produto ativo do tipo Croqui Estrutural — configure em Admin > Produtos antes de registrar a oferta.",
        );
      }
      produtoId = (produtoAtivo as { id: string }).id;
    }

    // Preço de tabela sai do parâmetro versionado (B27). Sem versão ativa →
    // 409 `parametro_ausente` com a chave: a oferta não nasce com número
    // inventado, mesmo que a advogada tenha digitado `valor_ofertado`
    // (`valor_padrao` é a referência e precisa existir de verdade).
    const { parametros } = await parametrosVigentes(supabase, [
      CHAVE_PARAMETRO.croquiPadrao,
      CHAVE_PARAMETRO.croquiIncentivo,
    ]);
    const parametroPadrao = exigirParametro(parametros[CHAVE_PARAMETRO.croquiPadrao], CHAVE_PARAMETRO.croquiPadrao);
    const valorOfertadoPadrao =
      corpo.condicao === "incentivo_resolvedor"
        ? exigirParametro(parametros[CHAVE_PARAMETRO.croquiIncentivo], CHAVE_PARAMETRO.croquiIncentivo).valor
        : parametroPadrao.valor;

    // "Incentivo do Resolvedor... válido apenas para quem decide hoje" (PARTE
    // 11) — sem prazo explícito do cliente, expira no fim do dia da sessão.
    const fimDoDia = new Date();
    fimDoDia.setHours(23, 59, 59, 999);
    const validaAtePadrao = corpo.condicao === "incentivo_resolvedor" ? fimDoDia.toISOString() : null;

    const { data: oferta, error } = await supabase
      .from("ofertas")
      .insert({
        jornada_id: jornadaId,
        produto_id: produtoId,
        valor_padrao: parametroPadrao.valor,
        valor_ofertado: corpo.valor_ofertado ?? valorOfertadoPadrao,
        condicao: corpo.condicao,
        valida_ate: corpo.valida_ate ?? validaAtePadrao,
        ofertada_por: usuario.id,
      })
      .select("*")
      .single<Oferta>();

    if (error) {
      registrarErro("api/jornadas/[id]/ofertas POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ oferta }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/ofertas POST", erro);
  }
}
