import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { resolverProvedor, type EffortIa } from "./cliente";
import { calcularCustoUsd } from "./precos";
import { erroLimiteIaAtingido, erroNaoEncontrado, ErroIa } from "./erros";

/**
 * Ponto central de execução de IA do SIC-HF (B1-8). Todo chamador real
 * (`briefing.ts`, `croqui-analise.ts`, `material.ts`, `ordenar-horarios.ts`)
 * passa por aqui — nenhum fala com `resolverProvedor()`/adaptador direto.
 *
 * Ordem de execução, fixa:
 * 1. busca prompt por `chavePrompt` (ativo, ou uma `versaoPrompt` específica —
 *    só a bancada usa isto, para medir uma versão ainda não promovida; 404 se
 *    não houver)
 * 2. checa cooldown/teto diário via `verificar_cooldown_ia` (RPC, wrapper de
 *    `app.pode_executar_ia`, banco desde a 0027) — ANTES de qualquer INSERT,
 *    para não sujar `execucoes_ia` com uma linha que nunca ia rodar. Pulado só
 *    com `isentoCooldown: true` (script de bancada — nunca alcançável por rota
 *    HTTP; a rota nunca passa esse parâmetro).
 * 3. serializa entrada + hash sha256
 * 4. INSERT execucoes_ia status 'executando' (grava `effort`/`variante` já aqui)
 * 5. resolve provedor via `resolverProvedor()`
 * 6. chama `executar()`
 *    - recusa → UPDATE falhou + lança ErroIa(502, 'recusa_ia')
 *    - saída inválida (após o re-prompt do adaptador) → UPDATE falhou + lança ErroIa(502, 'saida_invalida')
 *    - sucesso → UPDATE concluida com tokens/custo/latência/stop_reason/request_id
 * 7. retorna { execucaoId, saida, custoUsd }
 *
 * Cada chamador mantém a lógica específica dele (montagem de contexto, checagem
 * de consentimento, RPC de gravação do conteúdo) — este módulo não sabe nada
 * sobre briefing, croqui, material ou agenda.
 *
 * Modelo: fonte da verdade é `prompts_versoes.modelo_padrao` (o SEED/migration
 * decide o slug). `IA_MODELO_PADRAO`, se presente, VENCE — é só para rollback
 * rápido de incidente (ex.: modelo com problema no provedor), nunca a
 * configuração normal de operação. Trocar de modelo por custo é BLOQUEIO B23
 * — não é este módulo que decide isso.
 */

interface PromptAtivo {
  id: string;
  versao: number;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: EffortIa;
}

/**
 * Bi-versão (ARQUITETURA-FASE-4.md §4.4/§5.2): o schema pode depender da
 * versão do prompt que está ATIVA — v3 do briefing exige `linguagem_do_cliente`,
 * v2 do croqui exige os 13 slides tipados. Quem chama passa uma função e este
 * módulo resolve com a `versao` da MESMA linha de `prompts_versoes` já lida
 * (zero query extra). Um schema fixo continua aceito.
 */
export type SchemaPorVersao<T> = z.ZodType<T> | ((versao: number) => z.ZodType<T>);

export interface ParamsExecutarComAuditoria<T> {
  chavePrompt: string;
  /**
   * Só a bancada (`scripts/bancada-ia.ts`) usa isto — mede uma versão de
   * prompt específica (ex.: v2 ainda não promovida) em vez da versão `ativo`.
   * Nunca reachable por rota HTTP: nenhuma rota aceita este campo do cliente.
   */
  versaoPrompt?: number;
  jornadaId: string | null;
  criadoPor: string | null;
  /** Conteúdo serializável enviado como mensagem `user` (após o prefixo, se houver). */
  entrada: unknown;
  /** Texto fixo que precede a entrada serializada na mensagem `user` (ex.: "Contexto da família (JSON):"). */
  prefixoUsuario: string;
  /**
   * Texto anexado ao final de `corpo_sistema` antes de chamar o provedor (ex.:
   * o bloco de orçamento de escrita, L2 — ARQUITETURA-FASE-3.md §1.4).
   * Condicionado por quem chama (normalmente por uma chave de `configuracoes`
   * lida no chamador) — este módulo só concatena, não decide.
   */
  extraSistema?: string;
  schema: SchemaPorVersao<T>;
  nomeSchema: string;
  maxTokens: number;
  /** Só a bancada — mede `effort` diferente do gravado em `prompts_versoes` sem criar prompt novo. */
  effortOverride?: EffortIa;
  /** Rótulo da variante medida pela bancada (ex.: 'baseline', 'effort_low'). NULL em produção — nunca setável por rota pública. */
  variante?: string | null;
  /**
   * Pula a checagem de cooldown/teto diário (§1.10). Só para o script de
   * bancada, que roda IA em laço de propósito — NUNCA setado a partir de uma
   * rota HTTP (o pentest da Onda 4 audita isto: `variante`/`isentoCooldown`
   * não podem ser alcançáveis pela API pública).
   */
  isentoCooldown?: boolean;
}

export interface ResultadoExecucaoAuditada<T> {
  execucaoId: string;
  saida: T;
  custoUsd: number | null;
  /** Versão de `prompts_versoes` efetivamente usada — quem grava carimba o schema correspondente (ex.: `p_schema_versao`). */
  promptVersao: number;
}

export async function executarComAuditoria<T>(
  supabaseAdmin: SupabaseClient,
  params: ParamsExecutarComAuditoria<T>,
): Promise<ResultadoExecucaoAuditada<T>> {
  const {
    chavePrompt,
    versaoPrompt,
    jornadaId,
    criadoPor,
    entrada,
    prefixoUsuario,
    extraSistema,
    schema,
    nomeSchema,
    maxTokens,
    effortOverride,
    variante,
    isentoCooldown,
  } = params;

  let consultaPrompt = supabaseAdmin
    .from("prompts_versoes")
    .select("id, versao, corpo_sistema, modelo_padrao, effort")
    .eq("chave", chavePrompt);
  consultaPrompt =
    versaoPrompt != null ? consultaPrompt.eq("versao", versaoPrompt) : consultaPrompt.eq("ativo", true);
  const { data: prompt, error: erroPrompt } = await consultaPrompt.maybeSingle<PromptAtivo>();

  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado(`prompt_ativo_nao_encontrado: ${chavePrompt}${versaoPrompt ? ` v${versaoPrompt}` : ""}`);
  }

  // Cooldown de IA (0027) e teto diário por usuário — ligados em runtime pela
  // primeira vez nesta onda (ARQUITETURA-FASE-3.md §1.10). Este plano cria um
  // botão que gasta dinheiro de propósito (`forcar_mesmo_assim` na porta de
  // completude) — sem enforcement aqui, o achado BAIXO 7 do pentest de 03/09
  // vira MÉDIO. `verificar_cooldown_ia` é SECURITY DEFINER (0029): dá a
  // resposta certa independente do papel de quem pergunta.
  if (!isentoCooldown) {
    const { data: podeExecutar, error: erroCooldown } = await supabaseAdmin.rpc("verificar_cooldown_ia", {
      p_jornada_id: jornadaId,
      p_perfil_id: criadoPor,
    });
    if (erroCooldown) {
      throw new Error(`falha_ao_checar_cooldown_ia: ${erroCooldown.message}`);
    }
    if (podeExecutar !== true) {
      throw erroLimiteIaAtingido(
        "Cooldown de IA ou teto diário de execuções atingido — tente novamente mais tarde.",
      );
    }
  }

  const modeloOverride = process.env.IA_MODELO_PADRAO?.trim();
  const modelo = modeloOverride ? modeloOverride : prompt.modelo_padrao;
  const effort = effortOverride ?? prompt.effort;
  const schemaResolvido: z.ZodType<T> = typeof schema === "function" ? schema(prompt.versao) : schema;
  const sistema = extraSistema ? `${prompt.corpo_sistema}\n\n${extraSistema}` : prompt.corpo_sistema;

  const entradaSerializada = JSON.stringify(entrada);
  const hashEntrada = crypto.createHash("sha256").update(entradaSerializada).digest("hex");

  const { data: execucao, error: erroExecucao } = await supabaseAdmin
    .from("execucoes_ia")
    .insert({
      jornada_id: jornadaId,
      prompt_versao_id: prompt.id,
      modelo,
      status: "executando",
      hash_entrada: hashEntrada,
      criado_por: criadoPor,
      effort,
      variante: variante ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (erroExecucao || !execucao) {
    throw new Error(`falha_ao_registrar_execucao: ${erroExecucao?.message}`);
  }

  const inicio = Date.now();

  try {
    const provedor = resolverProvedor();
    const resposta = await provedor.executar({
      modelo,
      sistema,
      usuario: `${prefixoUsuario}\n\n${entradaSerializada}`,
      schema: schemaResolvido,
      nomeSchema,
      maxTokens,
      effort,
    });

    const latenciaMs = Date.now() - inicio;
    const stopReasonGravado = resposta.stopReasonNativo ?? resposta.stopReason;

    if (resposta.recusou) {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: `refusal: ${resposta.motivoRecusa ?? "sem_categoria"}`,
          latencia_ms: latenciaMs,
          stop_reason: stopReasonGravado,
          request_id: resposta.requestId,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa("A IA recusou processar este conteúdo.", 502, "recusa_ia");
    }

    if (resposta.saida === null) {
      await supabaseAdmin
        .from("execucoes_ia")
        .update({
          status: "falhou",
          erro: resposta.usouReprompt ? "reprompt_1: saida_nao_validou_contra_o_schema" : "saida_nao_validou_contra_o_schema",
          latencia_ms: latenciaMs,
          stop_reason: stopReasonGravado,
          request_id: resposta.requestId,
          concluido_em: new Date().toISOString(),
        })
        .eq("id", execucao.id);
      throw new ErroIa(`A saída da IA não validou contra o schema "${nomeSchema}".`, 502, "saida_invalida");
    }

    const custoUsd = resposta.custoUsdInformado ?? (await calcularCustoUsd(supabaseAdmin, modelo, resposta.uso));

    await supabaseAdmin
      .from("execucoes_ia")
      .update({
        status: "concluida",
        tokens_entrada: resposta.uso.tokensEntrada,
        tokens_saida: resposta.uso.tokensSaida,
        tokens_cache_escrita: resposta.uso.tokensCacheEscrita,
        tokens_cache_leitura: resposta.uso.tokensCacheLeitura,
        // Ja contido em tokens_saida — grava separado so para saber quanto da
        // saida foi raciocinio, que e o que da para calibrar sem mexer no metodo.
        tokens_raciocinio: resposta.uso.tokensRaciocinio || null,
        custo_usd: custoUsd,
        latencia_ms: latenciaMs,
        stop_reason: stopReasonGravado,
        request_id: resposta.requestId,
        erro: resposta.usouReprompt ? "reprompt_1" : null,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", execucao.id);

    return { execucaoId: execucao.id, saida: resposta.saida, custoUsd, promptVersao: prompt.versao };
  } catch (erro) {
    if (erro instanceof ErroIa) throw erro;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await supabaseAdmin
      .from("execucoes_ia")
      .update({ status: "falhou", erro: mensagem, latencia_ms: Date.now() - inicio, concluido_em: new Date().toISOString() })
      .eq("id", execucao.id);
    throw erro;
  }
}
