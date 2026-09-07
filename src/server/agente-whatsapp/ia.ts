import type { SupabaseClient } from "@supabase/supabase-js";
import { executarComAuditoria } from "@/server/ia/executar";
import { registrarErro } from "@/server/erros";
import { AgenteRespostaSchema, MAX_ENTRADA, validarSaidaIa, type SaidaAgenteValidada } from "./schema";
import { contemTermoProibido } from "./respostas";

/**
 * A camada de IA do agente — a MENOR possível.
 *
 * Quando ela roda: só quando nenhuma regra determinística bateu E a pessoa tem
 * consentimento `tratamento_ia` (B56). A maioria das intenções (documento,
 * confirmação, preço, jurídico, falar com humano, o que falta) responde com
 * texto fixo: custo zero, alucinação zero.
 *
 * O QUE VAI PARA O MODELO (D20, e nada além):
 *   - o texto da última mensagem do cliente, recortado em 500 caracteres;
 *   - o passo atual, em RÓTULO ("Enviar documentos");
 *   - o que falta, em RÓTULO ("imposto de renda", "contrato social").
 * Nunca patrimônio, nunca valor, nunca nome de familiar, nunca histórico da
 * conversa, nunca telefone, nunca e-mail. `hash_entrada` já é gravado por
 * `executarComAuditoria`.
 *
 * ORÇAMENTO PRÓPRIO (C3/D19): o agente NÃO passa por `verificar_cooldown_ia`.
 * Aquela trava tem cooldown de 600 s POR JORNADA — calaria o agente na segunda
 * mensagem do cliente — e o teto diário compara `criado_por = p_perfil` com um
 * perfil que o agente não tem (`NULL = NULL` nunca é verdadeiro), então nunca
 * dispararia. Trava errada aperta, trava certa não existe. Aqui a conta é
 * feita ANTES, em `execucoes_ia`, pelo `prompt_versao_id` deste agente.
 */

export const CHAVE_PROMPT_AGENTE = "agente_whatsapp_onboarding";

export interface EntradaIaAgente {
  mensagem: string;
  passo: string;
  faltam: string[];
}

export type ResultadoIaAgente =
  | { situacao: "ok"; saida: Extract<SaidaAgenteValidada, { ok: true }>; execucaoId: string; custoUsd: number | null; promptVersao: number }
  /** O modelo respondeu, mas a saída não passou no parser — NÃO envia, abre tarefa. */
  | { situacao: "recusada"; motivo: string; execucaoId: string | null }
  /** Não chegou a rodar: prompt inativo, orçamento estourado, provedor fora. */
  | { situacao: "indisponivel"; motivo: string };

/** ISO do início do dia em America/Sao_Paulo — a janela do orçamento diário. */
export function inicioDoDiaSp(agora: number = Date.now()): string {
  const emSp = new Date(agora - 3 * 3_600_000); // UTC-3, sem DST desde 2019
  const iso = emSp.toISOString().slice(0, 10);
  return `${iso}T03:00:00.000Z`;
}

export interface OrcamentoAgente {
  dentro: boolean;
  noDia: number;
  naJornadaNoDia: number;
  motivo: string | null;
}

/**
 * Quantas execuções deste prompt já rodaram hoje (total e nesta jornada).
 * Índice `idx_execucoes_ia_prompt_dia` (0089) sustenta as duas contagens.
 *
 * Falha de leitura devolve `dentro: false`: não saber quanto já se gastou não
 * pode virar licença para gastar.
 */
export async function conferirOrcamento(
  admin: SupabaseClient,
  params: { jornadaId: string; tetoDia: number; tetoJornadaDia: number; agora?: number },
): Promise<OrcamentoAgente> {
  const desde = inicioDoDiaSp(params.agora);
  try {
    const { data: prompt } = await admin
      .from("prompts_versoes")
      .select("id")
      .eq("chave", CHAVE_PROMPT_AGENTE)
      .returns<Array<{ id: string }>>();
    const ids = (prompt ?? []).map((p) => p.id);
    if (ids.length === 0) return { dentro: false, noDia: 0, naJornadaNoDia: 0, motivo: "prompt_do_agente_inexistente" };

    const total = await admin
      .from("execucoes_ia")
      .select("id", { count: "exact", head: true })
      .in("prompt_versao_id", ids)
      .gte("criado_em", desde);
    if (total.error) throw total.error;

    const daJornada = await admin
      .from("execucoes_ia")
      .select("id", { count: "exact", head: true })
      .in("prompt_versao_id", ids)
      .eq("jornada_id", params.jornadaId)
      .gte("criado_em", desde);
    if (daJornada.error) throw daJornada.error;

    const noDia = total.count ?? 0;
    const naJornadaNoDia = daJornada.count ?? 0;
    if (noDia >= params.tetoDia) return { dentro: false, noDia, naJornadaNoDia, motivo: "teto_ia_dia" };
    if (naJornadaNoDia >= params.tetoJornadaDia) return { dentro: false, noDia, naJornadaNoDia, motivo: "teto_ia_jornada_dia" };
    return { dentro: true, noDia, naJornadaNoDia, motivo: null };
  } catch (erro) {
    registrarErro("agente-whatsapp/ia.conferirOrcamento", erro, { jornada_id: params.jornadaId });
    return { dentro: false, noDia: 0, naJornadaNoDia: 0, motivo: "falha_ao_contar_orcamento" };
  }
}

/**
 * Roda o classificador/redator. `criadoPor: null` (B64 — autor é o sistema).
 *
 * `isentoCooldown: true` é HARD-CODED aqui e nunca vem de corpo de requisição:
 * o agente tem o orçamento próprio conferido logo acima, e passar pela trava de
 * 600 s por jornada o calaria na segunda mensagem (C3). Nenhuma rota HTTP
 * consegue setar esta flag — quem a seta é este módulo, com valor literal.
 */
export async function redigirComIa(
  admin: SupabaseClient,
  params: { jornadaId: string; entrada: EntradaIaAgente; tetoDia: number; tetoJornadaDia: number; agora?: number },
): Promise<ResultadoIaAgente> {
  const orcamento = await conferirOrcamento(admin, {
    jornadaId: params.jornadaId,
    tetoDia: params.tetoDia,
    tetoJornadaDia: params.tetoJornadaDia,
    agora: params.agora,
  });
  if (!orcamento.dentro) {
    return { situacao: "indisponivel", motivo: orcamento.motivo ?? "orcamento" };
  }

  try {
    const resultado = await executarComAuditoria(admin, {
      chavePrompt: CHAVE_PROMPT_AGENTE,
      jornadaId: params.jornadaId,
      criadoPor: null,
      prefixoUsuario: "Mensagem do cliente e contexto do passo (JSON):",
      entrada: {
        mensagem: params.entrada.mensagem.slice(0, MAX_ENTRADA),
        passo: params.entrada.passo,
        faltam: params.entrada.faltam.slice(0, 6),
      },
      schema: AgenteRespostaSchema,
      nomeSchema: "agente_whatsapp_resposta",
      maxTokens: 400,
      isentoCooldown: true,
    });

    const validada = validarSaidaIa(resultado.saida);
    if (!validada.ok) {
      return { situacao: "recusada", motivo: validada.motivo, execucaoId: resultado.execucaoId };
    }

    // Trava de CONTEÚDO na saída (pentest da Fase 9, BAIXO 3): o classificador
    // de entrada só pega jurídico/preço quando o cliente usa uma das palavras.
    // Reformulado, o texto chega ao modelo e a única defesa vira a instrução
    // do prompt — probabilística. Aqui a frase gerada é varrida com a MESMA
    // lista: falou de valor ou de imposto, não sai.
    const proibido = contemTermoProibido(validada.resposta);
    if (proibido) {
      return { situacao: "recusada", motivo: `conteudo_proibido_${proibido}`, execucaoId: resultado.execucaoId };
    }
    return {
      situacao: "ok",
      saida: validada,
      execucaoId: resultado.execucaoId,
      custoUsd: resultado.custoUsd,
      promptVersao: resultado.promptVersao,
    };
  } catch (erro) {
    // Prompt inativo (0090 nasce `ativo=false`) cai aqui como
    // `prompt_ativo_nao_encontrado` — e isso NÃO é incidente: é o estado normal
    // até o João ligar. Nada é enviado; o caminho fixo já respondeu ou a tarefa
    // já foi aberta por quem chamou.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    if (!mensagem.includes("prompt_ativo_nao_encontrado")) {
      registrarErro("agente-whatsapp/ia.redigirComIa", erro, { jornada_id: params.jornadaId });
    }
    return { situacao: "indisponivel", motivo: mensagem.slice(0, 120) };
  }
}
