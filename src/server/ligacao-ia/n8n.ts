import { APP_URL } from "@/lib/config-publica";
import { cabecalhosAssinados } from "@/server/integracoes/assinatura";
import type { PayloadLigacaoIaSaida } from "@/types/integracoes";
import type { ContextoDisparo, ProvedorLigacaoIa, ResultadoDisparo } from "./tipos";

/**
 * Adaptador n8n: POST assinado no LANCADOR (padrão do RSVP do seminário —
 * `RSVP · LANCADOR · dispara o DISPARO v3 por webhook`). O n8n é quem fala
 * com a Vapi; este repo nunca chama a Vapi diretamente.
 *
 * Contrato completo em docs/integracoes/n8n-ligacao-ia.md. O mesmo segredo
 * (`LIGACAO_IA_WEBHOOK_SECRET`) assina os dois sentidos desta integração.
 */
export const VARIAVEIS_N8N_LIGACAO = ["N8N_WEBHOOK_LIGACAO_URL", "LIGACAO_IA_WEBHOOK_SECRET", "VAPI_ASSISTENTE_ID"] as const;

const TIMEOUT_MS = 15_000;

export function faltamN8nLigacao(): string[] {
  return VARIAVEIS_N8N_LIGACAO.filter((nome) => !process.env[nome]?.trim());
}

export function n8nLigacaoConfigurado(): boolean {
  return faltamN8nLigacao().length === 0;
}

/**
 * A URL que o n8n usa para devolver o resultado da ligação.
 *
 * NÃO vai mais no payload do disparo (achado A1 do pentest, 06/09/2026): o
 * WEBHOOK lia esse valor de volta do `metadata` da Vapi, o que fazia do destino
 * de um POST assinado uma ENTRADA DE REDE. Hoje o destino é
 * `$vars.SICHF_CALLBACK_URL` no n8n. Esta função continua existindo para o
 * Admin → Integrações mostrar ao João qual valor colar na Variable — e é por
 * isso que ela é a mesma expressão de sempre.
 */
export function callbackUrlLigacao(): string {
  return `${APP_URL}/api/webhooks/n8n/ligacao`;
}

export function montarPayloadSaida(ctx: ContextoDisparo): PayloadLigacaoIaSaida {
  if (!ctx.oferta || ctx.oferta.horarios.length === 0) {
    throw new Error("sem_horarios_ofertados");
  }
  // Fase 7 · entrega 4: `assistente_id` NUNCA sai como null. O LANCADOR
  // repassaria `assistantId: null` à Vapi, que responderia 400 — a ligação
  // "falharia" por um motivo que na verdade é env var faltando no servidor.
  // Sem a env, a ligação cai no caminho manual como as outras duas
  // (`faltamN8nLigacao` já lista VAPI_ASSISTENTE_ID); este `throw` é a trava de
  // quem chamar `montarPayloadSaida` por fora de `provedorN8n.configurado()`.
  const assistenteId = process.env.VAPI_ASSISTENTE_ID?.trim();
  if (!assistenteId) throw new Error("n8n_nao_configurado: VAPI_ASSISTENTE_ID ausente");

  const [melhor, ...resto] = ctx.oferta.horarios;
  return {
    ligacao_id: ctx.ligacao.id,
    tentativa: ctx.ligacao.tentativa,
    nome: ctx.nome,
    primeiro_nome: ctx.nome.trim().split(/\s+/)[0] ?? ctx.nome,
    telefone: ctx.ligacao.telefone,
    assistente_id: assistenteId,
    melhor_horario: melhor,
    alternativas: resto.slice(0, 3),
    emitido_em: new Date().toISOString(),
  };
}

async function postarNoLancador(corpo: string): Promise<{ status: number; texto: string }> {
  const url = process.env.N8N_WEBHOOK_LIGACAO_URL?.trim();
  const segredo = process.env.LIGACAO_IA_WEBHOOK_SECRET?.trim();
  if (!url || !segredo) throw new Error("n8n_nao_configurado");

  const resposta = await fetch(url, {
    method: "POST",
    headers: cabecalhosAssinados(segredo, corpo),
    body: corpo,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await resposta.text().catch(() => "");
  return { status: resposta.status, texto: texto.slice(0, 500) };
}

export const provedorN8n: ProvedorLigacaoIa = {
  nome: "n8n",
  configurado: n8nLigacaoConfigurado,
  faltam: faltamN8nLigacao,
  async disparar(ctx): Promise<ResultadoDisparo> {
    const corpo = JSON.stringify(montarPayloadSaida(ctx));
    const { status, texto } = await postarNoLancador(corpo);
    if (status < 200 || status >= 300) {
      throw new Error(`n8n_${status}: ${texto || "sem corpo"}`);
    }
    let idExterno: string | null = null;
    try {
      const json = JSON.parse(texto || "{}") as { id_externo?: unknown; call_id?: unknown; id?: unknown };
      const candidato = json.id_externo ?? json.call_id ?? json.id;
      if (typeof candidato === "string" && candidato.length > 0) idExterno = candidato.slice(0, 200);
    } catch {
      // Resposta sem JSON é aceitável: o n8n confirma o `id_externo` depois, pelo evento `discando`.
    }
    return { tipo: "disparada", id_externo: idExterno };
  },
};

/** "Testar" do Admin → Integrações: manda um evento marcado `teste:true` ao LANCADOR. */
export async function testarN8nLigacao(): Promise<{ ok: boolean; detalhe: string }> {
  const faltam = faltamN8nLigacao();
  if (faltam.length > 0) return { ok: false, detalhe: `faltam: ${faltam.join(", ")}` };
  try {
    const corpo = JSON.stringify({ teste: true, ligacao_id: null, emitido_em: new Date().toISOString() });
    const { status, texto } = await postarNoLancador(corpo);
    // 401 aqui é informação, não ruído: desde 06/09 o LANCADOR recusa o ping
    // enquanto faltar qualquer das três Variables do n8n (o `motivo` vem no
    // corpo). Mostrar o motivo é o que faz o cartão do Admin servir para algo.
    const motivo = texto.match(/"motivo"\s*:\s*"([a-zA-Z0-9_]{1,80})"/)?.[1];
    return {
      ok: status >= 200 && status < 300,
      detalhe: `LANCADOR respondeu HTTP ${status}${motivo ? ` (${motivo})` : ""}`,
    };
  } catch (erro) {
    return { ok: false, detalhe: erro instanceof Error ? erro.message.slice(0, 200) : "erro desconhecido" };
  }
}
