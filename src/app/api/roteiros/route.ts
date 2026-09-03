export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { RoteiroVersao, RoteiroVersaoResumo } from "@/types/roteiro";

const COLUNAS_LISTA = "id, chave, versao, titulo, ativo, notas, criado_em, criado_por";

const CHAVES = ["sessao_viabilidade", "pop_03", "pop_03b"] as const;

/**
 * GET /api/roteiros?chave=sessao_viabilidade — lista SEM `definicao` (a v4 do
 * script passa de 20 KB; mesmo corte de `GET /api/admin/prompts`). Qualquer
 * papel interno lê — quem conduz a ligação/sessão precisa do roteiro, não só
 * o admin (diferente de `prompts_versoes`, que fica atrás de `/admin`).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const chave = request.nextUrl.searchParams.get("chave");
    const chaveValida = chave ? z.enum(CHAVES).safeParse(chave) : null;
    if (chave && !chaveValida?.success) {
      throw erroValidacao({ chave }, "Parâmetro `chave` inválido.");
    }

    const supabase = await criarClienteServidor();
    let query = supabase
      .from("roteiros_versoes")
      .select(COLUNAS_LISTA)
      .order("chave", { ascending: true })
      .order("versao", { ascending: false });

    if (chave) query = query.eq("chave", chave);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/roteiros GET", error, { chave });
      throw error;
    }

    return NextResponse.json({ itens: (data as unknown as RoteiroVersaoResumo[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/roteiros GET", erro);
  }
}

const RoteiroFalaSchema = z.object({
  id: z.string().trim().min(1).max(100),
  locutor: z.string().trim().max(100).nullable().optional(),
  texto: z.string().min(1),
  sim: z.enum(["sigilo_gravacao", "licitude", "decisores", "proximo_passo"]).optional(),
  rotulo_sim: z.string().trim().max(200).optional(),
});

const RoteiroCampoSchema = z.object({
  id: z.string().trim().min(1).max(100),
  rotulo: z.string().min(1),
  tipo: z.string().trim().min(1).max(50),
  opcoes: z.array(z.string()).optional(),
});

const RoteiroBlocoSchema = z.object({
  id: z.string().trim().min(1).max(100),
  titulo: z.string().trim().min(1).max(300),
  objetivo: z.string().nullable().optional(),
  acao: z.string().nullable().optional(),
  falas: z.array(RoteiroFalaSchema).default([]),
  campos: z.array(RoteiroCampoSchema).default([]),
  observar: z.array(z.string()).default([]),
  proibido: z.array(z.string()).default([]),
});

export const RoteiroDefinicaoSchema = z.object({
  blocos: z.array(RoteiroBlocoSchema).min(1, "O roteiro precisa de pelo menos um bloco."),
});

const CorpoSchema = z.object({
  chave: z.enum(CHAVES),
  titulo: z.string().trim().min(1).max(300),
  definicao: RoteiroDefinicaoSchema,
  notas: z.string().trim().max(2000).nullish(),
  ativar: z.boolean().default(false),
});

/**
 * POST /api/roteiros — SEMPRE cria uma VERSÃO NOVA (mesmo padrão não
 * negociável de `prompts_versoes`/`formularios`): nunca UPDATE no `definicao`
 * de uma versão existente. `sessoes_viabilidade.roteiro_versao_id` e
 * `ligacoes_estrategicas.roteiro_versao_id` já gravados noutras linhas
 * continuam apontando para a versão com que aquela sessão/ligação foi
 * conduzida — editar o texto por baixo do histórico quebraria essa auditoria
 * (e o BLOQUEIO B15 é exatamente sobre isto: versão nova, nunca edição).
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: ultima, error: erroUltima } = await supabase
      .from("roteiros_versoes")
      .select("versao")
      .eq("chave", corpo.chave)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ versao: number }>();
    if (erroUltima) throw erroUltima;

    const proximaVersao = (ultima?.versao ?? 0) + 1;

    if (corpo.ativar) {
      const { error: erroDesativar } = await supabase
        .from("roteiros_versoes")
        .update({ ativo: false })
        .eq("chave", corpo.chave)
        .eq("ativo", true);
      if (erroDesativar) {
        registrarErro("api/roteiros POST#desativar-anterior", erroDesativar, { chave: corpo.chave });
        throw erroDesativar;
      }
    }

    const { data: novo, error } = await supabase
      .from("roteiros_versoes")
      .insert({
        chave: corpo.chave,
        versao: proximaVersao,
        titulo: corpo.titulo,
        definicao: corpo.definicao,
        notas: corpo.notas ?? null,
        ativo: corpo.ativar,
        criado_por: usuario.id,
      })
      .select("*")
      .single<RoteiroVersao>();

    if (error) {
      registrarErro("api/roteiros POST", error, { chave: corpo.chave });
      throw error;
    }

    return NextResponse.json({ roteiro: novo }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/roteiros POST", erro);
  }
}
