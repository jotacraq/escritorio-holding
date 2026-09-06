/** Documentos sensíveis (Storage privado + URL assinada). */
import { ApiError, chamar } from "./nucleo";
import type { DocumentoTipoRadar } from "@/types/jornada-automacoes";

export interface Documento {
  id: string;
  /** Os 10 valores do CHECK depois da 0065 (radar de documentos, §8.3). */
  tipo: DocumentoTipoRadar;
  nome_arquivo: string;
  mime: string;
  tamanho_bytes: number;
  criado_em: string;
  /**
   * A qual bem/familiar o documento pertence (`patrimonio_itens.id` /
   * `familiares.id`), coluna da 0065. `undefined` quando o payload é de um
   * servidor anterior à migration; `null` quando o documento não tem item.
   */
  item_ref?: string | null;
}

/**
 * Upload de documento sensível. `itemRef` (0065) diz de QUAL bem/familiar é o
 * arquivo — sem ele o radar não casa a matrícula com o imóvel certo e o item
 * fica "a pedir" mesmo com o arquivo no Storage.
 */
export function enviarDocumento(
  pessoaId: string,
  jornadaId: string,
  arquivo: File,
  tipo: Documento["tipo"],
  aoProgredir?: (pct: number) => void,
  itemRef?: string | null,
) {
  return new Promise<{ documento_id: string }>((resolve, reject) => {
    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("pessoa_id", pessoaId);
    form.append("jornada_id", jornadaId);
    form.append("tipo", tipo);
    if (itemRef) form.append("item_ref", itemRef);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/documentos`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && aoProgredir) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };
    xhr.onload = () => {
      let corpo: { documento_id?: string; erro?: string } = {};
      try {
        corpo = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* resposta sem corpo JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && corpo.documento_id) {
        resolve({ documento_id: corpo.documento_id });
      } else {
        reject(new ApiError(corpo.erro || `Falha no envio (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Sem conexão com o servidor durante o envio.", 0, "rede"));
    xhr.send(form);
  });
}

export function buscarUrlAssinadaDocumento(id: string) {
  return chamar<{ url: string; expira_em: string }>(`/api/documentos/${id}/url`);
}
