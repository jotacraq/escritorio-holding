export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { PromptVersaoAdmin, PromptVersaoResumo } from "@/types/admin";

const COLUNAS_LISTA = "id, chave, versao, titulo, modelo_padrao, effort, ativo, notas, criado_em, criado_por";

/**
 * GET /api/admin/prompts — lista SEM `corpo_sistema`/`esquema_saida` (payload
 * pesado — o Prompt Mestre e o Protocolo 01 passam de 5.000 caracteres). A
 * tela de detalhe (`GET /api/admin/prompts/[id]`) traz a versão completa.
 */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("prompts_versoes")
      .select(COLUNAS_LISTA)
      .order("chave", { ascending: true })
      .order("versao", { ascending: false });

    if (error) {
      registrarErro("api/admin/prompts GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as unknown as PromptVersaoResumo[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/prompts GET", erro);
  }
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const CorpoSchema = z.object({
  chave: z.string().trim().min(1).max(100),
  titulo: z.string().trim().min(1).max(300),
  corpo_sistema: z.string().trim().min(1),
  esquema_saida: z.record(z.string(), z.unknown()).nullish(),
  modelo_padrao: z.string().trim().min(1).max(100).default("claude-opus-5"),
  effort: z.enum(EFFORTS).default("high"),
  notas: z.string().trim().max(2000).nullish(),
  ativar: z.boolean().default(false),
});

/**
 * POST /api/admin/prompts — SEMPRE cria uma VERSÃO NOVA do prompt (regra não
 * negociável: "sistema vivo, com histórico de versões preservado" — o método
 * da Dra. Elaine, `0009_ia_prompts_execucoes_briefings.sql`). Nunca UPDATE no
 * `corpo_sistema` de uma versão existente: todo briefing já gerado guarda
 * `execucoes_ia.prompt_versao_id`, e editar o texto por baixo do histórico
 * quebraria a auditoria de "com qual versão este briefing foi gerado".
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
      .from("prompts_versoes")
      .select("versao")
      .eq("chave", corpo.chave)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ versao: number }>();
    if (erroUltima) throw erroUltima;

    const proximaVersao = (ultima?.versao ?? 0) + 1;

    if (corpo.ativar) {
      const { error: erroDesativar } = await supabase
        .from("prompts_versoes")
        .update({ ativo: false })
        .eq("chave", corpo.chave)
        .eq("ativo", true);
      if (erroDesativar) {
        registrarErro("api/admin/prompts POST#desativar-anterior", erroDesativar, { chave: corpo.chave });
        throw erroDesativar;
      }
    }

    const { data: novo, error } = await supabase
      .from("prompts_versoes")
      .insert({
        chave: corpo.chave,
        versao: proximaVersao,
        titulo: corpo.titulo,
        corpo_sistema: corpo.corpo_sistema,
        esquema_saida: corpo.esquema_saida ?? null,
        modelo_padrao: corpo.modelo_padrao,
        effort: corpo.effort,
        notas: corpo.notas ?? null,
        ativo: corpo.ativar,
        criado_por: usuario.id,
      })
      .select("*")
      .single<PromptVersaoAdmin>();

    if (error) {
      registrarErro("api/admin/prompts POST", error, { chave: corpo.chave });
      throw error;
    }

    return NextResponse.json({ prompt: novo }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/prompts POST", erro);
  }
}
