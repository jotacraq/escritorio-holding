import crypto from "node:crypto";
import { ErroApi } from "@/server/erros";

/**
 * O token de 256 bits NUNCA chega ao banco (regra dura 2, §2.2 do plano de Fase 2).
 * Tudo que persiste é `sha256(token || LINK_PUBLICO_PEPPER)`. O pepper vive só aqui —
 * no processo Next.js — e nunca em `configuracoes` nem em qualquer tabela.
 */
const TAMANHO_MINIMO_PEPPER = 16;

/**
 * Fail-closed: sem `LINK_PUBLICO_PEPPER` configurada (ou curta demais para servir de
 * segredo), `/api/publico/*` responde 503 e NUNCA processa nada — nunca finge sucesso.
 */
export function exigirPepper(): string {
  const pepper = process.env.LINK_PUBLICO_PEPPER;
  if (!pepper || pepper.length < TAMANHO_MINIMO_PEPPER) {
    throw new ErroApi(
      503,
      "servico_indisponivel",
      "Superfície pública indisponível: LINK_PUBLICO_PEPPER ausente ou inválida no servidor.",
    );
  }
  return pepper;
}

/** Gera o token bruto de 256 bits que vai na URL — nunca gravado, só devolvido uma vez. */
export function gerarToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string, pepper: string): string {
  return crypto.createHash("sha256").update(token + pepper, "utf8").digest("hex");
}

/** IP nunca em claro no banco (§2.2 regra 5) — só o hash entra em `links_publicos_acessos`. */
export function hashIp(ip: string, pepper: string): string {
  return crypto.createHash("sha256").update(ip + pepper, "utf8").digest("hex");
}
