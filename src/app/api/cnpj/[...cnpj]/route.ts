export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { CorpoConsultarCnpjSchema } from "@/types/cnpj";
import { CnpjInvalidoError, normalizarCnpj } from "@/server/cnpj/normalizar";
import { buscarConsultaCache, consultarCnpj } from "@/server/cnpj/consultar";
import { CHAVE_VALIDADE_DIAS, lerConfiguracaoInt, VALIDADE_DIAS_PADRAO } from "@/server/cnpj/config";

/**
 * ÚNICO lugar do sistema autorizado a falar com um terceiro por HTTP
 * (docs/ARQUITETURA-FASE-3.md §4). Esta rota em si NUNCA chama a BrasilAPI —
 * ela só valida, autentica e delega para `src/server/cnpj/consultar.ts`
 * (que delega, por sua vez, a `src/server/cnpj/brasilapi.ts`).
 *
 * Segmento catch-all (`[...cnpj]`, não `[cnpj]`) de propósito: um CNPJ
 * formatado ("12.345.678/0001-95") tem uma barra no meio — um segmento
 * dinâmico simples cortaria isso em dois e devolveria 404 de rota antes de
 * qualquer validação. `normalizarCnpj` reconstrói e valida de qualquer jeito
 * que a entrada chegue (com ou sem máscara), e é ELE — não o roteador — quem
 * decide se o CNPJ é aceitável.
 *
 * `exigirVePatrimonio()` é a trava de ROTA; as policies `cnpj_sel`/`cnpj_ins`/
 * `cnpj_upd` (0044) são a trava de BANCO. As duas sempre, nunca só uma.
 */

function cnpjDoPath(segmentos: string[]): string {
  try {
    return normalizarCnpj(segmentos.join("/"));
  } catch (erro) {
    if (erro instanceof CnpjInvalidoError) {
      throw erroValidacao({ cnpj: segmentos.join("/") }, erro.message);
    }
    throw erro;
  }
}

/** GET /api/cnpj/<cnpj> — lê o cache. NUNCA chama a BrasilAPI (§4.3: "consulta só sob clique"). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ cnpj: string[] }> }) {
  try {
    await exigirVePatrimonio();
    const { cnpj: segmentos } = await params;
    const cnpj = cnpjDoPath(segmentos);

    const supabase = await criarClienteServidor();
    const consulta = await buscarConsultaCache(supabase, cnpj);

    if (!consulta) {
      throw erroNaoEncontrado("Este CNPJ nunca foi consultado.");
    }

    const validadeDias = await lerConfiguracaoInt(supabase, CHAVE_VALIDADE_DIAS, VALIDADE_DIAS_PADRAO);
    return NextResponse.json({ consulta, validade_dias: validadeDias });
  } catch (erro) {
    return respostaErro("api/cnpj/[...cnpj] GET", erro);
  }
}

/**
 * POST /api/cnpj/<cnpj> — consulta a BrasilAPI (respeitando frescor, a menos
 * que `forcar: true`) e grava/atualiza o cache. `jornada_id` é obrigatório:
 * é o que ancora o evento em `eventos_timeline` — "consulta a fonte externa
 * sobre cliente é ato auditável" (§4.4.5).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ cnpj: string[] }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { cnpj: segmentos } = await params;
    const cnpj = cnpjDoPath(segmentos);

    const corpo = CorpoConsultarCnpjSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", corpo.jornada_id)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const resultado = await consultarCnpj({
      supabase,
      cnpj,
      jornadaId: corpo.jornada_id,
      usuarioId: usuario.id,
      forcar: corpo.forcar,
    });

    if (resultado.tipo === "falha") {
      // Regra dura (§4.4.3): se já havia dado bom em cache, a resposta segue
      // 200 mostrando o dado ANTIGO com a data — nunca um erro que faz a
      // tela perder o que já tinha. Sem dado anterior, é erro explícito e
      // nada foi fabricado (o cache, se existir, só ganhou o carimbo de falha).
      if (resultado.consultaAnterior?.razao_social) {
        return NextResponse.json({
          consulta: resultado.consultaAnterior,
          de_cache: true,
          atualizacao_falhou: true,
          falha_motivo: resultado.motivo,
        });
      }

      if (resultado.statusHttp === 404) {
        throw erroNaoEncontrado("CNPJ não encontrado na Receita Federal (BrasilAPI).");
      }
      registrarErro("api/cnpj/[...cnpj] POST", new Error(resultado.motivo), {
        cnpj,
        jornada_id: corpo.jornada_id,
        status_http: resultado.statusHttp,
      });
      throw new ErroApi(
        resultado.statusHttp,
        "cnpj_consulta_indisponivel",
        "Não foi possível consultar a BrasilAPI agora. Tente novamente em instantes.",
      );
    }

    return NextResponse.json(
      { consulta: resultado.consulta, de_cache: resultado.tipo === "cache" },
      { status: resultado.tipo === "sucesso" ? 201 : 200 },
    );
  } catch (erro) {
    return respostaErro("api/cnpj/[...cnpj] POST", erro);
  }
}
