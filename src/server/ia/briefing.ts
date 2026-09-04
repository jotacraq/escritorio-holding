import type { SupabaseClient } from "@supabase/supabase-js";
import { montarContextoBriefing, type ContextoBriefing } from "./contexto-briefing";
import { BriefingSchema, type Briefing } from "./schema-briefing";
import { erroServicoIndisponivel, erroNaoEncontrado, erroDadosInsuficientes, ErroIa } from "./erros";
import { resolverModoIa, gerarBriefingDemonstracao } from "./demonstracao";
import { executarComAuditoria } from "./executar";
import { calcularCompletude, type ResultadoCompletude } from "./completude";
import { calcularFidelidade, type ResultadoFidelidade } from "./fidelidade";
import { CHAVE_ORCAMENTO_ESCRITA_ATIVO, lerConfiguracaoBool } from "./configuracao";
import { BLOCO_ORCAMENTO_ESCRITA } from "./orcamento-escrita";
import type { EffortIa } from "./cliente";

const CHAVE_PROMPT = "protocolo_01_briefing";

export interface ResultadoBriefing {
  execucaoId: string;
  briefingId: string;
  briefing: Briefing;
  grauConfianca: number;
  fontesUsadas: string[];
  modoReduzido: boolean;
  custoUsd: number | null;
  /** Ausente em modo demonstração (não passa pela porta de completude nem pela IA real). */
  completude?: ResultadoCompletude;
  /** Ausente em modo demonstração (nenhuma frase/evidência real para checar). */
  verificacao?: ResultadoFidelidade;
}

export interface ParamsGerarBriefingSemGravar {
  jornadaId: string;
  criadoPor: string | null;
  /** Gera mesmo com completude abaixo do limiar — a tela de admin/advogada oferece isto, sempre com confirmação explícita (§1.7). */
  forcarMesmoAssim?: boolean;
  /**
   * Só `scripts/bancada-ia.ts` usa os 4 campos abaixo (protocolo de medição,
   * ARQUITETURA-FASE-3.md §1.9). Nenhuma rota HTTP os expõe — `POST
   * /api/briefings/gerar` valida o corpo com um Zod fixo que não tem estes
   * campos, então isto não é alcançável por fora de código de servidor.
   */
  versaoPrompt?: number;
  effortOverride?: EffortIa;
  variante?: string | null;
  isentoCooldown?: boolean;
}

export interface ResultadoBriefingSemGravar {
  execucaoId: string;
  briefing: Briefing;
  contexto: ContextoBriefing;
  fontesUsadas: string[];
  modoReduzido: boolean;
  custoUsd: number | null;
  completude: ResultadoCompletude;
  verificacao: ResultadoFidelidade;
}

/**
 * Núcleo da geração do Briefing — monta contexto, aplica a porta de
 * completude (L4, §1.7), chama a IA e verifica fidelidade (§1.8). NÃO grava
 * em `briefings` (RPC `registrar_briefing`) — quem persiste é `gerarBriefing()`
 * abaixo. Existe separado para `scripts/bancada-ia.ts` poder medir custo e
 * qualidade em cima do MESMO caminho de produção sem sujar o histórico de
 * `briefings` de uma jornada real com saída de variante experimental (achado
 * do pentest §7, Onda 4: "confirmar que a bancada não grava briefings").
 */
export async function gerarBriefingSemGravar(
  supabaseAdmin: SupabaseClient,
  params: ParamsGerarBriefingSemGravar,
): Promise<ResultadoBriefingSemGravar> {
  const { jornadaId, criadoPor, forcarMesmoAssim, versaoPrompt, effortOverride, variante, isentoCooldown } = params;

  if (resolverModoIa() !== "real") {
    throw erroServicoIndisponivel(
      "IA não configurada em modo real — geração sem gravação exige modo real (nunca demonstração, que só serve o exemplo fixo).",
    );
  }

  let contextoMontado;
  try {
    contextoMontado = await montarContextoBriefing(supabaseAdmin, jornadaId);
  } catch {
    throw erroNaoEncontrado(`jornada_nao_encontrada: ${jornadaId}`);
  }
  const { contexto, fontesUsadas, modoReduzido, sinaisCompletude } = contextoMontado;

  const completude = await calcularCompletude(supabaseAdmin, sinaisCompletude);
  if (!completude.atingiu && !forcarMesmoAssim) {
    throw erroDadosInsuficientes(
      `completude_insuficiente: score ${completude.score} < limiar ${completude.minimo}`,
      completude,
    );
  }

  const orcamentoEscritaAtivo = await lerConfiguracaoBool(supabaseAdmin, CHAVE_ORCAMENTO_ESCRITA_ATIVO, true);

  const { execucaoId, saida: briefing, custoUsd } = await executarComAuditoria(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT,
    versaoPrompt,
    jornadaId,
    criadoPor,
    entrada: contexto,
    prefixoUsuario:
      "Contexto da família e da jornada (JSON, allowlist — nunca contém valor absoluto de " +
      "patrimônio, CPF ou endereço completo):",
    extraSistema: orcamentoEscritaAtivo ? BLOCO_ORCAMENTO_ESCRITA : undefined,
    schema: BriefingSchema,
    nomeSchema: "protocolo_01_briefing",
    maxTokens: 16000,
    effortOverride,
    variante,
    isentoCooldown,
  });

  const verificacao = calcularFidelidade(contexto, briefing);

  return { execucaoId, briefing, contexto, fontesUsadas, modoReduzido, custoUsd, completude, verificacao };
}

/**
 * Orquestra a geração do Briefing Estratégico (Protocolo 01) E a persiste
 * como o briefing `atual` da jornada. Se a IA não estiver configurada: com o
 * modo demonstração ligado (`resolverModoIa`, ARQUITETURA-FASE-2.md §3),
 * devolve o exemplo fixo e marcado — nunca análise fabricada de um cliente
 * real; sem o modo demonstração, lança 503 antes de qualquer chamada,
 * exatamente como antes da Fase 2. Se a IA recusar ou a saída não validar,
 * grava a execução como `falhou` e propaga o erro — nunca renderiza um
 * briefing vazio como se fosse análise.
 */
export async function gerarBriefing(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; criadoPor: string | null; forcarRegeracao?: boolean; forcarMesmoAssim?: boolean },
): Promise<ResultadoBriefing> {
  const { jornadaId, criadoPor, forcarRegeracao, forcarMesmoAssim } = params;

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
      throw new ErroIa(
        "Já existe um Briefing gerado para esta jornada. Use o botão \"Regerar briefing\" para criar uma nova versão.",
        409,
        "conflito",
      );
    }
  }

  if (modoIa === "demonstracao") {
    return gerarBriefingDemonstracao(supabaseAdmin, { jornadaId, criadoPor });
  }

  const { execucaoId, briefing, fontesUsadas, modoReduzido, custoUsd, completude, verificacao } =
    await gerarBriefingSemGravar(supabaseAdmin, { jornadaId, criadoPor, forcarMesmoAssim });

  const { data: briefingGravado, error: erroBriefing } = await supabaseAdmin
    .rpc("registrar_briefing", {
      p_jornada_id: jornadaId,
      p_execucao_id: execucaoId,
      p_conteudo: briefing,
      p_grau_confianca: briefing.grau_confianca,
      p_fontes_usadas: fontesUsadas,
      p_modo_reduzido: modoReduzido,
      p_completude_entrada: completude.score,
      p_verificacao: verificacao,
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
    completude,
    verificacao,
  };
}
