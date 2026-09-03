import type { RascunhoFormularioPublico } from "@/types/publico-ui";

/**
 * Único uso de `localStorage` em toda a superfície pública, e só aqui: rascunho do próprio
 * formulário no aparelho do cliente (regra dura do projeto). Chaveado pelo token — não por
 * pessoa, não por jornada — porque é tudo que a página conhece.
 */
function chave(token: string): string {
  return `sic-hf:rascunho-formulario:${token}`;
}

export function lerRascunho(token: string): RascunhoFormularioPublico | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(chave(token));
    if (!bruto) return null;
    const dado = JSON.parse(bruto) as RascunhoFormularioPublico;
    if (dado && typeof dado === "object" && dado.respostas) return dado;
    return null;
  } catch {
    return null;
  }
}

export function salvarRascunho(token: string, respostas: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    const dado: RascunhoFormularioPublico = { respostas, atualizado_em: new Date().toISOString() };
    window.localStorage.setItem(chave(token), JSON.stringify(dado));
  } catch {
    // Aparelho com armazenamento cheio ou bloqueado (modo privado): perde só o rascunho, não a sessão.
  }
}

export function limparRascunho(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chave(token));
  } catch {
    // idem — silencioso de propósito, não é um erro que o cliente precisa ver.
  }
}
