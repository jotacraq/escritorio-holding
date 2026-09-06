export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import type { RoteiroVersao, RoteiroVersaoResumo } from "@/types/roteiro";

/**
 * `ativado_por`/`ativado_em` nasceram na 0078 — é a resposta rastreável do
 * BLOQUEIO B15 ("qual das 4 versões é a oficial, e quem decidiu"). Enquanto a
 * migration não for aplicada, a consulta cai no conjunto legado: a tela mostra
 * a lista sem a autoria, nunca um erro.
 */
const COLUNAS_LISTA =
  "id, chave, versao, titulo, ativo, notas, criado_em, criado_por, ativado_por, ativado_em";
const COLUNAS_LISTA_LEGADO = "id, chave, versao, titulo, ativo, notas, criado_em, criado_por";

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

    let { data, error } = await query;
    if (error && migracaoPendente(error)) {
      let consultaLegado = supabase
        .from("roteiros_versoes")
        .select(COLUNAS_LISTA_LEGADO)
        .order("chave", { ascending: true })
        .order("versao", { ascending: false });
      if (chave) consultaLegado = consultaLegado.eq("chave", chave);
      const legado = await consultaLegado;
      // O supabase-js tipa a linha pelo literal de colunas; o conjunto legado
      // tem duas a menos. `unknown` aqui é a ponte honesta entre os dois — o
      // consumidor recebe `RoteiroVersaoResumo`, com `ativado_*` opcionais.
      data = (legado.data as unknown as typeof data) ?? null;
      error = legado.error;
    }
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
 *
 * Desde a 0081 é UMA transação: `publicar_roteiro_versao` calcula o N+1,
 * desativa a anterior e insere a nova junto. O caminho antigo eram três idas ao
 * supabase-js — o mesmo bug que a 0078 fechou para formulários: com o INSERT
 * falhando depois do UPDATE, a chave ficava PERMANENTEMENTE sem versão ativa e
 * `iniciar_sessao_viabilidade` (0030) passava a gravar `roteiro_versao_id`
 * nulo, sem ninguém perceber.
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
    const { data: novo, error } = await supabase
      .rpc("publicar_roteiro_versao", {
        p_chave: corpo.chave,
        p_definicao: corpo.definicao,
        p_titulo: corpo.titulo,
        p_ativar: corpo.ativar,
        p_notas: corpo.notas ?? null,
        p_criado_por: usuario.id,
      })
      .single<RoteiroVersao>();

    if (error) {
      if (migracaoPendente(error)) {
        return respostaMigracaoPendente("0081", "publicar_roteiro_versao não existe neste banco");
      }
      const pg = error as { message?: string; code?: string };
      const mensagem = pg.message ?? "";
      if (mensagem.startsWith("sem_permissao")) {
        return NextResponse.json(
          { erro: "sem_permissao", mensagem: "Sem permissão para publicar versão de roteiro." },
          { status: 403 },
        );
      }
      if (pg.code === "23505") {
        return NextResponse.json(
          { erro: "conflito_de_versao", mensagem: "Outra publicação aconteceu ao mesmo tempo. Recarregue e tente de novo." },
          { status: 409 },
        );
      }
      if (pg.code === "22023" || pg.code === "22004") {
        return NextResponse.json(
          { erro: "definicao_invalida", mensagem: mensagem.includes(": ") ? mensagem.slice(mensagem.indexOf(": ") + 2) : mensagem },
          { status: 400 },
        );
      }
      registrarErro("api/roteiros POST", error, { chave: corpo.chave });
      throw error;
    }

    return NextResponse.json({ roteiro: novo }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/roteiros POST", erro);
  }
}
