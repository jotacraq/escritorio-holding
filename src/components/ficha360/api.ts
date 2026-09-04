/**
 * Camada de acesso à API da Ficha 360 para as rotas da Fase 2 (F-3A) que
 * `src/lib/api.ts` ainda não expõe: links públicos, material pós-sessão e
 * roteiro ativo (POP 03-B). Mesmo padrão de `src/components/sessao/api.ts`
 * (wrapper fino, tipado, propaga erro para a tela decidir o estado) — fica
 * neste arquivo, e não em `src/lib/api.ts`, porque a fronteira desta entrega
 * não inclui editar aquele arquivo.
 */

import type { ChaveRoteiro, RoteiroVersao } from "@/types/roteiro";
import type {
  LinkPublicoResumo,
  RespostaEmitirLinkPublico,
  RespostaListarLinksPublicos,
  RespostaRevogarLinkPublico,
  TipoLinkPublico,
} from "@/types/publico";
import type {
  MaterialGeradoResumo,
  RespostaAprovarMaterial,
  RespostaGerarMaterial,
  RespostaListarMateriais,
} from "@/types/material";

export class ErroFicha360Api extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroFicha360Api";
  }
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
    throw new ErroFicha360Api("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
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
    throw new ErroFicha360Api(objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`, resposta.status, objeto.erro);
  }

  return corpo as T;
}

// ---------------------------------------------------------------------------
// Roteiro ativo (0030) — POP 03 e POP 03-B, mesma porta. As duas chaves já
// nasceram semeadas na 0030 (`pop_03` e `pop_03b`); LigacaoAba passou a
// buscar as duas por aqui em vez de manter o POP 03 hardcoded no componente.
// ---------------------------------------------------------------------------

export function buscarRoteiroAtivo(chave: ChaveRoteiro): Promise<RoteiroVersao> {
  return chamar<{ roteiro: RoteiroVersao }>(`/api/roteiros/ativa?chave=${encodeURIComponent(chave)}`).then((d) => d.roteiro);
}

// ---------------------------------------------------------------------------
// Links públicos (0028) — GET/POST /api/jornadas/[id]/links, POST /api/links/[id]/revogar
// ---------------------------------------------------------------------------

export function listarLinks(jornadaId: string): Promise<LinkPublicoResumo[]> {
  return chamar<RespostaListarLinksPublicos>(`/api/jornadas/${jornadaId}/links`).then((d) => d.itens);
}

export function emitirLink(jornadaId: string, tipo: TipoLinkPublico): Promise<RespostaEmitirLinkPublico> {
  return chamar<RespostaEmitirLinkPublico>(`/api/jornadas/${jornadaId}/links`, {
    method: "POST",
    body: JSON.stringify({ tipo }),
  });
}

export function revogarLink(linkId: string): Promise<LinkPublicoResumo> {
  return chamar<RespostaRevogarLinkPublico>(`/api/links/${linkId}/revogar`, { method: "POST" }).then((d) => d.link);
}

// ---------------------------------------------------------------------------
// Material pós-sessão (0031) — GET/POST /api/jornadas/[id]/material, POST .../aprovar
// ---------------------------------------------------------------------------

export function listarMateriais(jornadaId: string): Promise<RespostaListarMateriais> {
  return chamar<RespostaListarMateriais>(`/api/jornadas/${jornadaId}/material`);
}

export function gerarMaterial(jornadaId: string, forcarRegeracao = false): Promise<RespostaGerarMaterial> {
  return chamar<RespostaGerarMaterial>(`/api/jornadas/${jornadaId}/material`, {
    method: "POST",
    body: JSON.stringify({ forcar_regeracao: forcarRegeracao }),
  });
}

export function aprovarMaterial(jornadaId: string, materialId: string): Promise<MaterialGeradoResumo> {
  return chamar<RespostaAprovarMaterial>(`/api/jornadas/${jornadaId}/material/${materialId}/aprovar`, {
    method: "POST",
  }).then((d) => d.material);
}
