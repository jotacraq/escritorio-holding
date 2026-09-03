import type { ProvedorIa } from "./provedor/tipos";
import { provedorOpenRouter } from "./provedor/openrouter";
import { provedorAnthropic } from "./provedor/anthropic";

/**
 * Camada de IA do SIC-HF. Nenhum componente de UI importa este arquivo nem os
 * adaptadores de provedor — só rotas/serviços de servidor (via `executar.ts`).
 *
 * `IA_PROVEDOR` escolhe o adaptador (default `openrouter`, rota pinada só na
 * Anthropic — mesma cadeia de subprocessador de hoje). `IA_PROVEDOR=anthropic`
 * é o caminho de reversão sem deploy, direto ao SDK, para incidente.
 */

const PROVEDORES: Record<string, ProvedorIa> = {
  openrouter: provedorOpenRouter,
  anthropic: provedorAnthropic,
};

function nomeProvedorConfigurado(): string {
  const valor = process.env.IA_PROVEDOR?.trim().toLowerCase();
  return valor && valor in PROVEDORES ? valor : "openrouter";
}

/** Escolhe o adaptador conforme `IA_PROVEDOR` (default `openrouter`). */
export function resolverProvedor(): ProvedorIa {
  return PROVEDORES[nomeProvedorConfigurado()];
}

/** True quando o provedor resolvido está configurado. Usar SEMPRE antes de chamar a IA. */
export function iaConfigurada(): boolean {
  return resolverProvedor().configurado();
}

/** Modelos suportados pelo SIC-HF, conforme ARQUITETURA.md §4.1 (slug depende do provedor ativo). */
export type ModeloIa = "claude-opus-5" | "claude-sonnet-5";

export type EffortIa = "low" | "medium" | "high" | "xhigh" | "max";
