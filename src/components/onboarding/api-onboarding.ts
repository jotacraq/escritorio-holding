/**
 * Onboarding "primeira vez" (Fase 4 §6.3): a decisão do arquiteto é COLUNA
 * (`perfis_equipe.onboarding_visto_em`, 0052) via `GET/PATCH /api/equipe/me`
 * (agente A) — "dispensei" é fato sobre a pessoa, não sobre o navegador.
 *
 * Enquanto a rota não existe (404/405/501), este cliente cai para
 * `localStorage` e DIZ que caiu (`fonte: "local"`), para o relatório e a
 * tela não fingirem persistência que não há. Nenhum outro erro (401, 500,
 * rede) abre o tour: em dúvida, não incomoda.
 */
const CHAVE_LOCAL = "sic-hf-onboarding-visto-em";
const CHAVE_SESSAO = "sic-hf-onboarding-adiado";

export type FonteOnboarding = "api" | "local" | "desconhecida";

export interface EstadoOnboarding {
  visto: boolean;
  fonte: FonteOnboarding;
}

function lerLocal(): boolean {
  try {
    return Boolean(window.localStorage.getItem(CHAVE_LOCAL));
  } catch {
    return false;
  }
}

function gravarLocal() {
  try {
    window.localStorage.setItem(CHAVE_LOCAL, new Date().toISOString());
  } catch {
    /* navegador sem storage: o tour volta na próxima visita — melhor que quebrar. */
  }
}

/** "Depois" vale só nesta sessão do navegador: não repete o tour a cada troca de tela. */
export function adiarNestaSessao() {
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO, "1");
  } catch {
    /* sem storage, o tour pode voltar na próxima tela — aceitável. */
  }
}

export function foiAdiadoNestaSessao(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_SESSAO) === "1";
  } catch {
    return false;
  }
}

const ROTA_AUSENTE = new Set([404, 405, 501]);

export async function buscarEstadoOnboarding(): Promise<EstadoOnboarding> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/equipe/me", { credentials: "include" });
  } catch {
    return { visto: lerLocal(), fonte: "desconhecida" };
  }
  if (ROTA_AUSENTE.has(resposta.status)) return { visto: lerLocal(), fonte: "local" };
  if (!resposta.ok) return { visto: lerLocal(), fonte: "desconhecida" };
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }
  if (!corpo || typeof corpo !== "object") return { visto: lerLocal(), fonte: "desconhecida" };
  const objeto = corpo as Record<string, unknown>;
  const perfil = (objeto.perfil && typeof objeto.perfil === "object" ? (objeto.perfil as Record<string, unknown>) : objeto) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(perfil, "onboarding_visto_em")) {
    // A rota existe mas ainda não conhece a coluna — mesma tolerância da ausência.
    return { visto: lerLocal(), fonte: "local" };
  }
  return { visto: Boolean(perfil.onboarding_visto_em), fonte: "api" };
}

export async function marcarOnboardingVisto(): Promise<FonteOnboarding> {
  gravarLocal(); // cache local sempre — se a API gravar, melhor ainda.
  let resposta: Response;
  try {
    resposta = await fetch("/api/equipe/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_visto: true }),
    });
  } catch {
    return "desconhecida";
  }
  if (resposta.ok) return "api";
  if (ROTA_AUSENTE.has(resposta.status)) return "local";
  return "desconhecida";
}
