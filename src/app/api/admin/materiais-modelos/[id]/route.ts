export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroSemPermissao, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { MaterialModeloAdmin, RespostaMaterialModelo } from "@/types/material";

const COLUNAS_MODELO =
  "id, chave, versao, titulo, descricao, conteudo, dores, arquetipos, prioridade, ativo, origem_dado, criado_em";

const ParametroSchema = z.object({ id: z.string().uuid() });
const PalavrasSchema = z.array(z.string().trim().min(1).max(60)).max(40);

const CorpoEditarSchema = z
  .object({
    titulo: z.string().trim().min(1).max(200).optional(),
    descricao: z.string().trim().max(500).nullish(),
    dores: PalavrasSchema.optional(),
    arquetipos: PalavrasSchema.optional(),
    prioridade: z.number().int().min(0).max(32767).optional(),
    origem_dado: z.enum(["real", "exemplo"]).optional(),
    ativar: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, { message: "Nada para alterar." });

function normalizarPalavras(palavras: string[]): string[] {
  return Array.from(new Set(palavras.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0)));
}

/**
 * PATCH /api/admin/materiais-modelos/[id] — só METADADOS de roteamento e
 * revisão (título, descrição, dores, arquétipos, prioridade, origem_dado).
 * Conteúdo novo é `POST` (versão nova). `origem_dado: 'real'` é a advogada
 * marcando o rascunho como revisado; `ativar: true` chama
 * `ativar_material_modelo` (0055), que recusa rascunho (`modelo_rascunho`) —
 * regra no banco, não só aqui.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = "api/admin/materiais-modelos/[id] PATCH";
  try {
    await exigirPapel("admin");
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoEditarSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { ativar, ...campos } = corpo;

    const alteracoes: Record<string, unknown> = {};
    if (campos.titulo !== undefined) alteracoes.titulo = campos.titulo;
    if (campos.descricao !== undefined) alteracoes.descricao = campos.descricao;
    if (campos.dores !== undefined) alteracoes.dores = normalizarPalavras(campos.dores);
    if (campos.arquetipos !== undefined) alteracoes.arquetipos = normalizarPalavras(campos.arquetipos);
    if (campos.prioridade !== undefined) alteracoes.prioridade = campos.prioridade;
    if (campos.origem_dado !== undefined) alteracoes.origem_dado = campos.origem_dado;

    let modelo: MaterialModeloAdmin | null = null;

    if (Object.keys(alteracoes).length > 0) {
      const { data, error } = await supabase
        .from("materiais_modelos")
        .update(alteracoes)
        .eq("id", id)
        .select(COLUNAS_MODELO)
        .maybeSingle<MaterialModeloAdmin>();
      if (error) {
        registrarErro(contexto, error, { modelo_id: id });
        throw error;
      }
      // RLS `mmo_wr` nega em silêncio (0 linhas) para quem não é admin; a rota
      // já barrou antes, então 0 linhas aqui é "não existe".
      if (!data) throw erroNaoEncontrado("Modelo de material não encontrado.");
      modelo = data;
    }

    if (ativar) {
      const { data, error } = await supabase.rpc("ativar_material_modelo", { p_id: id }).single<MaterialModeloAdmin>();
      if (error) {
        if (error.message.startsWith("versao_nao_encontrada")) throw erroNaoEncontrado("Modelo de material não encontrado.");
        if (error.message.startsWith("sem_permissao")) throw erroSemPermissao();
        if (error.message.startsWith("modelo_rascunho")) {
          throw new ErroApi(409, "modelo_rascunho", "Este modelo é um rascunho. Marque como revisado (origem_dado=real) antes de ativar.");
        }
        registrarErro(`${contexto}#ativar`, error, { modelo_id: id });
        throw error;
      }
      modelo = data;
    }

    if (!modelo) {
      const { data, error } = await supabase
        .from("materiais_modelos")
        .select(COLUNAS_MODELO)
        .eq("id", id)
        .maybeSingle<MaterialModeloAdmin>();
      if (error) throw error;
      if (!data) throw erroNaoEncontrado("Modelo de material não encontrado.");
      modelo = data;
    }

    const resposta: RespostaMaterialModelo = { modelo };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro(contexto, erro);
  }
}
