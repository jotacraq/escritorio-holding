import type { SugestaoCopilotoPolling } from "@/types/copiloto";

/**
 * Persiste o último valor NÃO-NULO de um campo do ciclo automático — achado
 * de 15/09 (painel de vigilância): os quadros 5, 6 e a observação do quadro
 * 2 liam sempre `sugestoesCiclo[sugestoesCiclo.length - 1]`; se a sugestão
 * mais recente não trazia aquele campo (ex.: o ciclo mandou uma observação
 * do tipo `fato`, sem `desvio_sugerido`), o valor que já estava na tela era
 * APAGADO no meio da reunião, mesmo sem nenhuma mudança real — dado que
 * "some sozinho" é tão ruim quanto dado inventado (regra da casa).
 *
 * Percorre de trás para frente e devolve o primeiro onde `extrair` encontra
 * algo — junto com QUAL sugestão originou o valor (`sugestaoId`, usado pela
 * telemetria de desfecho do quadro 6) e QUANDO (`criadoEm`, usado pelo
 * carimbo de hora da tarefa 7, para não fingir que um valor antigo é novo).
 *
 * ⚠️ Só considera `s.visivel === true`: uma sugestão abaixo da confiança
 * mínima é GRAVADA pelo servidor, mas ele decidiu escondê-la
 * (`route.ts:133`) — mostrar o valor dela aqui contrariaria a régua de
 * confiança por um caminho lateral, mesmo que a sugestão mais recente
 * visível seja mais antiga.
 *
 * Função pura, sem dependência de React — testável isoladamente.
 */
export function ultimoNaoNulo<T>(
  sugestoes: SugestaoCopilotoPolling[],
  extrair: (s: SugestaoCopilotoPolling) => T | null | undefined,
): { valor: T; sugestaoId: string; criadoEm: string } | null {
  for (let i = sugestoes.length - 1; i >= 0; i -= 1) {
    const s = sugestoes[i];
    if (!s.visivel) continue;
    const valor = extrair(s);
    if (valor != null) return { valor, sugestaoId: s.sugestao_id, criadoEm: s.criado_em };
  }
  return null;
}
