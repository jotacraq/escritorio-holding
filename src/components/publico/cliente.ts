/**
 * Camada de acesso à superfície pública (`/api/publico/[token]/**`).
 *
 * Deliberadamente separada de `src/lib/api.ts`: aquela camada manda `credentials: "include"`
 * (sessão Supabase) e serve a equipe autenticada. Aqui não existe sessão nem cookie — a página
 * pública nunca monta cliente de sessão (docs/ARQUITETURA-FASE-2.md §2.5) — então o único
 * "crachá" de cada requisição é o token que já está na URL.
 *
 * Erro de link é sempre o mesmo objeto (`{erro:'link_invalido'}`, ver `src/types/publico-ui.ts`).
 * Esta camada não tenta adivinhar o motivo — só repassa o que a rota disser, ou classifica como
 * `erro_desconhecido` quando a resposta não é JSON (rota fora do ar, 500 de proxy, etc.), porque
 * o backend público ainda está em construção em paralelo (B-1A).
 */

import type {
  AberturaAgendamentoPublico,
  AberturaDocumentosPublico,
  AberturaFormularioPublico,
  AberturaMaterialPublico,
  CorpoEscolherHorarioPublico,
  CorpoResponderFormularioPublico,
  ErroPublico,
  RespostaEscolherHorarioPublico,
  RespostaRegistrarDocumentoPublico,
  RespostaResponderFormularioPublico,
  TipoDocumentoPublico,
  TipoLinkPublico,
} from "@/types/publico-ui";

export class ErroLinkPublico extends Error {
  codigo: ErroPublico["erro"];
  constructor(codigo: ErroPublico["erro"]) {
    super(codigo);
    this.name = "ErroLinkPublico";
    this.codigo = codigo;
  }
}

async function lerCorpo<T>(resposta: Response): Promise<T> {
  try {
    return (await resposta.json()) as T;
  } catch {
    throw new ErroLinkPublico("erro_desconhecido");
  }
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ErroLinkPublico("erro_desconhecido");
  }

  if (!resposta.ok) {
    const corpo = await lerCorpo<Partial<ErroPublico>>(resposta).catch(() => ({}) as Partial<ErroPublico>);
    const codigo = corpo.erro;
    const codigosConhecidos: ErroPublico["erro"][] = [
      "link_invalido",
      "limite_excedido",
      "horario_indisponivel",
      "envio_indisponivel",
      "arquivo_invalido",
      "erro_desconhecido",
    ];
    throw new ErroLinkPublico(codigo && codigosConhecidos.includes(codigo) ? codigo : "erro_desconhecido");
  }

  return lerCorpo<T>(resposta);
}

function caminhoAbertura(token: string): string {
  return `/api/publico/${encodeURIComponent(token)}`;
}

export function abrirLinkFormulario(token: string) {
  return chamar<AberturaFormularioPublico>(caminhoAbertura(token));
}
export function abrirLinkAgendamento(token: string) {
  return chamar<AberturaAgendamentoPublico>(caminhoAbertura(token));
}
export function abrirLinkDocumentos(token: string) {
  return chamar<AberturaDocumentosPublico>(caminhoAbertura(token));
}
export function abrirLinkMaterial(token: string) {
  return chamar<AberturaMaterialPublico>(caminhoAbertura(token));
}

/** Verifica que o link aberto é do tipo esperado pela rota — divergência vira link_invalido (§2.2, regra 3: sem oráculo). */
export function conferirTipo<T extends { tipo: TipoLinkPublico }>(abertura: T, esperado: TipoLinkPublico): T {
  if (abertura.tipo !== esperado) throw new ErroLinkPublico("link_invalido");
  return abertura;
}

export function responderFormularioPublico(token: string, corpo: CorpoResponderFormularioPublico) {
  return chamar<RespostaResponderFormularioPublico>(`/api/publico/${encodeURIComponent(token)}/formulario`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

export function escolherHorarioPublico(token: string, corpo: CorpoEscolherHorarioPublico) {
  return chamar<RespostaEscolherHorarioPublico>(`/api/publico/${encodeURIComponent(token)}/horario`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

/**
 * Upload multipart via `XMLHttpRequest` (não `fetch`): é a única API do navegador que expõe
 * progresso de envio, e o método pede "arrastar ou escolher, com progresso" explicitamente.
 * `service_role` ausente no servidor responde 503 → mapeado para `envio_indisponivel`, nunca
 * um sucesso fingido (§2.4).
 */
export function enviarDocumentoPublico(
  token: string,
  arquivo: File,
  tipo: TipoDocumentoPublico,
  aoProgredir: (percentual: number) => void,
): Promise<RespostaRegistrarDocumentoPublico> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/publico/${encodeURIComponent(token)}/documento`);

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };

    xhr.onerror = () => reject(new ErroLinkPublico("erro_desconhecido"));

    xhr.onload = () => {
      let corpo: unknown = null;
      try {
        corpo = JSON.parse(xhr.responseText);
      } catch {
        reject(new ErroLinkPublico("erro_desconhecido"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(corpo as RespostaRegistrarDocumentoPublico);
        return;
      }
      const codigo = (corpo as Partial<ErroPublico>)?.erro;
      const codigosConhecidos: ErroPublico["erro"][] = [
        "link_invalido",
        "limite_excedido",
        "envio_indisponivel",
        "arquivo_invalido",
        "erro_desconhecido",
      ];
      reject(new ErroLinkPublico(codigo && codigosConhecidos.includes(codigo) ? codigo : "erro_desconhecido"));
    };

    const forma = new FormData();
    forma.append("arquivo", arquivo);
    forma.append("tipo", tipo);
    xhr.send(forma);
  });
}
