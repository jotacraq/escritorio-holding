import crypto from "node:crypto";

/**
 * Assinatura dos webhooks entre o SIC-HF e o n8n (os dois sentidos).
 *
 *   x-sichf-timestamp:  segundos Unix (string) do momento do envio
 *   x-sichf-assinatura: "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + corpo))
 *
 * A janela de ±5 min fecha replay de corpo antigo; a comparação é em tempo
 * constante. Quem chama decide o segredo (LIGACAO_IA_WEBHOOK_SECRET para a
 * ligação; INTEGRACOES_WEBHOOK_SECRET para a sala, do agente A).
 */

export const CABECALHO_TIMESTAMP = "x-sichf-timestamp";
export const CABECALHO_ASSINATURA = "x-sichf-assinatura";
export const JANELA_SEGUNDOS = 5 * 60;

export function assinarCorpo(segredo: string, timestamp: string, corpo: string): string {
  const hmac = crypto.createHmac("sha256", segredo).update(`${timestamp}.${corpo}`, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

export function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function timestampDentroDaJanela(timestamp: string, agoraMs = Date.now()): boolean {
  if (!/^\d{9,11}$/.test(timestamp)) return false;
  const enviado = Number(timestamp);
  return Math.abs(agoraMs / 1000 - enviado) <= JANELA_SEGUNDOS;
}

export type ResultadoVerificacao =
  | { valida: true }
  | { valida: false; motivo: "timestamp_ausente" | "timestamp_fora_da_janela" | "assinatura_ausente" | "assinatura_invalida" };

/** Verifica os dois cabeçalhos contra o corpo cru. Nunca lança. */
export function verificarAssinatura(params: {
  segredo: string;
  timestamp: string | null;
  assinatura: string | null;
  corpo: string;
}): ResultadoVerificacao {
  if (!params.timestamp) return { valida: false, motivo: "timestamp_ausente" };
  if (!timestampDentroDaJanela(params.timestamp)) return { valida: false, motivo: "timestamp_fora_da_janela" };
  if (!params.assinatura) return { valida: false, motivo: "assinatura_ausente" };
  const esperada = assinarCorpo(params.segredo, params.timestamp, params.corpo);
  if (!segredosIguais(params.assinatura, esperada)) return { valida: false, motivo: "assinatura_invalida" };
  return { valida: true };
}

/** Cabeçalhos prontos para um POST assinado SIC-HF → n8n. */
export function cabecalhosAssinados(segredo: string, corpo: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "Content-Type": "application/json",
    [CABECALHO_TIMESTAMP]: timestamp,
    [CABECALHO_ASSINATURA]: assinarCorpo(segredo, timestamp, corpo),
  };
}
