import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { erroConflito, erroNaoEncontrado, registrarErro } from "@/server/erros";
import { montarFicha360 } from "@/server/jornadas";
import { listarCenario } from "@/server/cenario";
import type { CroquiAnalise } from "@/server/ia/schema-croqui-analise";
import type { CroquiAnaliseV2 } from "@/server/croqui/schema-analise-v2";
import type {
  BlocoDiagnostico,
  DiagnosticoSv,
  DiagnosticoSvResumo,
  RespostaDiagnosticoJornada,
  TipoCenario,
} from "@/types/cenario";
import { montarDiagnostico, type EntradaDiagnostico } from "./montar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
type Cliente = SupabaseClient<any, any, any>;

const CategoriaSchema = z.enum(["fato_declarado", "dado_documental", "inferencia", "ponto_a_validar"]);
const ChaveBlocoSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

/** Corpo de `PATCH /api/jornadas/[id]/diagnostico`. */
export const CorpoEditarDiagnosticoSchema = z
  .object({
    blocos: z
      .array(
        z.object({
          chave: ChaveBlocoSchema,
          titulo: z.string().trim().min(1).max(200).optional(),
          conteudo: z.string().trim().max(4000).optional(),
          pontos: z.array(z.string().trim().max(400)).max(40).optional(),
          fontes: z.array(z.string().trim().max(200)).max(20).optional(),
          categoria: CategoriaSchema.optional(),
          visivel_ao_cliente: z.boolean().optional(),
        }),
      )
      .max(20)
      .optional(),
    visibilidade: z.record(ChaveBlocoSchema, z.boolean()).optional(),
    aprovar: z.boolean().optional(),
  })
  .refine((c) => c.blocos || c.visibilidade || c.aprovar, { message: "Nada a editar." });
export type CorpoEditarDiagnosticoValidado = z.infer<typeof CorpoEditarDiagnosticoSchema>;

const COLUNAS_RESUMO =
  "id, jornada_id, versao, analise_id, atual, aprovado_por, aprovado_em, criado_em, atualizado_em, criado_por, atualizado_por";

export async function listarDiagnostico(supabase: Cliente, jornadaId: string): Promise<RespostaDiagnosticoJornada> {
  const [atualRes, histRes] = await Promise.all([
    supabase.from("diagnosticos_sv").select("*").eq("jornada_id", jornadaId).eq("atual", true).maybeSingle(),
    supabase.from("diagnosticos_sv").select(COLUNAS_RESUMO).eq("jornada_id", jornadaId).order("versao", { ascending: false }),
  ]);
  if (atualRes.error) {
    registrarErro("server/diagnostico.listarDiagnostico", atualRes.error, { jornada_id: jornadaId });
    throw atualRes.error;
  }
  if (histRes.error) throw histRes.error;
  return {
    atual: (atualRes.data as DiagnosticoSv | null) ?? null,
    historico: (histRes.data as DiagnosticoSvResumo[] | null) ?? [],
  };
}

interface AnaliseAtualLinha {
  id: string;
  schema_versao: number;
  conteudo: CroquiAnalise | CroquiAnaliseV2;
  croquis: { jornada_id: string; versao: number };
}

/** Análise atual do Agente do Croqui da jornada (do croqui de maior versão
 * que tenha análise atual — no máximo uma linha por croqui, `uniq_croqui_analise_atual`).
 * `null` quando não há — o diagnóstico nasce sem esse bloco, não com texto inventado. */
async function analiseAtual(supabase: Cliente, jornadaId: string): Promise<AnaliseAtualLinha | null> {
  const { data, error } = await supabase
    .from("croqui_analises")
    .select("id, schema_versao, conteudo, croquis!inner(jornada_id, versao)")
    .eq("croquis.jornada_id", jornadaId)
    .eq("atual", true)
    .limit(20);
  if (error) {
    registrarErro("server/diagnostico.analiseAtual", error, { jornada_id: jornadaId });
    throw error;
  }
  // supabase-js tipa a embed `croquis!inner(...)` como array; com `!inner` em
  // FK many-to-one vem um objeto — a forma real é `AnaliseAtualLinha`.
  const linhas = ((data as unknown) as AnaliseAtualLinha[] | null) ?? [];
  return linhas.reduce<AnaliseAtualLinha | null>(
    (melhor, atual) => (!melhor || atual.croquis.versao > melhor.croquis.versao ? atual : melhor),
    null,
  );
}

/** Monta (função pura) e registra versão nova via `registrar_diagnostico_sv`. */
export async function gerarDiagnostico(supabase: Cliente, jornadaId: string): Promise<DiagnosticoSv> {
  const [ficha, cenario, analise] = await Promise.all([
    montarFicha360(supabase, jornadaId, true),
    listarCenario(supabase, jornadaId),
    analiseAtual(supabase, jornadaId),
  ]);

  const cenarioIdPorTipo: Record<string, TipoCenario> = {};
  for (const c of cenario.cenarios) cenarioIdPorTipo[c.id] = c.cenario;

  const entrada: EntradaDiagnostico = {
    pessoa: ficha.pessoa,
    familiares: ficha.familiares,
    patrimonio: ficha.patrimonio,
    relatorio: ficha.relatorio,
    analise: analise ? { id: analise.id, schema_versao: analise.schema_versao, conteudo: analise.conteudo } : null,
    cenarios: { totais: cenario.totais, rubricas: cenario.rubricas, cenarioIdPorTipo },
    parametros: cenario.parametros,
  };
  const blocos = montarDiagnostico(entrada);

  const { data, error } = await supabase
    .rpc("registrar_diagnostico_sv", { p_jornada_id: jornadaId, p_analise_id: analise?.id ?? null, p_blocos: blocos })
    .single<DiagnosticoSv>();
  if (error) {
    const msg = (error as { message: string }).message;
    if (msg.startsWith("sem_permissao")) throw erroConflito("sem_permissao", "Só admin/advogada monta o diagnóstico.");
    if (msg.startsWith("jornada_nao_encontrada")) throw erroNaoEncontrado("Jornada não encontrada.");
    registrarErro("server/diagnostico.gerarDiagnostico", error, { jornada_id: jornadaId });
    throw error;
  }
  return data;
}

/** Edita a versão ATUAL: texto/pontos/visibilidade por chave e/ou aprovação.
 * Nunca cria versão; nunca toca versão antiga (trigger recusa). */
export async function editarDiagnostico(
  supabase: Cliente,
  jornadaId: string,
  usuarioId: string,
  corpo: CorpoEditarDiagnosticoValidado,
): Promise<DiagnosticoSv> {
  const { atual } = await listarDiagnostico(supabase, jornadaId);
  if (!atual) throw erroNaoEncontrado("Esta jornada ainda não tem diagnóstico — monte um primeiro.");

  const porChave = new Map<string, BlocoDiagnostico>(atual.blocos.map((b) => [b.chave, { ...b }]));

  for (const edicao of corpo.blocos ?? []) {
    const { chave, ...campos } = edicao;
    const alvo = porChave.get(chave);
    if (!alvo) throw erroConflito("bloco_desconhecido", `Bloco '${chave}' não existe neste diagnóstico.`, { chave });
    Object.assign(alvo, campos);
  }
  for (const [chave, visivel] of Object.entries(corpo.visibilidade ?? {})) {
    const alvo = porChave.get(chave);
    if (!alvo) throw erroConflito("bloco_desconhecido", `Bloco '${chave}' não existe neste diagnóstico.`, { chave });
    alvo.visivel_ao_cliente = visivel;
  }
  const oQueFalta = porChave.get("o_que_falta");
  if (oQueFalta?.visivel_ao_cliente) {
    throw erroConflito("bloco_interno", "O bloco 'O que falta' é interno e nunca fica visível ao cliente (B31).");
  }

  const patch: Record<string, unknown> = { blocos: Array.from(porChave.values()), atualizado_por: usuarioId };
  if (corpo.aprovar) {
    patch.aprovado_por = usuarioId;
    patch.aprovado_em = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("diagnosticos_sv")
    .update(patch)
    .eq("id", atual.id)
    .eq("atual", true)
    .select("*")
    .single<DiagnosticoSv>();
  if (error) {
    const pg = error as { code?: string; message: string };
    if (pg.code === "23514") {
      throw erroConflito("diagnostico_invalido", pg.message.split(":")[0] ?? "Diagnóstico recusado pelo banco.");
    }
    registrarErro("server/diagnostico.editarDiagnostico", error, { jornada_id: jornadaId, diagnostico_id: atual.id });
    throw error;
  }
  return data;
}
