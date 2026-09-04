/**
 * Camada de acesso a `GET/POST /api/cnpj/[cnpj]` (Fase 3 §4 — dossiê público
 * de CNPJ). Arquivo novo e exclusivo deste agente (frontend-cnpj), ao lado de
 * `api.ts` — mesmo padrão dele (wrapper fino, tipado, propaga erro para a
 * tela decidir o estado), mas em módulo próprio: a fronteira desta entrega
 * não inclui editar `api.ts` nem `src/lib/api.ts` (ambos travados por outros
 * agentes/ondas — docs/ARQUITETURA-FASE-3.md §6).
 */

import type { ConsultaCnpj } from "@/types/cnpj";

export class ErroCnpjApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroCnpjApi";
  }
}

export interface RespostaCnpj {
  consulta: ConsultaCnpj;
  /** Só vem no GET — quantos dias até o cache ser considerado desatualizado. */
  validade_dias?: number;
  /** Servido do cache (GET sempre; POST quando dentro da validade ou quando a atualização falhou). */
  de_cache?: boolean;
  /** POST tentou atualizar, falhou, e devolveu o dado antigo em vez de erro (§4.4.3: falha nunca vira dado). */
  atualizacao_falhou?: boolean;
  falha_motivo?: string;
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ErroCnpjApi("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }

  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }

  if (!resposta.ok) {
    const objeto = (corpo ?? {}) as { erro?: string; mensagem?: string };
    throw new ErroCnpjApi(objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`, resposta.status, objeto.erro);
  }

  return corpo as T;
}

/**
 * Lê o cache — NUNCA chama a BrasilAPI (a rota GET não fala com a fonte
 * externa; ver `src/app/api/cnpj/[...cnpj]/route.ts`). `null` = este CNPJ
 * nunca foi consultado (404 da rota), estado normal, não um erro.
 */
export async function buscarCnpjEmCache(cnpj: string): Promise<RespostaCnpj | null> {
  try {
    return await chamar<RespostaCnpj>(`/api/cnpj/${cnpj}`);
  } catch (erro) {
    if (erro instanceof ErroCnpjApi && erro.status === 404) return null;
    throw erro;
  }
}

/**
 * Consulta a BrasilAPI (respeita frescor de `configuracoes['cnpj.validade_dias']`
 * a menos que `forcar: true`) e grava/atualiza o cache. Único caminho do
 * cliente que pode gastar a chamada externa — por isso só é chamado por um
 * clique explícito, nunca ao abrir a aba.
 */
export function consultarCnpjPublico(cnpj: string, jornadaId: string, forcar = false): Promise<RespostaCnpj> {
  return chamar<RespostaCnpj>(`/api/cnpj/${cnpj}`, {
    method: "POST",
    body: JSON.stringify({ jornada_id: jornadaId, forcar }),
  });
}
