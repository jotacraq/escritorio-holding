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
 * certos para ele. Este módulo não toca neles em VALOR — mas, desde a Fase
 * 11, PASSA um `AbortSignal` para eles (fronteira aberta de forma 100%
 * ADITIVA: `PedidoIa.signal`/`ParamsExecutarComAuditoria.signal`, opcionais —
 * nenhum outro chamador de `executarComAuditoria` passa este campo).
 *
 * 🔴 CORREÇÃO (Fase 11, medido em produção — 15 execuções reais): a versão
 * anterior deste módulo usava `Promise.race([chamada, espera])` e, quando o
 * timer de 8s vencia, a chamada real CONTINUAVA em voo até 300s à toa — 2 de
 * 14 execuções estouraram o timeout (9.642 e 8.948 ms) e AMBAS gravaram
 * `status='concluida'`, contando contra o teto e pagando tokens que ninguém
 * lê (US$0,0245 desperdiçados = 25% do gasto total medido do copiloto).
 * `falhou=0` na telemetria não significava "nada falhou" — significava que a
 * falha não era registrada.
 *
 * AGORA: `AbortController` + `setTimeout` reais. Quando os 8s vencem, o
 * `controller.abort()` propaga até o `fetch` do adaptador (via
 * `AbortSignal.any`, `openrouter.ts`) — a chamada é interrompida DE VERDADE
 * na rede, não só ignorada. A execução cai no `catch` de `executar.ts`, que
 * grava `execucoes_ia.status='falhou'` — o problema passa a ser VISÍVEL na
 * telemetria, em vez de mascarado como sucesso tardio.
 *
 * ⚠️ EXCEÇÃO DELIBERADA — o warm-up (`warmup.ts`) NÃO PODE abortar: o cache
 * do provedor só é escrito se o voo terminar (`warmup.ts:145-151`). Por isso
 * `abortarNoTimeout` é um parâmetro (default `true`) — `warmup.ts` chama com
 * `false`, mantendo o comportamento antigo (a chamada segue em voo, o
 * resultado tardio é descartado) só nesse único caminho.
 */
export const TIMEOUT_COPILOTO_MS = 8_000;

export type ResultadoExecucaoCopiloto =
  | { situacao: "ok"; saida: SugestaoCopilotoIa; execucaoId: string; custoUsd: number | null }
  | { situacao: "timeout" }
  /** Prompt inativo (0094 nasce `ativo=false`), recusa do modelo, saída fora
   * do schema, ou qualquer outra falha da camada de IA. */
  | { situacao: "indisponivel"; motivo: string };

/**
 * Roda o prompt do copiloto com o contexto montado (server/copiloto/contexto.ts),
 * sob o timeout de 8s. `jornadaId`/`criadoPor: null` (mesma convenção do
 * agente de WhatsApp: autor é o sistema). `isentoCooldown: true` é HARD-CODED
 * — o orçamento próprio já foi conferido pelo chamador
 * (server/copiloto/orcamento.ts) ANTES desta função ser chamada; nenhuma rota
 * HTTP consegue setar esta flag por fora.
 *
 * `abortarNoTimeout` (default `true`): quando `false` (só `warmup.ts`), o
 * timer de 8s ainda decide o RETORNO desta função (`situacao: 'timeout'`),
 * mas NÃO dispara `controller.abort()` — a chamada real segue em voo até
 * escrever o cache do provedor, exatamente como antes da Fase 11.
 */
export async function executarIaCopiloto(
  admin: SupabaseClient,
  params: { jornadaId: string; contexto: ContextoCopiloto; abortarNoTimeout?: boolean },
): Promise<ResultadoExecucaoCopiloto> {
  const abortarNoTimeout = params.abortarNoTimeout ?? true;
  const controller = new AbortController();

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
    // Só propaga o signal quando o abort de verdade é desejado — para o
    // warm-up (abortarNoTimeout=false), NENHUM signal chega ao adaptador,
    // então `AbortSignal.any` nem entra em jogo lá (openrouter.ts se
    // comporta como antes da Fase 11: só o timeout interno de 300s).
    signal: abortarNoTimeout ? controller.signal : undefined,
  });

  // O RETORNO desta função nunca espera além de 8s, com ou sem
  // `abortarNoTimeout` — é o mesmo contrato de antes da Fase 11 (a rota
  // nunca segura a resposta). O que muda é só se a CHAMADA REAL é
  // interrompida (`abortarNoTimeout=true`) ou segue em voo por conta própria
  // até escrever o cache do provedor (`abortarNoTimeout=false`, warm-up) —
  // por isso a corrida continua existindo aqui como um `Promise.race`
  // separado do abort: o abort decide o destino da CHAMADA, o timer decide o
  // destino do RETORNO, e os dois são independentes quando
  // `abortarNoTimeout=false`.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const espera = new Promise<"venceu_timeout">((resolve) => {
    timer = setTimeout(() => {
      if (abortarNoTimeout) controller.abort();
      resolve("venceu_timeout");
    }, TIMEOUT_COPILOTO_MS);
  });

  try {
    const corrida = await Promise.race([chamada, espera]);
    if (corrida === "venceu_timeout") {
      // A chamada real segue em voo (ou já foi abortada, se
      // abortarNoTimeout=true) — nunca a aguardamos aqui. Erro/sucesso tardio
      // dela, se houver, já é gravado pelo próprio `executarComAuditoria`
      // (UPDATE execucoes_ia); não duplicamos o registro. Isto é necessário
      // MESMO com abortarNoTimeout=true: `controller.abort()` não interrompe
      // instantaneamente — ainda existe uma janela entre o `.abort()` e a
      // rejeição efetiva do `fetch`, e não podemos deixar essa rejeição
      // tardia derrubar o processo como unhandled rejection.
      chamada.catch(() => {
        /* resultado tardio (sucesso ou erro do abort): já não importa mais para esta chamada */
      });
      return { situacao: "timeout" };
    }

    const resultado = corrida;
    return { situacao: "ok", saida: resultado.saida, execucaoId: resultado.execucaoId, custoUsd: resultado.custoUsd };
  } catch (erro) {
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
