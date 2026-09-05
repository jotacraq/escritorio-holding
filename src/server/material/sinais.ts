import type { SupabaseClient } from "@supabase/supabase-js";
import type { FonteDorMaterial } from "@/types/material";
import type { ModeloMaterialCatalogo, SinaisEscolhaModelo } from "./escolher";

/**
 * Leitura dos sinais que alimentam a escolha do modelo (§3.4) e a entrada da IA
 * (`conclusao_sessao`). Tudo aqui é leitura com `service_role` a partir de
 * tabelas que JÁ existem — nenhuma chamada de IA, nenhuma tabela nova.
 *
 * Cascata da dor (CONFLITO C11 — "dor" não é campo do método; as fontes reais
 * são estas três, nesta ordem, e SÓ estas). Sem nenhuma: fonte_dor='nenhuma',
 * material vira o modelo 'padrao' — nunca uma dor inventada.
 */

export interface ConclusaoSessao {
  /** `relatorios_sessao.resultado_sessao` */
  resultado_sessao?: string;
  /** `relatorios_sessao.consideracoes_apresentacao_croqui` */
  consideracoes_apresentacao_croqui?: string;
  /** `croqui_analises.conteudo.resumo_executivo` (análise atual) — cortado se a entrada passar do teto. */
  resumo_executivo?: string;
}

export interface SinaisMaterial extends SinaisEscolhaModelo {
  fonteDor: FonteDorMaterial;
  /** `undefined` quando nenhum dos três campos está preenchido — a chave nem entra na entrada da IA. */
  conclusaoSessao: ConclusaoSessao | undefined;
}

interface LinhaRelatorio {
  preocupacao_predominante: string | null;
  resultado_sessao: string | null;
  consideracoes_apresentacao_croqui: string | null;
}

function limpar(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto.length > 0 ? texto : null;
}

async function buscarRelatorio(supabaseAdmin: SupabaseClient, jornadaId: string): Promise<LinhaRelatorio | null> {
  const { data: sessao } = await supabaseAdmin
    .from("sessoes_viabilidade")
    .select("id")
    .eq("jornada_id", jornadaId)
    .maybeSingle<{ id: string }>();
  if (!sessao) return null;

  const { data } = await supabaseAdmin
    .from("relatorios_sessao")
    .select("preocupacao_predominante, resultado_sessao, consideracoes_apresentacao_croqui")
    .eq("sessao_id", sessao.id)
    .maybeSingle<LinhaRelatorio>();
  return data ?? null;
}

async function buscarArquetipo(supabaseAdmin: SupabaseClient, jornadaId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("briefings")
    .select("conteudo")
    .eq("jornada_id", jornadaId)
    .eq("atual", true)
    .maybeSingle<{ conteudo: Record<string, unknown> | null }>();
  const bloco = data?.conteudo?.["arquetipo_patrimonial"];
  if (!bloco || typeof bloco !== "object") return null;
  const registro = bloco as Record<string, unknown>;
  // v2 do schema grava `escolhido`; versões anteriores podem ter `predominante`.
  return limpar(registro["escolhido"]) ?? limpar(registro["predominante"]);
}

async function buscarAnaliseCroqui(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
): Promise<{ riscos: string[]; resumoExecutivo: string | null }> {
  const vazio = { riscos: [] as string[], resumoExecutivo: null };
  const { data: croqui } = await supabaseAdmin
    .from("croquis")
    .select("id")
    .eq("jornada_id", jornadaId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!croqui) return vazio;

  const { data: analise } = await supabaseAdmin
    .from("croqui_analises")
    .select("conteudo")
    .eq("croqui_id", croqui.id)
    .eq("atual", true)
    .maybeSingle<{ conteudo: Record<string, unknown> | null }>();
  if (!analise?.conteudo) return vazio;

  const riscosBrutos = analise.conteudo["riscos"];
  const riscos = Array.isArray(riscosBrutos)
    ? riscosBrutos
        .map((r) => (r && typeof r === "object" ? limpar((r as Record<string, unknown>)["texto"]) : null))
        .filter((t): t is string => t !== null)
    : [];
  return { riscos, resumoExecutivo: limpar(analise.conteudo["resumo_executivo"]) };
}

export async function buscarSinaisMaterial(supabaseAdmin: SupabaseClient, jornadaId: string): Promise<SinaisMaterial> {
  // 1) ligacoes_estrategicas.preocupacao_principal (POP 03) — a mais recente,
  // mesmo critério de desempate de `contexto-briefing.ts` (pode haver remarcação).
  const { data: ligacao } = await supabaseAdmin
    .from("ligacoes_estrategicas")
    .select("preocupacao_principal")
    .eq("jornada_id", jornadaId)
    .order("realizada_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ preocupacao_principal: string | null }>();

  // 2) formularios_respostas.respostas->>'p16' (POP 02).
  const { data: formulario } = await supabaseAdmin
    .from("formularios_respostas")
    .select("respostas")
    .eq("jornada_id", jornadaId)
    .maybeSingle<{ respostas: Record<string, unknown> | null }>();

  // 3) relatorios_sessao (via sessoes_viabilidade, 1:1 com a jornada) — também
  // é a fonte da conclusão da sessão, por isso é lido uma vez só.
  const [relatorio, arquetipo, analise] = await Promise.all([
    buscarRelatorio(supabaseAdmin, jornadaId),
    buscarArquetipo(supabaseAdmin, jornadaId),
    buscarAnaliseCroqui(supabaseAdmin, jornadaId),
  ]);

  let dorPrincipal: string | null = null;
  let fonteDor: FonteDorMaterial = "nenhuma";
  const dorLigacao = limpar(ligacao?.preocupacao_principal);
  const dorFormulario = limpar(formulario?.respostas?.["p16"]);
  const dorRelatorio = limpar(relatorio?.preocupacao_predominante);
  if (dorLigacao) {
    dorPrincipal = dorLigacao;
    fonteDor = "ligacao";
  } else if (dorFormulario) {
    dorPrincipal = dorFormulario;
    fonteDor = "formulario";
  } else if (dorRelatorio) {
    dorPrincipal = dorRelatorio;
    fonteDor = "relatorio";
  }

  const conclusao: ConclusaoSessao = {};
  const resultado = limpar(relatorio?.resultado_sessao);
  const consideracoes = limpar(relatorio?.consideracoes_apresentacao_croqui);
  if (resultado) conclusao.resultado_sessao = resultado;
  if (consideracoes) conclusao.consideracoes_apresentacao_croqui = consideracoes;
  if (analise.resumoExecutivo) conclusao.resumo_executivo = analise.resumoExecutivo;

  return {
    dorPrincipal,
    fonteDor,
    arquetipo,
    preocupacaoPredominante: dorRelatorio,
    riscos: analise.riscos,
    conclusaoSessao: Object.keys(conclusao).length > 0 ? conclusao : undefined,
  };
}

interface LinhaModelo {
  id: string;
  chave: string;
  conteudo: unknown;
  dores: string[] | null;
  arquetipos: string[] | null;
  prioridade: number | null;
  origem_dado: "real" | "exemplo" | null;
}

/** Só modelos ATIVOS entram na escolha — rascunho (`ativo=false`) espera a revisão da advogada. */
export async function buscarModelosAtivos(
  supabaseAdmin: SupabaseClient,
  validarConteudo: (conteudo: unknown) => ModeloMaterialCatalogo["conteudo"],
): Promise<ModeloMaterialCatalogo[]> {
  const { data, error } = await supabaseAdmin
    .from("materiais_modelos")
    .select("id, chave, conteudo, dores, arquetipos, prioridade, origem_dado")
    .eq("ativo", true);
  if (error) throw new Error(`falha_ao_ler_modelos_de_material: ${error.message}`);

  return ((data ?? []) as LinhaModelo[]).map((linha) => ({
    id: linha.id,
    chave: linha.chave,
    conteudo: validarConteudo(linha.conteudo),
    dores: linha.dores ?? [],
    arquetipos: linha.arquetipos ?? [],
    prioridade: linha.prioridade ?? 100,
    origem_dado: linha.origem_dado ?? "real",
  }));
}
