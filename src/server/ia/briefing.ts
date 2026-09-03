import type { SupabaseClient } from "@supabase/supabase-js";
import { montarContextoBriefing } from "./contexto-briefing";
import { BriefingSchema, type Briefing } from "./schema-briefing";
import { erroServicoIndisponivel, erroNaoEncontrado, ErroIa } from "./erros";
import { resolverModoIa, gerarBriefingDemonstracao } from "./demonstracao";
import { executarComAuditoria } from "./executar";

const CHAVE_PROMPT = "protocolo_01_briefing";

export interface ResultadoBriefing {
  execucaoId: string;
  briefingId: string;
  briefing: Briefing;
  grauConfianca: number;
  fontesUsadas: string[];
  modoReduzido: boolean;
  custoUsd: number | null;
}

/**
 * Orquestra a geração do Briefing Estratégico (Protocolo 01). Se a IA não
 * estiver configurada: com o modo demonstração ligado (`resolverModoIa`,
 * ARQUITETURA-FASE-2.md §3), devolve o exemplo fixo e marcado — nunca análise
 * fabricada de um cliente real; sem o modo demonstração, lança 503 antes de
 * qualquer chamada, exatamente como antes da Fase 2. Se a IA recusar ou a
 * saída não validar, grava a execução como `falhou` e propaga o erro — nunca
 * renderiza um briefing vazio como se fosse análise.
 */
export async function gerarBriefing(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; criadoPor: string | null; forcarRegeracao?: boolean },
): Promise<ResultadoBriefing> {
  const { jornadaId, criadoPor, forcarRegeracao } = params;

  const modoIa = resolverModoIa();
  if (modoIa === "indisponivel") {
    throw erroServicoIndisponivel("IA não configurada — geração de briefing indisponível");
  }

  // "atual já existe, use forcar_regeracao" vale para os dois modos: sem isto,
  // gerar demonstração em cima de um briefing real (ou vice-versa) criaria
  // versão nova em silêncio a cada clique.
  if (!forcarRegeracao) {
    const { data: existente } = await supabaseAdmin
      .from("briefings")
      .select("id")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle();
    if (existente) {
      throw new ErroIa("briefing_atual_ja_existe: use forcar_regeracao=true para regerar", 409, "conflito");
    }
  }

  if (modoIa === "demonstracao") {
    return gerarBriefingDemonstracao(supabaseAdmin, { jornadaId, criadoPor });
  }

  let contextoMontado;
  try {
    contextoMontado = await montarContextoBriefing(supabaseAdmin, jornadaId);
  } catch {
    throw erroNaoEncontrado(`jornada_nao_encontrada: ${jornadaId}`);
  }
  const { contexto, fontesUsadas, modoReduzido } = contextoMontado;

  const { execucaoId, saida: briefing, custoUsd } = await executarComAuditoria(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT,
    jornadaId,
    criadoPor,
    entrada: contexto,
    prefixoUsuario:
      "Contexto da família e da jornada (JSON, allowlist — nunca contém valor absoluto de " +
      "patrimônio, CPF ou endereço completo):",
    schema: BriefingSchema,
    nomeSchema: "protocolo_01_briefing",
    maxTokens: 16000,
  });

  const { data: briefingGravado, error: erroBriefing } = await supabaseAdmin
    .rpc("registrar_briefing", {
      p_jornada_id: jornadaId,
      p_execucao_id: execucaoId,
      p_conteudo: briefing,
      p_grau_confianca: briefing.grau_confianca,
      p_fontes_usadas: fontesUsadas,
      p_modo_reduzido: modoReduzido,
    })
    .single<{ id: string }>();

  if (erroBriefing || !briefingGravado) {
    throw new Error(`falha_ao_gravar_briefing: ${erroBriefing?.message}`);
  }

  return {
    execucaoId,
    briefingId: briefingGravado.id,
    briefing,
    grauConfianca: briefing.grau_confianca,
    fontesUsadas,
    modoReduzido,
    custoUsd,
  };
}
