import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { montarContextoAnaliseCroqui } from "./contexto-croqui";
import { CroquiAnaliseSchema, type CroquiAnalise } from "./schema-croqui-analise";
import { CroquiAnaliseV2Schema, type CroquiAnaliseV2 } from "@/server/croqui/schema-analise-v2";
import { temConsentimento } from "./consentimento";
import { erroServicoIndisponivel, erroConsentimentoAusente } from "./erros";
import { resolverModoIa, gerarAnaliseCroquiDemonstracao } from "./demonstracao";
import { executarComAuditoria } from "./executar";

const CHAVE_PROMPT = "agente_croqui_analise";

/** Saída da Agente do Croqui em qualquer versão de schema — `schemaVersao` diz qual. */
export type AnaliseCroquiQualquerVersao = CroquiAnalise | CroquiAnaliseV2;

export interface ResultadoAnaliseCroqui {
  execucaoId: string;
  analiseId: string;
  analise: AnaliseCroquiQualquerVersao;
  /** 1 = `CroquiAnaliseSchema` (croqui: string[]); 2 = `CroquiAnaliseV2Schema` (13 slides tipados + alocacao + valor_declarado). */
  schemaVersao: 1 | 2;
  custoUsd: number | null;
}

/**
 * Bi-versão (ARQUITETURA-FASE-4.md §4.4): a versão ATIVA de `prompts_versoes`
 * para `agente_croqui_analise` decide o contrato de saída. v1 (hoje ativa)
 * continua produzindo `CroquiAnaliseSchema`; a v2 (0059, nasce `ativo=false`)
 * produz `CroquiAnaliseV2Schema` e é gravada com `p_schema_versao := 2`, que
 * é o que liga `gerarSlidesDaAnalise()` e os gráficos de alocação sem nova
 * migration. A v1 nunca é apagada — é o rollback (`UPDATE ativo`).
 */
export function schemaVersaoDoPrompt(versaoPrompt: number): 1 | 2 {
  return versaoPrompt >= 2 ? 2 : 1;
}

function schemaCroquiParaVersao(versaoPrompt: number): z.ZodType<AnaliseCroquiQualquerVersao> {
  return schemaVersaoDoPrompt(versaoPrompt) === 2 ? CroquiAnaliseV2Schema : CroquiAnaliseSchema;
}

/**
 * Orquestra a análise do Agente do Croqui: recebe a transcrição da SV (no corpo
 * da requisição, nunca persistida além do necessário) + dados de ficha já
 * registrados, e devolve as seções carimbadas por categoria. Mesmas travas
 * do briefing: sem IA configurada e sem modo demonstração ligado → 503 antes
 * de chamar; recusa/saída inválida → execução marcada `falhou`, nunca análise
 * fabricada. Com o modo demonstração ligado (`resolverModoIa`,
 * ARQUITETURA-FASE-2.md §3), devolve o exemplo fixo e marcado, ANTES de checar
 * consentimento — a demonstração não olha `pessoaId`/`transcricaoSessao` de
 * verdade, então a trava de consentimento (que existe para proteger dado real)
 * não se aplica a ela.
 *
 * ALTO 2 (pentest 03/09/2026): exige `tem_consentimento(pessoa,'tratamento_ia')`
 * ANTES de montar contexto ou registrar execução — nome completo, familiares,
 * valor real de patrimônio e a transcrição bruta da SV não podem sair para a
 * Anthropic sem esse consentimento. Diferente do Briefing (§4.4), aqui NÃO
 * existe modo reduzido: recusa com 409 `consentimento_ausente`.
 */
export async function gerarAnaliseCroqui(
  supabaseAdmin: SupabaseClient,
  params: { croquiId: string; jornadaId: string; pessoaId: string; transcricaoSessao: string; criadoPor: string | null },
): Promise<ResultadoAnaliseCroqui> {
  const { croquiId, jornadaId, pessoaId, transcricaoSessao, criadoPor } = params;

  const modoIa = resolverModoIa();
  if (modoIa === "indisponivel") {
    throw erroServicoIndisponivel("IA não configurada — análise do croqui indisponível");
  }
  if (modoIa === "demonstracao") {
    const demo = await gerarAnaliseCroquiDemonstracao(supabaseAdmin, { croquiId, jornadaId, criadoPor });
    return { ...demo, schemaVersao: 1 };
  }

  const consentiu = await temConsentimento(supabaseAdmin, pessoaId, "tratamento_ia");
  if (!consentiu) {
    throw erroConsentimentoAusente(
      "Consentimento de tratamento por IA não registrado para esta pessoa — a Agente do Croqui não pode rodar sem ele.",
    );
  }

  const contexto = await montarContextoAnaliseCroqui(supabaseAdmin, { jornadaId, pessoaId, transcricaoSessao });

  const { execucaoId, saida: analise, custoUsd, promptVersao } = await executarComAuditoria(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT,
    jornadaId,
    criadoPor,
    entrada: contexto,
    prefixoUsuario:
      "Transcrição da Sessão de Viabilidade e dados de ficha já registrados (JSON). " +
      "`cenario` traz só totais digitados pela advogada (ou null) — nunca calcule imposto nem invente alíquota:",
    schema: schemaCroquiParaVersao,
    nomeSchema: "agente_croqui_analise",
    maxTokens: 16000,
  });

  const schemaVersao = schemaVersaoDoPrompt(promptVersao);

  const { data: analiseGravada, error: erroAnalise } = await supabaseAdmin
    .rpc("registrar_croqui_analise", {
      p_croqui_id: croquiId,
      p_execucao_id: execucaoId,
      p_conteudo: analise,
      p_grau_confianca: analise.grau_confianca,
      p_schema_versao: schemaVersao,
    })
    .single<{ id: string }>();

  if (erroAnalise || !analiseGravada) {
    throw new Error(`falha_ao_gravar_analise: ${erroAnalise?.message}`);
  }

  return { execucaoId, analiseId: analiseGravada.id, analise, schemaVersao, custoUsd };
}
