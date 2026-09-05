import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { CroquiNarrativaSchema, CHAVE_PROMPT_NARRATIVA, type CroquiNarrativa } from "@/server/ia/schema-croqui-narrativa";
import { montarContextoNarrativa, contextoComoTexto } from "./contexto-narrativa";
import { temConsentimento } from "@/server/ia/consentimento";
import { erroConsentimentoAusente, erroServicoIndisponivel, ErroIa } from "@/server/ia/erros";
import { resolverModoIa } from "@/server/ia/demonstracao";
import { executarComAuditoria } from "@/server/ia/executar";
import { registrarErro } from "@/server/erros";

/**
 * Agente do Croqui **v3 — narrativa** (ARQUITETURA-FASE-5.md §6.1): o
 * consumidor que faltava.
 *
 * O que a Fase 5 tinha: o motor determinístico (`croqui_calculos`), o contexto
 * (`contexto-narrativa.ts`), o contrato de saída (`schema-croqui-narrativa.ts`)
 * e o prompt versionado (0066, **inativo**). O que não tinha: ninguém que
 * chamasse nada disso — a IA do croqui em produção continuava sendo a v1, que
 * CALCULA. Este módulo fecha o circuito sem ativar nada:
 *
 * - **Fail-closed por prompt.** Se `agente_croqui_narrativa` não estiver
 *   `ativo` em `prompts_versoes`, responde **409 `narrativa_inativa`** com uma
 *   frase que diz o que fazer ("ative após a bancada"). Não cai na v1, não
 *   inventa texto, não gasta token. Ativar vira um `UPDATE`, sem deploy.
 * - **Fail-closed por cálculo.** Sem versão de cálculo gravada
 *   (`croqui_calculos.atual`), 409 `croqui_calculo_ausente`: narrar tabela que
 *   ninguém fixou produziria uma nota de apresentador sobre números que a
 *   família nunca vai ver.
 * - **Fail-closed por consentimento.** Mesmo recorte da análise v1
 *   (`croqui-analise.ts`): as 19 tabelas SÃO o patrimônio da família. Sem
 *   `tratamento_ia`, 409 `consentimento_ausente`.
 * - **Sem modo demonstração.** A v1 tem exemplo fixo; a narrativa não tem, e
 *   inventar um seria pôr prosa plausível sobre um croqui real. Sem IA
 *   configurada → 503 rotulado.
 *
 * Cooldown, teto diário por usuário, `execucoes_ia`, tokens, custo e
 * `request_id` vêm de `executarComAuditoria` — as mesmas travas de todas as
 * outras chamadas, sem caminho paralelo.
 */

/** Teto de saída. A narrativa é nota de apresentador, não relatório: ~19 notas
 * curtas + 9 critérios + perguntas/objeções. Metade do teto da análise v1
 * (16k), que ainda carregava as tabelas inteiras na resposta. */
const MAX_TOKENS_NARRATIVA = 8000;

export interface NarrativaGravada {
  id: string;
  croqui_id: string;
  versao: number;
  conteudo: CroquiNarrativa;
  grau_confianca: number | null;
  schema_versao: number;
  origem_dado: string;
  criado_em: string;
}

export interface ResultadoNarrativaCroqui {
  execucaoId: string;
  narrativaId: string;
  narrativa: CroquiNarrativa;
  custoUsd: number | null;
}

/** 409 rotulado — o prompt existe (0066) mas ainda não passou pela bancada. */
export function erroNarrativaInativa(): ErroIa {
  return new ErroIa(
    "A narrativa do croqui ainda não está liberada — ative o agente após a bancada.",
    409,
    "narrativa_inativa",
  );
}

/** 409 rotulado — não há versão de cálculo fixada para narrar. Interno: quem
 * chama a geração recebe o `ErroIa` já lançado por `lerResultadoAtual`. */
function erroCroquiCalculoAusente(): ErroIa {
  return new ErroIa(
    "Nenhuma versão do cálculo foi fixada para este croqui — fixe uma versão antes de gerar a narrativa.",
    409,
    "croqui_calculo_ausente",
  );
}

/**
 * O prompt está ativo? Consulta única, ANTES de qualquer trabalho.
 *
 * `executarComAuditoria` já levantaria 404 `prompt_ativo_nao_encontrado` no
 * mesmo caso — mas depois de montar contexto (2 consultas de PII) e com uma
 * mensagem que não diz o que fazer. Aqui o 409 chega primeiro e é acionável.
 */
export async function narrativaAtiva(supabaseAdmin: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id")
    .eq("chave", CHAVE_PROMPT_NARRATIVA)
    .eq("ativo", true)
    .maybeSingle<{ id: string }>();

  if (error) {
    registrarErro("server/croqui/narrativa.narrativaAtiva", error);
    throw error;
  }
  return data !== null;
}

/**
 * A narrativa atual do croqui, ou `null`. Lê com o cliente da SESSÃO — a RLS
 * `cn_sel` (0070, `ve_patrimonio`) é quem decide, não o gate de rota sozinho.
 */
export async function lerNarrativaAtual(
  supabase: SupabaseClient,
  croquiId: string,
): Promise<NarrativaGravada | null> {
  const { data, error } = await supabase
    .from("croqui_narrativas")
    .select("id, croqui_id, versao, conteudo, grau_confianca, schema_versao, origem_dado, criado_em")
    .eq("croqui_id", croquiId)
    .eq("atual", true)
    .maybeSingle<NarrativaGravada>();

  if (error) {
    // Banco ainda sem a 0070: a tabela não existe. A tela mostra "sem
    // narrativa" em vez de derrubar a aba inteira do croqui.
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    registrarErro("server/croqui/narrativa.lerNarrativaAtual", error, { croqui_id: croquiId });
    throw error;
  }
  return data ?? null;
}

/** Cálculo atual da jornada — a fonte dos números que a narrativa vai conduzir. */
async function lerResultadoAtual(supabase: SupabaseClient, jornadaId: string): Promise<ResultadoCroqui> {
  const { data, error } = await supabase
    .from("croqui_calculos")
    .select("resultado")
    .eq("jornada_id", jornadaId)
    .eq("atual", true)
    .maybeSingle<{ resultado: ResultadoCroqui }>();

  if (error) {
    registrarErro("server/croqui/narrativa.lerResultadoAtual", error, { jornada_id: jornadaId });
    throw error;
  }
  if (!data?.resultado) throw erroCroquiCalculoAusente();
  return data.resultado;
}

/**
 * Contexto humano da sessão. Opcional por desenho: o prompt manda dizer que
 * não há evidência em vez de inventar. Uma onda só (`Promise.all`), e falha de
 * qualquer um dos dois vira `null` — o briefing não é pré-requisito da
 * narrativa, e derrubar a geração por causa dele seria trocar uma narrativa
 * boa por um 500.
 *
 * O recorte é o MESMO que a análise v1 já manda ao provedor
 * (`server/ia/contexto-croqui.ts:104-123`), sob o mesmo consentimento e para o
 * mesmo destinatário — nenhuma categoria de dado nova sai daqui.
 */
async function lerContextoHumano(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
): Promise<{ briefing: Record<string, unknown> | null; relatorio: Record<string, unknown> | null }> {
  const [briefingRes, sessaoRes] = await Promise.all([
    supabaseAdmin
      .from("briefings")
      .select("conteudo")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle<{ conteudo: Record<string, unknown> }>(),
    supabaseAdmin
      .from("sessoes_viabilidade")
      .select("id, relatorios_sessao(*)")
      .eq("jornada_id", jornadaId)
      .maybeSingle<{ relatorios_sessao?: Record<string, unknown> | Record<string, unknown>[] }>(),
  ]);

  const bruto = sessaoRes.data?.relatorios_sessao;
  const relatorio = Array.isArray(bruto) ? (bruto[0] ?? null) : (bruto ?? null);

  return { briefing: briefingRes.data?.conteudo ?? null, relatorio };
}

/**
 * Gera e grava a narrativa. Ordem fixa, do mais barato ao mais caro — nenhuma
 * consulta de PII acontece antes de as três travas passarem.
 */
export async function gerarNarrativaCroqui(
  supabaseAdmin: SupabaseClient,
  params: { croquiId: string; jornadaId: string; pessoaId: string; criadoPor: string },
): Promise<ResultadoNarrativaCroqui> {
  const { croquiId, jornadaId, pessoaId, criadoPor } = params;

  // Ordem deliberada: o estado de PRODUTO vem antes do estado de AMBIENTE.
  // Com o prompt inativo, a resposta certa é sempre "ative após a bancada" —
  // mesmo numa instalação sem chave de IA. O contrário mandaria a advogada
  // procurar variável de ambiente para um botão que ainda não foi liberado.
  if (!(await narrativaAtiva(supabaseAdmin))) throw erroNarrativaInativa();

  if (resolverModoIa() !== "real") {
    throw erroServicoIndisponivel(
      "IA não configurada — a narrativa do croqui não tem modo demonstração e não é gerada sem provedor.",
    );
  }

  const consentiu = await temConsentimento(supabaseAdmin, pessoaId, "tratamento_ia");
  if (!consentiu) {
    throw erroConsentimentoAusente(
      "Consentimento de tratamento por IA não registrado para esta pessoa — a narrativa do croqui não pode rodar sem ele.",
    );
  }

  const resultado = await lerResultadoAtual(supabaseAdmin, jornadaId);
  const { briefing, relatorio } = await lerContextoHumano(supabaseAdmin, jornadaId);

  const contexto = montarContextoNarrativa(resultado, {
    briefing,
    relatorio_sessao: relatorio,
  });

  // Texto, não JSON: `contextoComoTexto` renderiza as tabelas em pipe (~40%
  // menos token que o mesmo dado em objeto) e é o formato que o prompt da 0066
  // descreve. `executarComAuditoria` serializa `entrada` com JSON.stringify —
  // por isso o que vai é uma STRING já montada, não o objeto.
  const { execucaoId, saida: narrativa, custoUsd } = await executarComAuditoria<CroquiNarrativa>(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT_NARRATIVA,
    jornadaId,
    criadoPor,
    entrada: contextoComoTexto(contexto),
    prefixoUsuario:
      "Tabelas do croqui já calculadas pelo motor determinístico, com o que falta cadastrar e o que está em " +
      "divergência. Não recalcule nada; escreva só a condução:",
    schema: CroquiNarrativaSchema,
    nomeSchema: CHAVE_PROMPT_NARRATIVA,
    maxTokens: MAX_TOKENS_NARRATIVA,
  });

  const { data: gravada, error } = await supabaseAdmin
    .rpc("registrar_croqui_narrativa", {
      p_croqui_id: croquiId,
      p_execucao_id: execucaoId,
      p_conteudo: narrativa,
      p_grau_confianca: narrativa.grau_confianca,
      p_schema_versao: 3,
      p_criado_por: criadoPor,
    })
    .single<{ id: string }>();

  if (error || !gravada) {
    registrarErro("server/croqui/narrativa.gerarNarrativaCroqui#gravar", error, {
      croqui_id: croquiId,
      execucao_id: execucaoId,
    });
    // Banco sem a 0070: a RPC não existe. A execução já rodou e está em
    // `execucoes_ia` — dizer 503 rotulado é honesto; 500 genérico esconderia
    // que o que falta é migration, não código.
    if (error?.code === "PGRST202" || error?.code === "42883" || error?.code === "42P01") {
      throw erroServicoIndisponivel("Gravar a narrativa do croqui exige a migration 0070 — indisponível agora.");
    }
    if (error?.code === "42501" || error?.code === "22004") {
      throw new ErroIa("Só admin ou advogada ativa grava a narrativa do croqui.", 409, "sem_permissao");
    }
    throw error ?? new Error("falha_ao_gravar_narrativa");
  }

  return { execucaoId, narrativaId: gravada.id, narrativa, custoUsd };
}
