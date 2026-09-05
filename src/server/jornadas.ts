import type { SupabaseClient } from "@supabase/supabase-js";
import { erroConflito, erroNaoEncontrado, registrarErro } from "./erros";
import type {
  AgendamentoSessao,
  BriefingResumo,
  DocumentoMetadado,
  EtapaJornada,
  EventoTimeline,
  Familiar,
  FormularioResposta,
  Jornada,
  LigacaoEstrategica,
  LigacaoIaResumo,
  PatrimonioItem,
  Pessoa,
  RelatorioSessao,
  SessaoViabilidade,
  Tarefa,
} from "@/types/banco";
import type { MaterialGeradoResumo } from "@/types/material";
import type { CenarioPatrimonial, CenarioRubrica, CenarioTotais, DiagnosticoSv } from "@/types/cenario";

/**
 * Espelha `etapas_jornada_ordem` e `transicoes_permitidas` (migration 0004).
 * É intencionalmente uma CÓPIA, não a fonte da verdade — o banco é a fonte da
 * verdade (trigger `app.valida_transicao_jornada`). Esta cópia existe só para
 * a rota poder devolver 409 com motivo legível ANTES de bater no banco; se o
 * banco recusar por qualquer razão que esta cópia não previu, a rota trata o
 * erro do Postgres do mesmo jeito (ver `traduzErroTransicaoPostgres`).
 */
export const ORDEM_ETAPAS: Record<EtapaJornada, number> = {
  captado: 10,
  qualificado: 20,
  sessao_contratada: 30,
  sessao_agendada: 40,
  sessao_realizada: 50,
  croqui_contratado: 60,
  croqui_apresentado: 70,
  holding_contratada: 80,
};

export const ROTULO_ETAPAS: Record<EtapaJornada, string> = {
  captado: "Captado",
  qualificado: "Qualificado (MQL)",
  sessao_contratada: "Sessão paga",
  sessao_agendada: "Sessão agendada",
  sessao_realizada: "Sessão realizada",
  croqui_contratado: "Croqui pago",
  croqui_apresentado: "Croqui apresentado",
  holding_contratada: "Holding contratada",
};

const TRANSICOES_PERMITIDAS: Record<EtapaJornada, EtapaJornada[]> = {
  captado: ["qualificado", "sessao_contratada"],
  qualificado: ["sessao_contratada"],
  sessao_contratada: ["sessao_agendada"],
  sessao_agendada: ["sessao_realizada"],
  sessao_realizada: ["croqui_contratado"],
  croqui_contratado: ["croqui_apresentado"],
  croqui_apresentado: ["holding_contratada"],
  holding_contratada: [],
};

/** nivel_pago 1/2/3 trava a etapa mínima em 30/60/80 (ver trigger da máquina de estados). */
const PISO_POR_NIVEL_PAGO: Record<number, number> = { 0: 0, 1: 30, 2: 60, 3: 80 };

export type ResultadoValidacaoTransicao = { valida: true } | { valida: false; motivo: string };

/**
 * Validação de servidor da transição de etapa — roda ANTES do UPDATE no banco,
 * só para devolver um 409 com mensagem legível. O banco (trigger) é a segunda
 * trava e a que realmente importa; esta função nunca deve ser a única guarda.
 */
export function validarTransicaoEtapa(params: {
  etapaAtual: EtapaJornada;
  etapaNova: EtapaJornada;
  nivelPago: number;
}): ResultadoValidacaoTransicao {
  const { etapaAtual, etapaNova, nivelPago } = params;

  if (etapaAtual === etapaNova) {
    return { valida: true }; // PATCH pode estar só mudando desfecho/responsável
  }

  const ordemAtual = ORDEM_ETAPAS[etapaAtual];
  const ordemNova = ORDEM_ETAPAS[etapaNova];

  if (ordemNova < ordemAtual) {
    return {
      valida: false,
      motivo: `Etapa não regride: "${ROTULO_ETAPAS[etapaAtual]}" → "${ROTULO_ETAPAS[etapaNova]}".`,
    };
  }

  if (!TRANSICOES_PERMITIDAS[etapaAtual].includes(etapaNova)) {
    return {
      valida: false,
      motivo: `Transição não permitida: "${ROTULO_ETAPAS[etapaAtual]}" → "${ROTULO_ETAPAS[etapaNova]}".`,
    };
  }

  const piso = PISO_POR_NIVEL_PAGO[nivelPago] ?? 0;
  if (ordemNova < piso) {
    return {
      valida: false,
      motivo: `Etapa não pode ficar abaixo do nível já pago (nível ${nivelPago} trava em "${
        ROTULO_ETAPAS[
          (Object.keys(ORDEM_ETAPAS) as EtapaJornada[]).find((e) => ORDEM_ETAPAS[e] === piso) ??
            etapaAtual
        ]
      }").`,
    };
  }

  return { valida: true };
}

/** `desfecho <> 'aberta'` sempre exige motivo (mesma regra do `ck_desfecho_motivo`). */
export function validarMotivoDesfecho(params: {
  desfechoNovo: string;
  motivo?: string | null;
}): ResultadoValidacaoTransicao {
  if (params.desfechoNovo !== "aberta" && !params.motivo?.trim()) {
    return { valida: false, motivo: "Motivo é obrigatório para encerrar a jornada com este desfecho." };
  }
  return { valida: true };
}

/**
 * Traduz um erro vindo do Postgres (trigger `app.valida_transicao_jornada`) para
 * o formato de conflito da API. Cai aqui quando a validação de servidor deixou
 * passar algo que o banco recusou (corrida entre duas requisições, por exemplo).
 */
export function traduzErroTransicaoPostgres(mensagem: string): string {
  if (mensagem.includes("etapa nao regride")) {
    return "Etapa não pode regredir.";
  }
  if (mensagem.includes("abaixo do nivel pago")) {
    return "Etapa não pode ficar abaixo do nível já pago.";
  }
  if (mensagem.includes("transicao_invalida")) {
    return "Transição de etapa não permitida.";
  }
  return "Transição de etapa recusada pelo banco.";
}

// ---------------------------------------------------------------------------
// Ficha 360
// ---------------------------------------------------------------------------

export interface Ficha360 {
  jornada: Jornada;
  pessoa: Pessoa;
  formulario: FormularioResposta | null;
  ligacao: LigacaoEstrategica | null;
  briefingAtual: BriefingResumo | null;
  sessao: SessaoViabilidade | null;
  relatorio: RelatorioSessao | null;
  agendamentos: AgendamentoSessao[];
  documentos: DocumentoMetadado[];
  timeline: EventoTimeline[];
  /** Só populado quando `podeVerPatrimonio` é true. */
  patrimonio: PatrimonioItem[] | null;
  familiares: Familiar[] | null;
  /**
   * Material pós-sessão atual da jornada, sem o `conteudo` (payload leve —
   * quem precisa do conteúdo completo busca via `GET
   * /api/jornadas/[id]/material`, como `MaterialAba.tsx` já faz). `null`
   * quando a jornada nunca gerou material. Trazido para `derivarPasta()`
   * (`src/lib/pasta/derivar.ts`) não precisar de fetch lazy — Fase 1 da
   * "Pasta do Cliente", Diário 2026-09-04.
   */
  materialAtual: Omit<MaterialGeradoResumo, "chave_modelo"> | null;
  // --- Fase 4 (Onda 1). Tabelas de outros agentes podem não existir ainda no
  // banco: cada campo abaixo é carregado de forma TOLERANTE — tabela ausente
  // vira `null`/`[]`, nunca derruba a ficha. ---
  /** `diagnosticos_sv` atual (0058, agente D) — mesma forma de `GET /api/jornadas/[id]/diagnostico`.atual. Só com `podeVerPatrimonio`. */
  diagnosticoAtual: DiagnosticoSv | null;
  /** Cenário Patrimonial (0057, agente D) — mesma forma de `GET /api/jornadas/[id]/cenario` (sem `rubricas_padrao`/`parametros`). `null` = sem permissão ou tabela ausente. */
  cenarios: CenariosDaFicha | null;
  /** Última `ligacoes_ia` da jornada (0053, agente B), sem transcrição. */
  ligacaoIaAtual: LigacaoIaResumo | null;
  /** `tarefas` abertas (0027 + `tipo` 0051) — ex.: 'enviar_link_croqui' para a aba Sessão. */
  tarefasAbertas: Tarefa[];
}

export interface CenariosDaFicha {
  cenarios: CenarioPatrimonial[];
  rubricas: CenarioRubrica[];
  totais: CenarioTotais[];
}

/** Códigos de "relação não existe" (Postgres 42P01; PostgREST sem a tabela no cache do schema). */
const CODIGOS_TABELA_AUSENTE = new Set(["42P01", "PGRST205", "PGRST200", "PGRST204"]);

/**
 * Executa uma consulta opcional: erro de tabela/coluna ausente vira o
 * `padrao` em silêncio; qualquer outro erro é registrado (nunca lançado —
 * campo secundário não derruba a Ficha 360).
 */
async function consultaTolerante<T>(
  contexto: string,
  jornadaId: string,
  consulta: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
  padrao: T,
): Promise<T> {
  try {
    const { data, error } = await consulta;
    if (error) {
      if (!CODIGOS_TABELA_AUSENTE.has(error.code ?? "")) {
        registrarErro(`server/jornadas.montarFicha360#${contexto}`, error, { jornada_id: jornadaId });
      }
      return padrao;
    }
    return data ?? padrao;
  } catch (erro) {
    registrarErro(`server/jornadas.montarFicha360#${contexto}`, erro, { jornada_id: jornadaId });
    return padrao;
  }
}

/**
 * Cenário Patrimonial (0057, agente D) na mesma forma da rota
 * `GET /api/jornadas/[id]/cenario`: cabeçalhos → rubricas (por `cenario_id`) →
 * totais (`vw_cenarios_totais`). Tolerante: tabela/view ausente vira `null`.
 */
async function carregarCenarios(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<CenariosDaFicha | null> {
  const cabecalhos = await consultaTolerante<CenarioPatrimonial[] | null>(
    "cenarios_patrimoniais",
    jornadaId,
    supabase.from("cenarios_patrimoniais").select("*").eq("jornada_id", jornadaId).order("cenario").returns<CenarioPatrimonial[]>(),
    null,
  );
  if (cabecalhos === null) return null;
  const ids = cabecalhos.map((c) => c.id);
  const [rubricas, totais] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as CenarioRubrica[])
      : consultaTolerante<CenarioRubrica[]>(
          "cenario_rubricas",
          jornadaId,
          supabase.from("cenario_rubricas").select("*").in("cenario_id", ids).order("ordem").returns<CenarioRubrica[]>(),
          [],
        ),
    consultaTolerante<CenarioTotais[]>(
      "vw_cenarios_totais",
      jornadaId,
      supabase.from("vw_cenarios_totais").select("*").eq("jornada_id", jornadaId).returns<CenarioTotais[]>(),
      [],
    ),
  ]);
  return { cenarios: cabecalhos, rubricas, totais };
}

/**
 * Monta a Ficha 360 de uma jornada. O recorte de patrimônio é feito EM CÓDIGO
 * (nunca busca a tabela se `podeVerPatrimonio` for false) — soma-se à RLS
 * (`app.ve_patrimonio()`), não substitui: mesmo que o código erre, a RLS nega.
 */
export async function montarFicha360(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
  podeVerPatrimonio: boolean,
): Promise<Ficha360> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("*")
    .eq("id", jornadaId)
    .maybeSingle();

  if (erroJornada) {
    registrarErro("server/jornadas.montarFicha360", erroJornada, { jornada_id: jornadaId });
    throw erroJornada;
  }
  if (!jornada) {
    throw erroNaoEncontrado("Jornada não encontrada.");
  }

  const jornadaTipada = jornada as Jornada;

  const { data: pessoa, error: erroPessoa } = await supabase
    .from("pessoas")
    .select("*")
    .eq("id", jornadaTipada.pessoa_id)
    .maybeSingle();
  if (erroPessoa) throw erroPessoa;
  if (!pessoa) throw erroNaoEncontrado("Pessoa da jornada não encontrada.");

  const [
    { data: formulario },
    { data: ligacao },
    { data: briefingAtual },
    { data: sessao },
    { data: documentos },
    { data: timeline },
    { data: materialAtual },
  ] = await Promise.all([
    supabase.from("formularios_respostas").select("*").eq("jornada_id", jornadaId).maybeSingle(),
    supabase
      .from("ligacoes_estrategicas")
      .select("*")
      .eq("jornada_id", jornadaId)
      .order("realizada_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("briefings").select("*").eq("jornada_id", jornadaId).eq("atual", true).maybeSingle(),
    supabase.from("sessoes_viabilidade").select("*").eq("jornada_id", jornadaId).maybeSingle(),
    supabase.from("documentos").select("id, pessoa_id, jornada_id, tipo, nome_arquivo, mime, tamanho_bytes, criado_em").eq("jornada_id", jornadaId),
    supabase
      .from("eventos_timeline")
      .select("*")
      .eq("jornada_id", jornadaId)
      .order("ocorrido_em", { ascending: false })
      .limit(100),
    // `.eq("jornada_id", id).eq("atual", true)`, nesta ordem exata, para casar
    // com o índice parcial `uniq_material_atual on materiais_gerados
    // (jornada_id) where atual` (0031_material_pos_sessao.sql) — Pasta do
    // Cliente, Fase 1 (Diário 2026-09-04). O predicado do PostgREST
    // (`jornada_id = $1 and atual = true`) casa estruturalmente com o
    // índice parcial. `explain (analyze, buffers)` NÃO foi rodado nesta
    // sessão (sem MCP do Supabase/psql disponíveis aqui, mesma limitação já
    // registrada no diário para outras migrations) — pendente antes de
    // considerar o protocolo de sustentabilidade satisfeito.
    supabase
      .from("materiais_gerados")
      .select("id, versao, fonte_dor, dor_principal, origem_dado, atual, aprovado_por, aprovado_em, criado_em")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle(),
  ]);

  let relatorio: RelatorioSessao | null = null;
  let agendamentos: AgendamentoSessao[] = [];
  if (sessao) {
    const sessaoTipada = sessao as SessaoViabilidade;
    const [{ data: relatorioData }, { data: agendamentosData }] = await Promise.all([
      supabase.from("relatorios_sessao").select("*").eq("sessao_id", sessaoTipada.id).maybeSingle(),
      supabase
        .from("agendamentos")
        .select("*")
        .eq("sessao_id", sessaoTipada.id)
        .order("inicio_em", { ascending: false }),
    ]);
    relatorio = (relatorioData as RelatorioSessao | null) ?? null;
    agendamentos = (agendamentosData as AgendamentoSessao[] | null) ?? [];
  }

  let patrimonio: PatrimonioItem[] | null = null;
  let familiares: Familiar[] | null = null;
  let diagnosticoAtual: DiagnosticoSv | null = null;
  let cenarios: CenariosDaFicha | null = null;
  if (podeVerPatrimonio) {
    const [{ data: patrimonioData }, { data: familiaresData }, diagnosticoData, cenariosData] = await Promise.all([
      supabase.from("patrimonio_itens").select("*").eq("pessoa_id", jornadaTipada.pessoa_id),
      supabase.from("familiares").select("*").eq("pessoa_id", jornadaTipada.pessoa_id),
      // `.eq("jornada_id").eq("atual")` casa com `uniq_diagnostico_atual` (0058).
      consultaTolerante<DiagnosticoSv | null>(
        "diagnosticos_sv",
        jornadaId,
        supabase.from("diagnosticos_sv").select("*").eq("jornada_id", jornadaId).eq("atual", true).maybeSingle<DiagnosticoSv>(),
        null,
      ),
      carregarCenarios(supabase, jornadaId),
    ]);
    patrimonio = (patrimonioData as PatrimonioItem[] | null) ?? [];
    familiares = (familiaresData as Familiar[] | null) ?? [];
    diagnosticoAtual = diagnosticoData;
    cenarios = cenariosData;
  }

  const [ligacaoIaAtual, tarefasAbertas] = await Promise.all([
    consultaTolerante<LigacaoIaResumo | null>(
      "ligacoes_ia",
      jornadaId,
      supabase
        .from("ligacoes_ia")
        .select("id, jornada_id, provedor, status, tentativa, resultado, horario_escolhido, agendamento_id, disparada_em, encerrada_em, resumo, erro, criado_em")
        .eq("jornada_id", jornadaId)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle<LigacaoIaResumo>(),
      null,
    ),
    consultaTolerante<Tarefa[]>(
      "tarefas",
      jornadaId,
      supabase
        .from("tarefas")
        .select("*")
        .eq("jornada_id", jornadaId)
        .is("concluida_em", null)
        .order("vence_em", { ascending: true, nullsFirst: false })
        .returns<Tarefa[]>(),
      [],
    ),
  ]);

  return {
    jornada: jornadaTipada,
    pessoa: pessoa as Pessoa,
    formulario: (formulario as FormularioResposta | null) ?? null,
    ligacao: (ligacao as LigacaoEstrategica | null) ?? null,
    briefingAtual: (briefingAtual as BriefingResumo | null) ?? null,
    sessao: (sessao as SessaoViabilidade | null) ?? null,
    relatorio,
    agendamentos,
    documentos: (documentos as DocumentoMetadado[] | null) ?? [],
    timeline: (timeline as EventoTimeline[] | null) ?? [],
    patrimonio,
    familiares,
    materialAtual: (materialAtual as Omit<MaterialGeradoResumo, "chave_modelo"> | null) ?? null,
    diagnosticoAtual,
    cenarios,
    ligacaoIaAtual,
    tarefasAbertas,
  };
}

/**
 * Resolve (ou cria) a pessoa de uma nova jornada por dedupe de e-mail/telefone.
 * Usado por `POST /api/jornadas`. Nunca cria pessoa duplicada por coincidência
 * de nome — só e-mail/telefone contam como identidade (mesma regra do índice
 * único parcial em `pessoas`).
 */
export async function resolverOuCriarPessoa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  dados: {
    nome: string;
    email?: string | null;
    telefone?: string | null;
    cidade?: string | null;
    uf?: string | null;
    profissao?: string | null;
  },
): Promise<Pessoa> {
  if (dados.email) {
    const { data: existente, error } = await supabase
      .from("pessoas")
      .select("*")
      .eq("email", dados.email.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    if (existente) return existente as Pessoa;
  }

  if (dados.telefone) {
    const { data: existente, error } = await supabase
      .from("pessoas")
      .select("*")
      .eq("telefone", dados.telefone)
      .maybeSingle();
    if (error) throw error;
    if (existente) return existente as Pessoa;
  }

  const { data: criada, error: erroCriar } = await supabase
    .from("pessoas")
    .insert({
      nome: dados.nome,
      email: dados.email?.toLowerCase() ?? null,
      telefone: dados.telefone ?? null,
      cidade: dados.cidade ?? null,
      uf: dados.uf ?? null,
      profissao: dados.profissao ?? null,
    })
    .select("*")
    .single();

  if (erroCriar) throw erroCriar;
  return criada as Pessoa;
}

/** Garante que a pessoa não tem outra jornada aberta (mesma regra do índice único parcial). */
export async function garantirSemJornadaAberta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  pessoaId: string,
) {
  const { data, error } = await supabase
    .from("jornadas")
    .select("id")
    .eq("pessoa_id", pessoaId)
    .eq("desfecho", "aberta")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    throw erroConflito(
      "jornada_aberta_existente",
      "Esta pessoa já tem uma jornada aberta. Feche a jornada atual antes de abrir outra.",
      { jornada_id: (data as { id: string }).id },
    );
  }
}
