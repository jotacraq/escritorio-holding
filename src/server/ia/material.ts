import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { erroServicoIndisponivel, erroNaoEncontrado, ErroIa } from "./erros";
import { resolverModoIa } from "./demonstracao";
import { executarComAuditoria } from "./executar";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { APP_URL } from "@/lib/config-publica";
import { escolherModeloMaterial, type ModeloMaterialCatalogo } from "@/server/material/escolher";
import { buscarModelosAtivos, buscarSinaisMaterial, type ConclusaoSessao } from "@/server/material/sinais";
import type { ConteudoMaterial, FonteDorMaterial, MotivoModelo, OrigemDadoMaterial } from "@/types/material";

/**
 * Material pós-sessão personalizado pela dor do cliente (ARQUITETURA-FASE-2.md
 * §4.4, CONFLITO C11/C12, BLOQUEIO B14; Fase 4 §3.4 — catálogo por dor/arquétipo
 * e `conclusao_sessao` na entrada). Mesmo padrão de `briefing.ts`/
 * `croqui-analise.ts`: modo demonstração (`resolverModoIa`) quando a IA não
 * está configurada, 503 honesto sem a flag. NÃO edita `demonstracao.ts`
 * (fora da minha fronteira) — o caminho de demonstração deste módulo é
 * self-contained mais abaixo, pelo mesmo motivo que aquele arquivo não pôde
 * antecipar um exemplo de material: a tabela só nasce nesta migration (0031).
 *
 * Fase 4: a cascata da dor e os sinais do briefing/relatório/análise vivem em
 * `src/server/material/sinais.ts`; a escolha do modelo é `escolherModeloMaterial`
 * (função pura, zero IA) — o regex hardcoded virou `materiais_modelos.dores`
 * (0055). Continua sendo UMA chamada de IA por material, zero quando sem dor.
 */

// ===========================================================================
// Schema de saída — MESMO vocabulário de bloco que o front público já espera
// (`src/types/publico-ui.ts BlocoMaterialPublico`, F-1A): só 'titulo' |
// 'paragrafo' | 'lista' | 'citacao'. Nunca os tipos do rascunho do plano
// (§4.4: 'destaque'/'proximos_passos') — o front não sabe renderizá-los.
// ===========================================================================
export const BlocoMaterialSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("titulo"), texto: z.string().min(1).max(200) }),
  z.object({ tipo: z.literal("paragrafo"), texto: z.string().min(1).max(2000) }),
  z.object({ tipo: z.literal("lista"), itens: z.array(z.string().min(1).max(500)).min(1).max(12) }),
  z.object({ tipo: z.literal("citacao"), texto: z.string().min(1).max(500) }),
]);

export const MaterialConteudoSchema = z.object({
  titulo: z.string().min(1).max(200),
  blocos: z.array(BlocoMaterialSchema).min(1).max(20),
});

export interface ResultadoMaterial {
  execucaoId: string | null;
  materialId: string;
  material: ConteudoMaterial;
  fonteDor: FonteDorMaterial;
  dorPrincipal: string | null;
  chaveModelo: string;
  motivoModelo: MotivoModelo;
  origemDado: OrigemDadoMaterial;
  custoUsd: number | null;
}

const CHAVE_PROMPT = "material_pos_sessao";
const MARCADOR_EXEMPLO_MATERIAL = "Cliente Exemplo da Silva Demonstração";

/**
 * Teto da entrada da IA (§3.4): se passar de ~6 000 tokens, corta o
 * `resumo_executivo` da análise (o campo mais longo e o menos essencial —
 * o resultado da sessão e as considerações da advogada ficam). Estimativa
 * conservadora para português: ~3,5 caracteres por token.
 */
const TETO_TOKENS_ENTRADA = 6000;
const CARACTERES_POR_TOKEN = 3.5;

function estimarTokens(objeto: unknown): number {
  return Math.ceil(JSON.stringify(objeto).length / CARACTERES_POR_TOKEN);
}

function montarEntradaIa(params: {
  primeiroNome: string;
  dorPrincipal: string;
  fonteDor: FonteDorMaterial;
  modelo: ModeloMaterialCatalogo;
  conclusaoSessao: ConclusaoSessao | undefined;
}) {
  const base = {
    primeiro_nome: params.primeiroNome,
    dor_principal: params.dorPrincipal,
    fonte_dor: params.fonteDor,
    modelo_base: params.modelo.conteudo,
  };
  if (!params.conclusaoSessao) return base;

  const completa = { ...base, conclusao_sessao: params.conclusaoSessao };
  if (estimarTokens(completa) <= TETO_TOKENS_ENTRADA) return completa;

  const { resumo_executivo: _cortado, ...semResumo } = params.conclusaoSessao;
  void _cortado;
  return Object.keys(semResumo).length > 0 ? { ...base, conclusao_sessao: semResumo } : base;
}

function validarConteudoModelo(conteudo: unknown): ConteudoMaterial {
  return MaterialConteudoSchema.parse(conteudo);
}

// ===========================================================================
// Geração
// ===========================================================================

export async function gerarMaterial(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; criadoPor: string | null; forcarRegeracao?: boolean },
): Promise<ResultadoMaterial> {
  const { jornadaId, criadoPor, forcarRegeracao } = params;

  const modoIa = resolverModoIa();
  if (modoIa === "indisponivel") {
    throw erroServicoIndisponivel("IA não configurada — geração de material indisponível");
  }

  if (!forcarRegeracao) {
    const { data: existente } = await supabaseAdmin
      .from("materiais_gerados")
      .select("id")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .maybeSingle();
    if (existente) {
      throw new ErroIa(
        "Já existe um Material gerado para esta jornada. Use o botão \"Gerar nova versão\" para criar uma nova.",
        409,
        "conflito",
      );
    }
  }

  const { data: jornada, error: erroJornada } = await supabaseAdmin
    .from("jornadas")
    .select("id, pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle<{ id: string; pessoa_id: string }>();
  if (erroJornada || !jornada) {
    throw erroNaoEncontrado(`jornada_nao_encontrada: ${jornadaId}`);
  }

  const { data: pessoa } = await supabaseAdmin
    .from("pessoas")
    .select("nome")
    .eq("id", jornada.pessoa_id)
    .maybeSingle<{ nome: string }>();
  const primeiroNome = (pessoa?.nome ?? "").trim().split(/\s+/)[0] ?? "";

  const [sinais, modelos] = await Promise.all([
    buscarSinaisMaterial(supabaseAdmin, jornadaId),
    buscarModelosAtivos(supabaseAdmin, validarConteudoModelo),
  ]);
  const { dorPrincipal, fonteDor, conclusaoSessao } = sinais;
  const { modelo, motivo_modelo: motivoModelo } = escolherModeloMaterial(sinais, modelos);

  if (modoIa === "demonstracao") {
    return gerarMaterialDemonstracao(supabaseAdmin, { jornadaId, criadoPor, modelo, motivoModelo, dorPrincipal, fonteDor });
  }

  // Sem dor nenhuma: o material É o modelo padrão, sem chamar a IA. Mandar "sem
  // dado nenhum" para a Anthropic personalizar geraria personalização fabricada
  // do nada — exatamente o que C11 proíbe. Mesmo princípio do `modoReduzido` do
  // Briefing, aplicado aqui: menos dado, menos IA, nunca dado inventado no lugar.
  if (fonteDor === "nenhuma" || dorPrincipal === null) {
    const { data: gravado, error: erroGravar } = await supabaseAdmin
      .rpc("registrar_material_gerado", {
        p_jornada_id: jornadaId,
        p_execucao_id: null,
        p_modelo_id: modelo.id,
        p_dor_principal: null,
        p_fonte_dor: "nenhuma",
        p_conteudo: modelo.conteudo,
        p_motivo_modelo: motivoModelo,
      })
      .single<{ id: string }>();
    if (erroGravar || !gravado) {
      throw new Error(`falha_ao_gravar_material_padrao: ${erroGravar?.message}`);
    }
    return {
      execucaoId: null,
      materialId: gravado.id,
      material: modelo.conteudo,
      fonteDor: "nenhuma",
      dorPrincipal: null,
      chaveModelo: modelo.chave,
      motivoModelo,
      origemDado: "real",
      custoUsd: null,
    };
  }

  const entrada = montarEntradaIa({ primeiroNome, dorPrincipal, fonteDor, modelo, conclusaoSessao });

  const { execucaoId, saida: material, custoUsd } = await executarComAuditoria(supabaseAdmin, {
    chavePrompt: CHAVE_PROMPT,
    jornadaId,
    criadoPor,
    entrada,
    prefixoUsuario:
      "Dor/preocupação real do cliente, conclusão da Sessão de Viabilidade (quando houver) e material-base a personalizar (JSON):",
    schema: MaterialConteudoSchema,
    nomeSchema: CHAVE_PROMPT,
    maxTokens: 4000,
  });

  const { data: gravado, error: erroGravar } = await supabaseAdmin
    .rpc("registrar_material_gerado", {
      p_jornada_id: jornadaId,
      p_execucao_id: execucaoId,
      p_modelo_id: modelo.id,
      p_dor_principal: dorPrincipal,
      p_fonte_dor: fonteDor,
      p_conteudo: material,
      p_motivo_modelo: motivoModelo,
    })
    .single<{ id: string }>();
  if (erroGravar || !gravado) {
    throw new Error(`falha_ao_gravar_material: ${erroGravar?.message}`);
  }

  return {
    execucaoId,
    materialId: gravado.id,
    material,
    fonteDor,
    dorPrincipal,
    chaveModelo: modelo.chave,
    motivoModelo,
    origemDado: "real",
    custoUsd,
  };
}

/**
 * Caminho de demonstração deste módulo. NÃO vive em `src/server/ia/demonstracao.ts`
 * (fora da minha fronteira — "leia e use", não edite) porque `materiais_gerados`
 * só existe a partir desta migration (0031), depois daquele arquivo ter sido
 * escrito na ONDA 0. Mesmo princípio: exemplo fixo, `grau_confianca`-equivalente
 * zero, marcado como demonstração no banco (`execucoes_ia.modo='demonstracao'`,
 * `origem_dado='exemplo'` via `registrar_material_gerado`).
 */
async function gerarMaterialDemonstracao(
  supabaseAdmin: SupabaseClient,
  params: {
    jornadaId: string;
    criadoPor: string | null;
    modelo: ModeloMaterialCatalogo;
    motivoModelo: MotivoModelo;
    dorPrincipal: string | null;
    fonteDor: FonteDorMaterial;
  },
): Promise<ResultadoMaterial> {
  const { data: prompt, error: erroPrompt } = await supabaseAdmin
    .from("prompts_versoes")
    .select("id")
    .eq("chave", CHAVE_PROMPT)
    .eq("ativo", true)
    .maybeSingle<{ id: string }>();
  if (erroPrompt || !prompt) {
    throw erroNaoEncontrado(`prompt_ativo_nao_encontrado: ${CHAVE_PROMPT}`);
  }

  const hashEntrada = crypto.createHash("sha256").update(`demonstracao:${CHAVE_PROMPT}`).digest("hex");
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

  const materialExemplo: ConteudoMaterial = MaterialConteudoSchema.parse({
    titulo: `EXEMPLO GERADO SEM IA — ${MARCADOR_EXEMPLO_MATERIAL}`,
    blocos: [
      { tipo: "titulo", texto: "Este é um exemplo fixo de demonstração" },
      {
        tipo: "paragrafo",
        texto:
          "Nenhuma informação real deste cliente foi analisada. Este texto é um exemplo fixo, usado " +
          "só para mostrar o formato do material pós-sessão enquanto a IA não está " +
          "configurada no servidor.",
      },
      {
        tipo: "lista",
        itens: ["Exemplo fixo de ponto de atenção de demonstração.", "Exemplo fixo de próximo passo de demonstração."],
      },
      { tipo: "citacao", texto: "Exemplo fixo de demonstração — não usar com cliente real." },
    ],
  });

  const { data: gravado, error: erroGravar } = await supabaseAdmin
    .rpc("registrar_material_gerado", {
      p_jornada_id: params.jornadaId,
      p_execucao_id: execucao.id,
      p_modelo_id: params.modelo.id,
      p_dor_principal: params.dorPrincipal,
      p_fonte_dor: params.fonteDor,
      p_conteudo: materialExemplo,
      p_motivo_modelo: params.motivoModelo,
    })
    .single<{ id: string }>();
  if (erroGravar || !gravado) {
    throw new Error(`falha_ao_gravar_material_demonstracao: ${erroGravar?.message}`);
  }

  return {
    execucaoId: execucao.id,
    materialId: gravado.id,
    material: materialExemplo,
    fonteDor: params.fonteDor,
    dorPrincipal: params.dorPrincipal,
    chaveModelo: params.modelo.chave,
    motivoModelo: params.motivoModelo,
    origemDado: "exemplo",
    custoUsd: 0,
  };
}

// ===========================================================================
// Link de material no momento do envio da régua (G18) — usado só por
// `processarFilaRegua` (src/server/regua/processar.ts). Não reusa
// `emitir_link_publico` (0028): aquela RPC autentica por `auth.uid()`, que é
// NULL sob o cliente `service_role` do cron. `emitir_link_material_sistema`
// (0031) é a RPC irmã, restrita a `service_role`, que já confere sozinha que
// existe material atual aprovado antes de mintar o token.
// ===========================================================================
export async function emitirLinkMaterialSistema(supabaseAdmin: SupabaseClient, jornadaId: string): Promise<string> {
  const pepper = exigirPepper();
  const token = gerarToken();
  const tokenHash = hashToken(token, pepper);
  const tokenPrefixo = token.slice(0, 6);

  const { data, error } = await supabaseAdmin
    .rpc("emitir_link_material_sistema", {
      p_jornada_id: jornadaId,
      p_token_hash: tokenHash,
      p_token_prefixo: tokenPrefixo,
    })
    .single();

  if (error || !data) {
    throw new Error(`falha_ao_emitir_link_material_sistema: ${error?.message}`);
  }

  return `${APP_URL}/p/m/${token}`;
}
