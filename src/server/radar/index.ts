import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import {
  derivarRadarDocumentos,
  type BemDoRadar,
  type DocumentoDoRadar,
  type FamiliarDoRadar,
  type PedidoDoRadar,
} from "@/lib/radar/derivar";
import type { RespostaRadar } from "@/types/jornada-automacoes";
import { resolverModeloDoCroqui } from "./modelo";

/** Códigos de "essa tabela/coluna ainda não existe neste banco". */
const CODIGOS_AUSENTE = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

/**
 * Radar de documentos de uma jornada (§8.3): a lista é DERIVADA
 * (`src/lib/radar/derivar.ts`) do patrimônio, da família e do modelo do croqui;
 * o banco só guarda o ato humano (`documentos_pedidos`, 0065).
 *
 * A rota exige `ve_patrimonio` e a RLS repete a exigência nas três tabelas
 * (`patrimonio_itens`, `familiares`, `documentos`) — as duas travas, sempre.
 *
 * `pedidos_disponiveis = false` quando a 0065 não foi aplicada: a lista
 * aparece (é derivada, não depende do banco novo), mas nenhum pedido pode ser
 * gravado, e a tela precisa saber para não oferecer um botão que só falha.
 */
export async function montarRadar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<RespostaRadar> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle<{ pessoa_id: string }>();
  if (erroJornada) throw erroJornada;
  const pessoaId = jornada?.pessoa_id ?? null;

  const [bens, familiares, documentos, pedidos, modelo] = await Promise.all([
    carregarBens(supabase, jornadaId, pessoaId),
    carregarFamiliares(supabase, jornadaId, pessoaId),
    carregarDocumentos(supabase, jornadaId),
    carregarPedidos(supabase, jornadaId),
    resolverModeloDoCroqui(supabase, jornadaId),
  ]);

  return {
    itens: derivarRadarDocumentos(bens, familiares, modelo, documentos, pedidos.linhas),
    modelo,
    pedidos_disponiveis: pedidos.disponivel,
  };
}

async function carregarBens(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
  pessoaId: string | null,
): Promise<BemDoRadar[]> {
  if (!pessoaId) return [];
  // Só id/tipo/descrição: valor de bem não faz falta nenhuma ao radar.
  const { data, error } = await supabase
    .from("patrimonio_itens")
    .select("id, tipo, descricao")
    .eq("pessoa_id", pessoaId)
    .eq("ativo", true)
    .order("criado_em", { ascending: true })
    .returns<BemDoRadar[]>();
  if (error) {
    registrarErro("server/radar.carregarBens", error, { jornada_id: jornadaId });
    return [];
  }
  return data ?? [];
}

async function carregarFamiliares(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
  pessoaId: string | null,
): Promise<FamiliarDoRadar[]> {
  if (!pessoaId) return [];
  const { data, error } = await supabase
    .from("familiares")
    .select("id, parentesco, nome")
    .eq("pessoa_id", pessoaId)
    .eq("ativo", true)
    .order("criado_em", { ascending: true })
    .returns<FamiliarDoRadar[]>();
  if (error) {
    registrarErro("server/radar.carregarFamiliares", error, { jornada_id: jornadaId });
    return [];
  }
  return data ?? [];
}

async function carregarDocumentos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<DocumentoDoRadar[]> {
  const comItemRef = await supabase
    .from("documentos")
    .select("id, tipo, criado_em, item_ref")
    .eq("jornada_id", jornadaId)
    .returns<DocumentoDoRadar[]>();

  if (!comItemRef.error) return comItemRef.data ?? [];

  // Antes da 0065 a coluna `item_ref` não existe: relê sem ela em vez de
  // devolver lista vazia (o que apagaria documentos já recebidos da tela).
  if (CODIGOS_AUSENTE.has(comItemRef.error.code ?? "")) {
    const { data, error } = await supabase
      .from("documentos")
      .select("id, tipo, criado_em")
      .eq("jornada_id", jornadaId)
      .returns<DocumentoDoRadar[]>();
    if (error) {
      registrarErro("server/radar.carregarDocumentos", error, { jornada_id: jornadaId });
      return [];
    }
    return data ?? [];
  }

  registrarErro("server/radar.carregarDocumentos", comItemRef.error, { jornada_id: jornadaId });
  return [];
}

async function carregarPedidos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<{ linhas: PedidoDoRadar[]; disponivel: boolean }> {
  const { data, error } = await supabase
    .from("documentos_pedidos")
    .select("chave, tipo, item_ref, pedido_em, conferido_em, dispensado_em")
    .eq("jornada_id", jornadaId)
    .returns<PedidoDoRadar[]>();

  if (error) {
    if (CODIGOS_AUSENTE.has(error.code ?? "")) return { linhas: [], disponivel: false };
    registrarErro("server/radar.carregarPedidos", error, { jornada_id: jornadaId });
    return { linhas: [], disponivel: false };
  }
  return { linhas: data ?? [], disponivel: true };
}
