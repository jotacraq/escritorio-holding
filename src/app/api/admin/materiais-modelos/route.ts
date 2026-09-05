export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { MaterialConteudoSchema } from "@/server/ia/material";
import type { MaterialModeloAdmin, RespostaListarMateriaisModelos, RespostaMaterialModelo } from "@/types/material";

/**
 * Admin → Modelos de material (ARQUITETURA-FASE-4.md §3.4). O catálogo que a
 * escolha automática consulta: `dores`/`arquetipos`/`prioridade` são o
 * roteamento; `conteudo` é o texto-base que a IA personaliza.
 *
 * RLS: `mmo_sel` (interno lê) e `mmo_wr` (só admin escreve) já existem na 0031
 * — o cliente da SESSÃO basta, sem `service_role`. Trava de rota + trava de
 * banco, como em todo o Admin.
 */

const COLUNAS_MODELO =
  "id, chave, versao, titulo, descricao, conteudo, dores, arquetipos, prioridade, ativo, origem_dado, criado_em";

const PalavrasSchema = z.array(z.string().trim().min(1).max(60)).max(40).default([]);
/** Mesmo alfabeto de `prompts_versoes.chave`/`mensagens_templates.chave`: minúsculas, dígitos, `_`. */
const ChaveSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,49}$/, "chave: minúsculas, dígitos e _ (2 a 50 caracteres)");

const CorpoCriarSchema = z.object({
  chave: ChaveSchema,
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(500).nullish(),
  conteudo: MaterialConteudoSchema,
  dores: PalavrasSchema,
  arquetipos: PalavrasSchema,
  prioridade: z.number().int().min(0).max(32767).default(100),
  ativar: z.boolean().default(false),
});

function normalizarPalavras(palavras: string[]): string[] {
  return Array.from(new Set(palavras.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0)));
}

/** GET /api/admin/materiais-modelos — todas as versões, por chave e versão desc. */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("materiais_modelos")
      .select(COLUNAS_MODELO)
      .order("chave", { ascending: true })
      .order("versao", { ascending: false });
    if (error) {
      registrarErro("api/admin/materiais-modelos GET", error);
      throw error;
    }

    const resposta: RespostaListarMateriaisModelos = { itens: (data as MaterialModeloAdmin[] | null) ?? [] };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/admin/materiais-modelos GET", erro);
  }
}

/**
 * POST /api/admin/materiais-modelos — SEMPRE cria uma VERSÃO NOVA da `chave`
 * (modelo é dado versionado; nunca se edita o conteúdo em uso — mesmo padrão
 * de `POST /api/admin/templates`). Conteúdo escrito pelo admin nasce
 * `origem_dado='real'` (é o escritório escrevendo, não engenharia). `ativar`
 * promove pela RPC `ativar_material_modelo` (0055) — a unique parcial
 * `uniq_material_modelo_ativo` não aceita duas ativas.
 */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoCriarSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: ultima, error: erroUltima } = await supabase
      .from("materiais_modelos")
      .select("versao")
      .eq("chave", corpo.chave)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ versao: number }>();
    if (erroUltima) throw erroUltima;

    const { data: novo, error } = await supabase
      .from("materiais_modelos")
      .insert({
        chave: corpo.chave,
        versao: (ultima?.versao ?? 0) + 1,
        titulo: corpo.titulo,
        descricao: corpo.descricao ?? null,
        conteudo: corpo.conteudo,
        dores: normalizarPalavras(corpo.dores),
        arquetipos: normalizarPalavras(corpo.arquetipos),
        prioridade: corpo.prioridade,
        ativo: false,
        origem_dado: "real",
      })
      .select(COLUNAS_MODELO)
      .single<MaterialModeloAdmin>();
    if (error) {
      registrarErro("api/admin/materiais-modelos POST", error, { chave: corpo.chave });
      throw error;
    }

    let modelo = novo;
    if (corpo.ativar) {
      const { data: ativado, error: erroAtivar } = await supabase
        .rpc("ativar_material_modelo", { p_id: novo.id })
        .single<MaterialModeloAdmin>();
      if (erroAtivar) {
        registrarErro("api/admin/materiais-modelos POST#ativar", erroAtivar, { modelo_id: novo.id });
        throw erroAtivar;
      }
      modelo = ativado;
    }

    const resposta: RespostaMaterialModelo = { modelo };
    return NextResponse.json(resposta, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/materiais-modelos POST", erro);
  }
}
