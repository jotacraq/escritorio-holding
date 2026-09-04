import crypto from "node:crypto";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { iaConfigurada } from "./cliente";
import { BriefingSchema, type Briefing } from "./schema-briefing";
import {
  AfirmacaoSchema,
  CRITERIOS_ARQUITETURA,
  CroquiAnaliseSchema,
  type CategoriaAfirmacao,
  type CroquiAnalise,
} from "./schema-croqui-analise";
import { erroNaoEncontrado } from "./erros";
import type { ResultadoBriefing } from "./briefing";
import type { ResultadoAnaliseCroqui } from "./croqui-analise";

// `Afirmacao` não é exportado por schema-croqui-analise.ts (fora da fronteira
// deste agente — não editar esse arquivo). Deriva localmente do schema exportado.
type Afirmacao = z.infer<typeof AfirmacaoSchema>;

/**
 * Modo demonstração da IA (ARQUITETURA-FASE-2.md §3). Existe só para a vitrine
 * não nascer quebrada enquanto a IA não está configurada (BLOQUEIO B17) —
 * nunca para parecer análise real. Nenhum componente de UI importa este
 * arquivo: só as rotas de servidor (briefing.ts, croqui-analise.ts), do mesmo
 * jeito que `cliente.ts` já documenta para os adaptadores de provedor.
 */

const MARCADOR_EXEMPLO = "Cliente Exemplo da Silva Demonstração";

/** True só com o literal exato "true" — "TRUE"/"1"/etc. não ligam por acidente. */
function flagDemonstracaoLigada(): boolean {
  return process.env.IA_MODO_DEMONSTRACAO === "true";
}

export type ModoIa = "real" | "demonstracao" | "indisponivel";

/**
 * Regra de ativação (§3.1 — a ordem importa, não se negocia):
 * 1. IA configurada (provedor resolvido por `IA_PROVEDOR` tem a chave presente)
 *    → sempre "real". Demonstração é IGNORADA, mesmo com a flag ligada. Nunca
 *    demo silencioso com chave configurada.
 * 2. IA não configurada + flag ligada   → "demonstracao" (exemplo fixo, marcado).
 * 3. IA não configurada + flag ausente/false → "indisponivel" (503 honesto — o
 *    comportamento de hoje, preservado).
 */
export function resolverModoIa(): ModoIa {
  if (iaConfigurada()) return "real";
  if (flagDemonstracaoLigada()) return "demonstracao";
  return "indisponivel";
}

// ===========================================================================
// Exemplo fixo do Briefing Estratégico. Tipado por `Briefing` (mesmo tipo
// inferido do `BriefingSchema` da saída real, ver schema-briefing.ts) — se o
// schema ganhar um campo obrigatório novo e este exemplo não acompanhar,
// `npx tsc --noEmit` falha aqui, de propósito (§3.2: "garante que a tela nunca
// precisa de um caminho paralelo"). `BriefingSchema.parse` abaixo é o mesmo
// cinto e suspensório em runtime (pega o que o tipo estrutural deixaria passar,
// como enum errado ou string vazia).
// ===========================================================================
const RASCUNHO_EXEMPLO_BRIEFING: Briefing = {
  resumo_executivo:
    `EXEMPLO GERADO SEM IA. ${MARCADOR_EXEMPLO} é um personagem fictício usado só para mostrar o ` +
    "formato do Briefing Estratégico. Nenhuma informação de cliente real foi analisada nesta saída.",
  perfil_disc: {
    predominante: "D",
    secundario: "C",
    confianca: 0,
    evidencias: ["Exemplo fixo de demonstração — sem evidência real por trás desta afirmação."],
  },
  arquetipo_patrimonial: {
    escolhido: "Nenhum_se_aplica",
    justificativa: "Exemplo fixo de demonstração — não há dado real por trás desta escolha.",
    evidencias: ["Exemplo fixo de demonstração."],
  },
  o_que_protege: {
    objeto: "Exemplo fixo de demonstração",
    justificativa: "Sem dado real. Texto fixo para ilustrar o formato deste campo.",
  },
  motivadores: {
    principal: "Exemplo fixo de demonstração",
    secundarios: ["Exemplo fixo de demonstração"],
    justificativa: "Sem dado real por trás desta conclusão.",
  },
  objecoes_provaveis: [
    {
      objecao: "Exemplo fixo de objeção de demonstração",
      probabilidade: "baixa",
      justificativa: "Sem dado real por trás desta estimativa.",
    },
  ],
  processo_decisorio: {
    velocidade: "indefinida",
    necessidade_seguranca: "indefinida",
    necessidade_validacao: "indefinida",
    necessidade_detalhe: "indefinida",
    nivel_autoridade: "indefinido",
    decisores_presentes_na_sessao: "indefinido",
    decisores: [MARCADOR_EXEMPLO],
    evidencias: ["Exemplo fixo de demonstração — sem dado real por trás destas escolhas."],
  },
  linguagem_recomendada: {
    tom: ["objetiva"],
    justificativa: "Sem dado real por trás desta recomendação.",
  },
  pontos_de_atencao: [
    {
      nao_fazer: "Tratar este conteúdo como se fosse análise de um cliente real",
      motivo: "É um exemplo fixo de demonstração — ver o selo no topo da tela.",
    },
  ],
  perguntas_para_aprofundar: [
    { pergunta: "Exemplo fixo de pergunta de demonstração", motivo: "Sem dado real." },
  ],
  frases_para_o_fechamento: [
    {
      frase_literal: "Exemplo fixo de frase de demonstração",
      como_usar: "Não usar com cliente real — é um exemplo fixo.",
    },
  ],
  estrategia_sessao: {
    ritmo: "moderado",
    mais_tempo_em: ["Exemplo fixo de demonstração"],
    menos_tempo_em: ["Exemplo fixo de demonstração"],
    momento_croqui: "Exemplo fixo de demonstração",
    momento_investimento: "Exemplo fixo de demonstração",
    tratamento_objecoes: "Exemplo fixo de demonstração",
  },
  estrategia_fechamento: "Exemplo fixo de demonstração — nunca use este texto com um cliente real.",
  grau_confianca: 0,
  lacunas: ["Este texto é um exemplo fixo. Nenhuma informação deste cliente foi analisada."],
};

/** Validado contra o schema real na carga do módulo — divergência falha alto, não em produção. */
export const EXEMPLO_BRIEFING: Briefing = BriefingSchema.parse(RASCUNHO_EXEMPLO_BRIEFING);

// ===========================================================================
// Exemplo fixo da Análise do Agente do Croqui. Mesmo princípio: tipado e
// validado contra `CroquiAnaliseSchema`.
// ===========================================================================
function afirmacaoExemplo(categoria: CategoriaAfirmacao): Afirmacao {
  return { texto: "Exemplo fixo de demonstração — sem dado real por trás desta afirmação.", categoria };
}

const RASCUNHO_EXEMPLO_CROQUI_ANALISE: CroquiAnalise = {
  resumo_executivo:
    `EXEMPLO GERADO SEM IA. ${MARCADOR_EXEMPLO} é um personagem fictício usado só para mostrar o ` +
    "formato da Análise do Agente do Croqui. Nenhuma transcrição real foi analisada nesta saída.",
  historia: [afirmacaoExemplo("fato_declarado")],
  familia: [afirmacaoExemplo("fato_declarado")],
  patrimonio: [afirmacaoExemplo("ponto_a_validar")],
  empresas: [afirmacaoExemplo("dado_documental")],
  objetivos: [afirmacaoExemplo("inferencia")],
  riscos: [afirmacaoExemplo("ponto_a_validar")],
  disc: [
    {
      decisor: MARCADOR_EXEMPLO,
      perfil_predominante: "D",
      evidencias: ["Exemplo fixo de demonstração."],
      confianca: 0,
    },
  ],
  arquitetura: {
    recomendacao: "ponto_a_validar",
    criterios: CRITERIOS_ARQUITETURA.map((criterio) => ({
      criterio,
      resposta: afirmacaoExemplo("ponto_a_validar"),
      peso_na_decisao: "Exemplo fixo de demonstração.",
    })),
    justificativa_geral: "Exemplo fixo de demonstração — sem dado real por trás desta recomendação.",
  },
  croqui: ["Exemplo fixo de demonstração — nenhum slide foi de fato montado."],
  narrativa: [{ slide: "Legado", como_apresentar: "Exemplo fixo de demonstração." }],
  perguntas: [{ pergunta: "Exemplo fixo de pergunta de demonstração", motivo: "Sem dado real." }],
  objecoes: [
    { objecao: "Exemplo fixo de objeção de demonstração", resposta_recomendada: "Exemplo fixo de demonstração." },
  ],
  fechamento: "Exemplo fixo de demonstração — nunca use este texto com um cliente real.",
  grau_confianca: 0,
  lacunas: ["Este texto é um exemplo fixo. Nenhuma transcrição deste cliente foi analisada."],
};

export const EXEMPLO_CROQUI_ANALISE: CroquiAnalise = CroquiAnaliseSchema.parse(RASCUNHO_EXEMPLO_CROQUI_ANALISE);

// ===========================================================================
// O banco sabe que é demonstração, não só a tela (§3.3). Toda execução de
// demonstração grava `modo='demonstracao'`, `modelo='demonstracao'`,
// `custo_usd=0` e `tokens_* = 0` em `execucoes_ia` — a trigger
// `app.trava_saida_demonstracao` (0027) recusa qualquer tentativa de gravar a
// saída em `briefings`/`croqui_analises` com `origem_dado` diferente de
// 'exemplo' quando a execução é de demonstração, e `registrar_briefing`/
// `registrar_croqui_analise` (0027) já derivam `origem_dado` sozinhos a partir
// de `execucoes_ia.modo` — nenhuma rota precisa (nem pode) forjar isso.
// ===========================================================================

interface ParamsExecucaoDemonstracao {
  jornadaId: string | null;
  criadoPor: string | null;
  chavePrompt: string;
}

async function registrarExecucaoDemonstracao(
  supabaseAdmin: SupabaseClient,
  params: ParamsExecucaoDemonstracao,
): Promise<{ id: string }> {
  // A execução de demonstração ainda referencia o prompt ATIVO de verdade (só
  // não chama a Anthropic com ele) — mantém o vínculo de auditoria e garante
  // que, se não houver prompt ativo para a chave, o erro é o mesmo 404 do
  // caminho real, não um 500 por FK ausente (`prompt_versao_id` é NOT NULL).
  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id")
    .eq("chave", params.chavePrompt)
    .eq("ativo", true)
    .maybeSingle<{ id: string }>();

  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado(`prompt_ativo_nao_encontrado: ${params.chavePrompt}`);
  }

  const hashEntrada = crypto.createHash("sha256").update(`demonstracao:${params.chavePrompt}`).digest("hex");
  const agora = new Date().toISOString();

  const { data: execucao, error: erroExecucao } = await supabaseAdmin
    .from("execucoes_ia")
    .insert({
      jornada_id: params.jornadaId,
      prompt_versao_id: prompt.id,
      modelo: "demonstracao",
      modo: "demonstracao",
      status: "concluida",
      hash_entrada: hashEntrada,
      tokens_entrada: 0,
      tokens_saida: 0,
      tokens_cache_escrita: 0,
      tokens_cache_leitura: 0,
      custo_usd: 0,
      latencia_ms: 0,
      stop_reason: "demonstracao",
      criado_por: params.criadoPor,
      concluido_em: agora,
    })
    .select("id")
    .single<{ id: string }>();

  if (erroExecucao || !execucao) {
    throw new Error(`falha_ao_registrar_execucao_demonstracao: ${erroExecucao?.message}`);
  }

  return execucao;
}

const CHAVE_PROMPT_BRIEFING = "protocolo_01_briefing";
const CHAVE_PROMPT_CROQUI_ANALISE = "agente_croqui_analise";

/**
 * Equivalente de demonstração a `gerarBriefing` (briefing.ts). Chamar só depois
 * de confirmar `resolverModoIa() === "demonstracao"` — esta função não checa a
 * chave de novo, para não duplicar a regra de ativação em dois lugares.
 */
export async function gerarBriefingDemonstracao(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; criadoPor: string | null },
): Promise<ResultadoBriefing> {
  const execucao = await registrarExecucaoDemonstracao(supabaseAdmin, {
    jornadaId: params.jornadaId,
    criadoPor: params.criadoPor,
    chavePrompt: CHAVE_PROMPT_BRIEFING,
  });

  const fontesUsadas = ["demonstracao"];
  const { data: briefingGravado, error: erroBriefing } = await supabaseAdmin
    .rpc("registrar_briefing", {
      p_jornada_id: params.jornadaId,
      p_execucao_id: execucao.id,
      p_conteudo: EXEMPLO_BRIEFING,
      p_grau_confianca: EXEMPLO_BRIEFING.grau_confianca,
      p_fontes_usadas: fontesUsadas,
      p_modo_reduzido: false,
    })
    .single<{ id: string }>();

  if (erroBriefing || !briefingGravado) {
    throw new Error(`falha_ao_gravar_briefing_demonstracao: ${erroBriefing?.message}`);
  }

  return {
    execucaoId: execucao.id,
    briefingId: briefingGravado.id,
    briefing: EXEMPLO_BRIEFING,
    grauConfianca: EXEMPLO_BRIEFING.grau_confianca,
    fontesUsadas,
    modoReduzido: false,
    custoUsd: 0,
  };
}

/**
 * Equivalente de demonstração a `gerarAnaliseCroqui` (croqui-analise.ts). Chamar
 * só depois de confirmar `resolverModoIa() === "demonstracao"`. Diferente do
 * caminho real, NÃO checa consentimento de tratamento por IA — não há
 * transcrição nem dado de pessoa real envolvido, a saída é sempre o exemplo fixo.
 */
export async function gerarAnaliseCroquiDemonstracao(
  supabaseAdmin: SupabaseClient,
  params: { croquiId: string; jornadaId: string; criadoPor: string | null },
): Promise<ResultadoAnaliseCroqui> {
  const execucao = await registrarExecucaoDemonstracao(supabaseAdmin, {
    jornadaId: params.jornadaId,
    criadoPor: params.criadoPor,
    chavePrompt: CHAVE_PROMPT_CROQUI_ANALISE,
  });

  const { data: analiseGravada, error: erroAnalise } = await supabaseAdmin
    .rpc("registrar_croqui_analise", {
      p_croqui_id: params.croquiId,
      p_execucao_id: execucao.id,
      p_conteudo: EXEMPLO_CROQUI_ANALISE,
      p_grau_confianca: EXEMPLO_CROQUI_ANALISE.grau_confianca,
    })
    .single<{ id: string }>();

  if (erroAnalise || !analiseGravada) {
    throw new Error(`falha_ao_gravar_analise_demonstracao: ${erroAnalise?.message}`);
  }

  return {
    execucaoId: execucao.id,
    analiseId: analiseGravada.id,
    analise: EXEMPLO_CROQUI_ANALISE,
    custoUsd: 0,
  };
}
