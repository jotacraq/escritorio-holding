export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { Formulario } from "@/types/banco";

/** Lista as definições de formulário (todas as versões — histórico nunca é apagado). */
export async function GET() {
  try {
    await exigirInterno();

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("formularios")
      .select("*")
      .order("chave", { ascending: true })
      .order("versao", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ itens: (data as Formulario[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/formularios GET", erro);
  }
}

const CorpoSchema = z.object({
  chave: z.string().trim().min(1).max(100),
  definicao: z.array(z.record(z.string(), z.unknown())).min(1),
  ativar: z.boolean().default(false),
});

/**
 * Cria uma nova VERSÃO de um formulário (nunca sobrescreve a anterior — o
 * histórico de versão é o que permite reabrir uma resposta antiga e saber
 * contra qual pergunta ela foi dada). `ativar:true` promove esta versão e
 * despromove a anterior — só admin, porque muda o que todo mundo vê no POP 02.
 */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: ultima, error: erroUltima } = await supabase
      .from("formularios")
      .select("versao")
      .eq("chave", corpo.chave)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroUltima) throw erroUltima;

    const proximaVersao = ((ultima as { versao: number } | null)?.versao ?? 0) + 1;

    if (corpo.ativar) {
      // Despromove a versão ativa anterior ANTES de inserir a nova — a unique
      // index parcial (`chave` where `ativo`) não permite duas ativas ao mesmo tempo.
      const { error: erroDesativar } = await supabase
        .from("formularios")
        .update({ ativo: false })
        .eq("chave", corpo.chave)
        .eq("ativo", true);
      if (erroDesativar) {
        registrarErro("api/formularios POST desativar-anterior", erroDesativar, { chave: corpo.chave });
        throw erroDesativar;
      }
    }

    const { data: novo, error } = await supabase
      .from("formularios")
      .insert({
        chave: corpo.chave,
        versao: proximaVersao,
        definicao: corpo.definicao,
        ativo: corpo.ativar,
      })
      .select("*")
      .single();

    if (error) {
      registrarErro("api/formularios POST", error, { chave: corpo.chave });
      throw error;
    }

    return NextResponse.json({ formulario: novo as Formulario }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/formularios POST", erro);
  }
}
