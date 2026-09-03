/**
 * Cliente HTTP do domínio de disponibilidade/bloqueio/slots (F-2A, front).
 * Arquivo próprio pelo mesmo motivo de `src/components/importacao/api.ts`:
 * `src/lib/api.ts` é fronteira de outro agente e ainda não conhece
 * `/api/disponibilidades/**`/`/api/agenda/slots`. Reusa a classe `ApiError`
 * de lá (só leitura de tipo/classe, nunca edição) para `EstadoErro` mostrar
 * a mensagem real.
 */

import { ApiError } from "@/lib/api";
import type {
  AgendaBloqueio,
  CorpoAtualizarDisponibilidade,
  CorpoCriarBloqueio,
  CorpoCriarDisponibilidade,
  Disponibilidade,
  SlotDisponivel,
} from "@/types/agenda";

export { ApiError };

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
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
    const mensagem = objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`;
    throw new ApiError(mensagem, resposta.status, objeto.erro);
  }

  return corpo as T;
}

function paraQueryString(params: Record<string, string | number | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : "";
}

export function listarDisponibilidades(params: { advogada_id?: string } = {}) {
  return chamar<{ disponibilidades: Disponibilidade[] }>(`/api/disponibilidades${paraQueryString(params)}`);
}

export function criarDisponibilidade(corpo: CorpoCriarDisponibilidade) {
  return chamar<{ disponibilidade: Disponibilidade }>("/api/disponibilidades", {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

export function atualizarDisponibilidade(id: string, corpo: CorpoAtualizarDisponibilidade) {
  return chamar<{ disponibilidade: Disponibilidade }>(`/api/disponibilidades/${id}`, {
    method: "PATCH",
    body: JSON.stringify(corpo),
  });
}

export function listarBloqueios(params: { advogada_id?: string; incluir_cancelados?: boolean } = {}) {
  return chamar<{ bloqueios: AgendaBloqueio[] }>(
    `/api/disponibilidades/bloqueios${paraQueryString({
      advogada_id: params.advogada_id,
      incluir_cancelados: params.incluir_cancelados ? "true" : undefined,
    })}`,
  );
}

export function criarBloqueio(corpo: CorpoCriarBloqueio) {
  return chamar<{ bloqueio: AgendaBloqueio }>("/api/disponibilidades/bloqueios", {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

export function cancelarBloqueio(id: string) {
  return chamar<{ bloqueio: AgendaBloqueio }>(`/api/disponibilidades/bloqueios/${id}`, { method: "PATCH" });
}

export function listarSlotsDisponiveis(params: { advogada_id: string; de?: string; ate?: string }) {
  return chamar<{ slots: SlotDisponivel[] }>(`/api/agenda/slots${paraQueryString(params)}`);
}
