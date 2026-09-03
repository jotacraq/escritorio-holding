export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import {
  CorpoRegistrarPesquisaSchema,
  QueryListarPesquisasSchema,
  type PesquisaPublica,
} from "@/types/pesquisa-publica";

/**
 * BLOQUEIO B4 / B-4B (docs/ARQUITETURA.md, docs/ARQUITETURA-FASE-2.md §4.6).
 *
 * Esta rota só LÊ e ESCREVE a tabela `pesquisas_publicas`. Ela NUNCA faz uma
 * requisição para um domínio de terceiro (JusBrasil ou qualquer outro) — não
 * existe scraping aqui, nem em nenhum outro arquivo desta entrega. O que a
 * equipe pesquisou, ela pesquisou por fora do sistema; esta rota só guarda o
 * relato manual, com a trava de consentimento no banco (0036, trigger
 * `trg_pesq_consentimento`) fazendo o trabalho pesado — mesmo que esta rota
 * tivesse um bug e deixasse passar algo que não devia, o INSERT falha lá.
 *
 * Mesmo recorte de quem vê patrimônio (`exigirVePatrimonio` = trava de rota;
 * policies `pp_sel`/`pp_ins` = trava de banco — as duas sempre, nunca só uma).
 */

/** GET /api/pesquisas-publicas?jornada_id=<uuid> — lista as pesquisas registradas para a jornada. */
export async function GET(request: NextRequest) {
  try {
    await exigirVePatrimonio();
    const { jornada_id: jornadaId } = QueryListarPesquisasSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: pesquisas, error } = await supabase
      .from("pesquisas_publicas")
      .select("*")
      .eq("jornada_id", jornadaId)
      .order("consultado_em", { ascending: false });

    if (error) {
      registrarErro("api/pesquisas-publicas GET", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ pesquisas: (pesquisas as PesquisaPublica[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/pesquisas-publicas GET", erro);
  }
}

/**
 * POST /api/pesquisas-publicas — registra manualmente uma pesquisa já feita
 * pela equipe em fonte pública. `pessoa_id` é sempre derivado da jornada no
 * servidor (o corpo não tem esse campo — ver `CorpoRegistrarPesquisaSchema`);
 * `consultado_por` é sempre o usuário da sessão. Sem consentimento vigente do
 * tipo `pesquisa_fontes_publicas` para a pessoa dona da jornada, o INSERT
 * falha no banco (trigger `trg_pesq_consentimento`, 0036) e esta rota
 * devolve 409 — não 500: é um estado esperado do sistema, não uma falha.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirVePatrimonio();
    const corpo = CorpoRegistrarPesquisaSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id, pessoa_id")
      .eq("id", corpo.jornada_id)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    const { data: pesquisa, error } = await supabase
      .from("pesquisas_publicas")
      .insert({
        jornada_id: corpo.jornada_id,
        pessoa_id: (jornada as { pessoa_id: string }).pessoa_id,
        fonte: corpo.fonte,
        url: corpo.url ?? null,
        ...(corpo.consultado_em ? { consultado_em: corpo.consultado_em } : {}),
        consultado_por: usuario.id,
        base_legal: corpo.base_legal,
        resumo: corpo.resumo,
      })
      .select("*")
      .single();

    if (error) {
      if (error.message.includes("sem_consentimento_pesquisa_fontes_publicas")) {
        throw erroConflito(
          "sem_consentimento_pesquisa_fontes_publicas",
          "Sem consentimento vigente do tipo 'pesquisa_fontes_publicas' para esta pessoa. Registre o consentimento antes de guardar a pesquisa.",
        );
      }
      if (error.message.includes("pessoa_jornada_incompativel")) {
        throw erroValidacao(null, "Jornada informada não corresponde à pessoa da pesquisa.");
      }
      if (error.code === "23514") {
        throw erroValidacao({ postgres: error.message }, "Dados da pesquisa inválidos.");
      }
      registrarErro("api/pesquisas-publicas POST", error, { jornada_id: corpo.jornada_id });
      throw error;
    }

    return NextResponse.json({ pesquisa: pesquisa as PesquisaPublica }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/pesquisas-publicas POST", erro);
  }
}
