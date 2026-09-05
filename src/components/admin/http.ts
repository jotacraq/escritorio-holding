/**
 * Núcleo HTTP dos clientes de API das telas Admin e Comunicação.
 *
 * Isolado de propósito de `src/lib/api.ts` (fronteira de outro agente).
 * `ApiError` é só importada para o resto do app (`<EstadoErro>`, `useToast`)
 * tratar o erro do mesmo jeito.
 *
 *   - `chamar<T>`: lança `ApiError` em qualquer resposta não-2xx. Uso normal.
 *   - `chamarBruto<T>`: NUNCA lança por status HTTP (só por falha de rede).
 *     Para fluxos em que um 503 é resultado de NEGÓCIO esperado (convite
 *     criado sem e-mail, preparar mensagem sem service_role).
 */

import { ApiError } from "@/lib/api";

export interface CorpoErroApi {
  erro?: string;
  mensagem?: string;
  detalhes?: unknown;
}

async function lerCorpo(resposta: Response): Promise<unknown> {
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

async function fazerRequisicao(caminho: string, init?: RequestInit): Promise<{ status: number; corpo: unknown }> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }
  const corpo = await lerCorpo(resposta);
  return { status: resposta.status, corpo };
}

export function erroDaResposta(status: number, corpo: unknown): ApiError {
  const objeto = (corpo ?? {}) as CorpoErroApi;
  const mensagem = objeto.mensagem || objeto.erro || `Falha na requisição (${status})`;
  return new ApiError(mensagem, status, objeto.erro, objeto.detalhes);
}

export async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const { status, corpo } = await fazerRequisicao(caminho, init);
  if (status < 200 || status >= 300) throw erroDaResposta(status, corpo);
  return corpo as T;
}

export async function chamarBruto<T>(caminho: string, init?: RequestInit): Promise<{ status: number; corpo: T | null }> {
  const { status, corpo } = await fazerRequisicao(caminho, init);
  return { status, corpo: corpo as T | null };
}

/** Texto humano de um erro de API para toast/aviso — nunca JSON cru. */
export function mensagemDeErro(erro: unknown, padrao: string): string {
  if (erro instanceof ApiError) {
    if (erro.status === 0) return erro.message;
    if (erro.status === 401) return "Sua sessão expirou. Entre de novo para continuar.";
    if (erro.status === 403) return "Seu perfil não tem permissão para esta ação.";
    if (erro.status === 503) return erro.message || "Serviço indisponível no servidor neste momento.";
    return erro.message || padrao;
  }
  return padrao;
}
