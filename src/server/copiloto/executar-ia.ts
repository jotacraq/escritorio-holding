import type { SupabaseClient } from "@supabase/supabase-js";
import { executarComAuditoria } from "@/server/ia/executar";
import { registrarErro } from "@/server/erros";
import { SugestaoCopilotoIaSchema, type SugestaoCopilotoIa } from "./schema";
import type { ContextoCopiloto } from "@/types/copiloto";
import { CHAVE_PROMPT_COPILOTO } from "./orcamento";

/**
 * Timeout PRÓPRIO do copiloto — 8s (§4.3 do plano, CONFLITO C3: "IA_TIMEOUT_MS
 * global é 300s e isso é veneno aqui"). `IA_TIMEOUT_MS`/os adaptadores de
 * provedor (`server/ia/provedor/{openrouter,anthropic}.ts`) NÃO mudam — são
 * calibrados para o Briefing (até 100,8s medido em produção) e continuam
 * certos para ele. Este módulo não toca neles (fora da fronteira: "usa, não
 * altera"); em vez disso, corre `executarComAuditoria` contra um timer local
 * com `Promise.race`.
 *
 * O QUE ACONTECE QUANDO O TIMER VENCE PRIMEIRO: a chamada real ao provedor
 * PODE continuar em voo (o `fetch` interno do adaptador só é abortado pelo
 * timeout dele, 300s) — `executarComAuditoria` eventualmente grava
 * `execucoes_ia` como concluída ou falha, tarde, em segundo plano. A rota,
 * porém, já respondeu ao cliente com `timeout_copiloto` no instante dos 8s:
 * nunca espera a chamada de verdade terminar, e nunca mostra essa sugestão
 * tardia como se fosse a de agora (§4.3: "nunca sugestão velha disfarçada de
 * nova" — é a TELA quem garante isso, ao nunca reconsultar essa execução
 * depois de já ter mostrado "não chegou a tempo"; o histórico continua
 * consultável via `execucoes_ia`/`copiloto_sugestoes` para auditoria).
 */
export const TIMEOUT_COPILOTO_MS = 8_000;

export type ResultadoExecucaoCopiloto =
  | { situacao: "ok"; saida: SugestaoCopilotoIa; execucaoId: string; custoUsd: number | null }
  | { situacao: "timeout" }
  /** Prompt inativo (0094 nasce `ativo=false`), recusa do modelo, saída fora
   * do schema, ou qualquer outra falha da camada de IA. */
  | { situacao: "indisponivel"; motivo: string };

class TimeoutCopiloto extends Error {
  constructor() {
    super("timeout_copiloto");
    this.name = "TimeoutCopiloto";
  }
}

/**
 * Roda o prompt do copiloto com o contexto montado (server/copiloto/contexto.ts),
 * sob o timeout de 8s. `jornadaId`/`criadoPor: null` (mesma convenção do
 * agente de WhatsApp: autor é o sistema). `isentoCooldown: true` é HARD-CODED
 * — o orçamento próprio já foi conferido pelo chamador
 * (server/copiloto/orcamento.ts) ANTES desta função ser chamada; nenhuma rota
 * HTTP consegue setar esta flag por fora.
 */
export async function executarIaCopiloto(
  admin: SupabaseClient,
  params: { jornadaId: string; contexto: ContextoCopiloto },
): Promise<ResultadoExecucaoCopiloto> {
  const chamada = executarComAuditoria(admin, {
    chavePrompt: CHAVE_PROMPT_COPILOTO,
    jornadaId: params.jornadaId,
    criadoPor: null,
    prefixoUsuario: "Contexto da sessão em curso (JSON):",
    entrada: params.contexto,
    schema: SugestaoCopilotoIaSchema,
    nomeSchema: "copiloto_sugestao",
    maxTokens: 900,
    isentoCooldown: true,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const espera = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutCopiloto()), TIMEOUT_COPILOTO_MS);
  });

  try {
    const resultado = await Promise.race([chamada, espera]);
    return { situacao: "ok", saida: resultado.saida, execucaoId: resultado.execucaoId, custoUsd: resultado.custoUsd };
  } catch (erro) {
    if (erro instanceof TimeoutCopiloto) {
      // A chamada real segue em voo — não aguardamos nem cancelamos aqui (o
      // adaptador não expõe cancelamento externo). Erro de execução tardia
      // dela, se houver, é gravado pelo próprio `executarComAuditoria`
      // (UPDATE execucoes_ia) — não duplicamos o registro aqui.
      chamada.catch(() => {
        /* resultado tardio: já não importa mais para esta requisição */
      });
      return { situacao: "timeout" };
    }

    const mensagem = erro instanceof Error ? erro.message : String(erro);
    // `prompt_ativo_nao_encontrado` é o estado NORMAL enquanto 0094 estiver
    // inativa — não é incidente, não registra em erros_servidor (mesma regra
    // do agente de WhatsApp).
    if (!mensagem.includes("prompt_ativo_nao_encontrado")) {
      registrarErro("copiloto/executar-ia.executarIaCopiloto", erro, { jornada_id: params.jornadaId });
    }
    return { situacao: "indisponivel", motivo: mensagem.slice(0, 200) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
