/**
 * Cliente HTTP do domínio de importação (F-2A, front). Arquivo próprio —
 * `src/lib/api.ts` é fronteira de outro agente (não editar) e ainda não
 * conhece `/api/importacoes/**`. Reusa a CLASSE `ApiError` de lá (só
 * importar, não editar): é o que `EstadoErro`/`EstadoIndisponivel`
 * (`src/components/ui/Estado.tsx`) sabem reconhecer via `instanceof` para
 * mostrar a mensagem real em vez de um genérico "erro inesperado".
 *
 * `criarImportacao` usa `XMLHttpRequest` (não `fetch`) só para poder reportar
 * progresso real do upload em arquivo grande — é o pedido explícito de
 * "arquivo grande: dê retorno de progresso, não trave a tela". O resto usa
 * `fetch`, igual ao restante do projeto.
 */

import { ApiError } from "@/lib/api";
import type { Importacao, ImportacaoLinha, MapaColunas, ResultadoLinhaImportacao } from "@/types/importacao";

export { ApiError };

interface CorpoErro {
  erro?: string;
  mensagem?: string;
  detalhes?: unknown;
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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
    const objeto = (corpo ?? {}) as CorpoErro;
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

export function listarImportacoes(params: { edicao_id?: string; status?: string; pagina?: number } = {}) {
  return chamar<{ itens: Importacao[]; total: number }>(`/api/importacoes${paraQueryString(params)}`);
}

export function buscarImportacao(id: string) {
  return chamar<{ importacao: Importacao }>(`/api/importacoes/${id}`);
}

export function listarLinhasImportacao(
  id: string,
  params: { resultado?: ResultadoLinhaImportacao; pagina?: number } = {},
) {
  return chamar<{ itens: ImportacaoLinha[]; total: number }>(`/api/importacoes/${id}/linhas${paraQueryString(params)}`);
}

export function confirmarImportacao(id: string) {
  return chamar<{ importacao: Importacao }>(`/api/importacoes/${id}/confirmar`, { method: "POST" });
}

export function cancelarImportacao(id: string) {
  return chamar<{ importacao: Importacao }>(`/api/importacoes/${id}/cancelar`, { method: "POST" });
}

/**
 * Fase 1: sobe o CSV + mapa de colunas, com progresso real de upload.
 * `aoProgredir` recebe 0-100 do ENVIO do arquivo (não do processamento do
 * servidor, que acontece depois, síncrono, sem barra própria — o chamador
 * mostra um estado "processando" nesse intervalo).
 */
export function criarImportacao(
  params: { arquivo: File; edicaoId: string; mapaColunas: MapaColunas },
  aoProgredir?: (percentual: number) => void,
): Promise<{ importacao: Importacao }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("arquivo", params.arquivo);
    formData.append("edicao_id", params.edicaoId);
    formData.append("mapa_colunas", JSON.stringify(params.mapaColunas));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/importacoes");
    xhr.withCredentials = true;

    xhr.upload.onprogress = (evento) => {
      if (!aoProgredir || !evento.lengthComputable) return;
      aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };

    xhr.onerror = () => reject(new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede"));

    xhr.onload = () => {
      let corpo: unknown = null;
      try {
        corpo = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        corpo = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(corpo as { importacao: Importacao });
        return;
      }

      const objeto = (corpo ?? {}) as CorpoErro;
      const mensagem = objeto.mensagem || objeto.erro || `Falha no envio (${xhr.status})`;
      reject(new ApiError(mensagem, xhr.status, objeto.erro));
    };

    xhr.send(formData);
  });
}
