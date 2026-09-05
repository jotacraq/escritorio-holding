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

export function callbackUrlLigacao(): string {
  return `${APP_URL}/api/webhooks/n8n/ligacao`;
}

export function montarPayloadSaida(ctx: ContextoDisparo): PayloadLigacaoIaSaida {
  if (!ctx.oferta || ctx.oferta.horarios.length === 0) {
    throw new Error("sem_horarios_ofertados");
  }
  const [melhor, ...resto] = ctx.oferta.horarios;
  return {
    ligacao_id: ctx.ligacao.id,
    tentativa: ctx.ligacao.tentativa,
    nome: ctx.nome,
    primeiro_nome: ctx.nome.trim().split(/\s+/)[0] ?? ctx.nome,
    telefone: ctx.ligacao.telefone,
    assistente_id: process.env.VAPI_ASSISTENTE_ID?.trim() || null,
    melhor_horario: melhor,
    alternativas: resto.slice(0, 3),
    callback_url: callbackUrlLigacao(),
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
    const corpo = JSON.stringify({ teste: true, ligacao_id: null, callback_url: callbackUrlLigacao(), emitido_em: new Date().toISOString() });
    const { status } = await postarNoLancador(corpo);
    return { ok: status >= 200 && status < 300, detalhe: `LANCADOR respondeu HTTP ${status}` };
  } catch (erro) {
    return { ok: false, detalhe: erro instanceof Error ? erro.message.slice(0, 200) : "erro desconhecido" };
  }
}
