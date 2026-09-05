import { assinarCorpo } from "./assinatura";
import type { ProvedorSala } from "./tipos";

const TIMEOUT_MS = 10_000;

function url(): string | null {
  return process.env.N8N_WEBHOOK_SALA_URL?.trim() || null;
}

function segredo(): string | null {
  return process.env.INTEGRACOES_WEBHOOK_SECRET?.trim() || null;
}

/**
 * Adaptador n8n: POST assinado (HMAC do corpo + timestamp, header
 * x-sichf-assinatura) na URL do workflow. O workflow cria a reunião e chama de
 * volta `POST /api/webhooks/n8n/sala` (assinado com o MESMO segredo).
 */
export const provedorSalaN8n: ProvedorSala = {
  nome: "n8n",
  configurado: () => Boolean(url()) && Boolean(segredo()),
  faltam: () => [...(url() ? [] : ["N8N_WEBHOOK_SALA_URL"]), ...(segredo() ? [] : ["INTEGRACOES_WEBHOOK_SECRET"])],
  async solicitar(pedido) {
    const destino = url();
    const chave = segredo();
    if (!destino || !chave) return { ok: false, erro: "nao_configurado" };

    const corpo = JSON.stringify(pedido);
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const resposta = await fetch(destino, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sichf-timestamp": timestamp,
          "x-sichf-assinatura": assinarCorpo(chave, timestamp, corpo),
        },
        body: corpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resposta.ok) return { ok: false, erro: `n8n_${resposta.status}` };
      const json = (await resposta.json().catch(() => null)) as { id?: string; executionId?: string } | null;
      return { ok: true, id_externo: json?.id ?? json?.executionId ?? null };
    } catch (erro) {
      return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
    }
  },
};
