import crypto from "node:crypto";

/**
 * Assinatura dos webhooks entre SIC-HF e n8n (as duas direções), §1.3/§12:
 *   x-sichf-timestamp:  epoch em segundos
 *   x-sichf-assinatura: "sha256=" + HMAC-SHA256(secret, `${timestamp}.${corpo}`)
 * Janela de ±5 min contra replay. Comparação em tempo constante.
 */
export const JANELA_TIMESTAMP_SEGUNDOS = 5 * 60;

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
  const diferenca = Math.abs(agoraMs / 1000 - Number(timestamp));
  return diferenca <= JANELA_TIMESTAMP_SEGUNDOS;
}

export function verificarAssinatura(segredo: string, timestamp: string, corpo: string, assinaturaRecebida: string): boolean {
  if (!timestampDentroDaJanela(timestamp)) return false;
  return segredosIguais(assinarCorpo(segredo, timestamp, corpo), assinaturaRecebida);
}
