export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { garantirSemJornadaAberta, resolverOuCriarPessoa } from "@/server/jornadas";
import type { JornadaKanbanLinha } from "@/types/banco";

const TAMANHO_PAGINA = 100;

const FiltrosSchema = z.object({
  etapa: z
    .enum([
      "captado",
      "qualificado",
      "sessao_contratada",
      "sessao_agendada",
      "sessao_realizada",
      "croqui_contratado",
      "croqui_apresentado",
      "holding_contratada",
    ])
    .optional(),
  edicao_id: z.string().uuid().optional(),
  origem: z.enum(["seminario", "indicacao", "organico", "trafego_pago", "outro"]).optional(),
  responsavel_id: z.string().uuid().optional(),
  busca: z.string().trim().min(1).max(200).optional(),
  desfecho: z.enum(["aberta", "ganha", "perdida", "descartada", "congelada"]).optional(),
  incluir_fechadas: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});

export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(params);

    const supabase = await criarClienteServidor();
    let query = supabase.from("vw_jornada_kanban").select("*", { count: "exact" });

    if (filtros.etapa) query = query.eq("etapa", filtros.etapa);
    if (filtros.edicao_id) query = query.eq("edicao_id", filtros.edicao_id);
    if (filtros.origem) query = query.eq("origem", filtros.origem);
    if (filtros.responsavel_id) query = query.eq("responsavel_id", filtros.responsavel_id);

    if (filtros.desfecho) {
      query = query.eq("desfecho", filtros.desfecho);
    } else if (!filtros.incluir_fechadas) {
      query = query.eq("desfecho", "aberta");
    }

    if (filtros.busca) {
      // MÉDIO 2 (pentest 03/09/2026): interpolar o termo dentro de `.or()` deixava
      // vírgula/parênteses do PostgREST reescreverem o filtro inteiro (reproduzido
      // com `)*or(etapa.eq.holding_contratada`). `buscar_pessoas_por_termo` (0022)
      // recebe o termo como bind parameter — nunca concatenado em SQL — e usa o
      // índice full-text já existente (`idx_pessoas_nome_busca`).
      const termo = filtros.busca.replace(/[%_]/g, "");
      const { data: pessoasEncontradas, error: erroBusca } = await supabase.rpc("buscar_pessoas_por_termo", {
        p_termo: termo,
      });
      if (erroBusca) {
        registrarErro("api/jornadas GET busca", erroBusca, { termo });
        throw erroBusca;
      }
      const pessoaIds = ((pessoasEncontradas as { pessoa_id: string }[] | null) ?? []).map((p) => p.pessoa_id);
      if (pessoaIds.length === 0) {
        return NextResponse.json({ itens: [], total: 0 });
      }
      query = query.in("pessoa_id", pessoaIds);
    }

    const inicio = (filtros.pagina - 1) * TAMANHO_PAGINA;
    query = query.order("entrou_na_etapa_em", { ascending: false }).range(inicio, inicio + TAMANHO_PAGINA - 1);

    const { data, error, count } = await query;
    if (error) {
      registrarErro("api/jornadas GET", error, { filtros });
      throw error;
    }

    return NextResponse.json({ itens: (data as JornadaKanbanLinha[] | null) ?? [], total: count ?? 0 });
  } catch (erro) {
    return respostaErro("api/jornadas GET", erro);
  }
}

const CriarJornadaSchema = z.object({
  pessoa: z.object({
    nome: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(200).optional(),
    telefone: z.string().trim().min(8).max(20).optional(),
    cidade: z.string().trim().max(120).optional(),
    uf: z.string().trim().length(2).optional(),
    profissao: z.string().trim().max(120).optional(),
  }),
  edicao_id: z.string().uuid().optional(),
  origem: z.enum(["seminario", "indicacao", "organico", "trafego_pago", "outro"]).default("seminario"),
  trilha: z.enum(["seminario", "preliminar"]).default("seminario"),
});

export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const corpo = await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    });
    const dados = CriarJornadaSchema.parse(corpo);

    if (dados.origem === "seminario" && !dados.edicao_id) {
      throw erroValidacao(
        { campo: "edicao_id" },
        "edicao_id é obrigatório quando origem é 'seminario'.",
      );
    }

    const supabase = await criarClienteServidor();

    const pessoa = await resolverOuCriarPessoa(supabase, dados.pessoa);
    await garantirSemJornadaAberta(supabase, pessoa.id);

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .insert({
        pessoa_id: pessoa.id,
        edicao_id: dados.edicao_id ?? null,
        origem: dados.origem,
        trilha: dados.trilha,
      })
      .select("id")
      .single();

    if (erroJornada) {
      registrarErro("api/jornadas POST", erroJornada, { pessoa_id: pessoa.id });
      throw erroJornada;
    }

    if (dados.origem === "seminario" && dados.edicao_id) {
      const { error: erroParticipacao } = await supabase
        .from("participacoes_seminario")
        .insert({ pessoa_id: pessoa.id, edicao_id: dados.edicao_id, origem: "seminario" })
        .select("id")
        .maybeSingle();
      // Conflito (pessoa já participou desta edição) não é erro de negócio — ignora.
      if (erroParticipacao && erroParticipacao.code !== "23505") {
        registrarErro("api/jornadas POST participacao", erroParticipacao, { pessoa_id: pessoa.id });
      }
    }

    return NextResponse.json({ jornada_id: (jornada as { id: string }).id }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas POST", erro);
  }
}
