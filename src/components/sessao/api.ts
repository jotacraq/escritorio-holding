/**
 * Camada de acesso à API do Modo Conduzir Sessão (F-3B, Fase 2 §4.3).
 *
 * Mesmo padrão de `src/components/conhecimento/api.ts`: wrapper fino, tipado,
 * que propaga erro para a tela decidir o estado (carregando/vazio/erro) —
 * nunca mock. Fica neste arquivo (e não em `src/lib/api.ts`) porque a
 * fronteira desta entrega não inclui editar aquele arquivo; ele já expõe
 * `buscarFicha360`/`listarJornadas`, que este módulo reusa por import.
 */

import type { PrecoCroqui } from "@/types/cenario";
import type {
  ChaveRoteiro,
  ConsentimentoGravacao,
  CondicaoOferta,
  Oferta,
  RoteiroVersao,
  SimIdentificador,
  SimsSessao,
} from "@/types/roteiro";

export class ErroSessao extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroSessao";
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
    throw new ErroSessao("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
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
    throw new ErroSessao(objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`, resposta.status, objeto.erro);
  }

  return corpo as T;
}

// ---------------------------------------------------------------------------
// Roteiros (0030) — GET /api/roteiros/ativa, GET /api/roteiros/[id]
// ---------------------------------------------------------------------------

export function buscarRoteiroAtivo(chave: ChaveRoteiro): Promise<RoteiroVersao> {
  return chamar<{ roteiro: RoteiroVersao }>(`/api/roteiros/ativa?chave=${encodeURIComponent(chave)}`).then(
    (d) => d.roteiro,
  );
}

export function buscarRoteiroPorId(id: string): Promise<RoteiroVersao> {
  return chamar<{ roteiro: RoteiroVersao }>(`/api/roteiros/${id}`).then((d) => d.roteiro);
}

// ---------------------------------------------------------------------------
// Os 4 SIMs (0030) — GET/POST /api/sessoes/[id]/sims
// ---------------------------------------------------------------------------

export interface EstadoSims {
  roteiro_versao_id: string | null;
  sims: SimsSessao;
  sigilo_gravacao: ConsentimentoGravacao | null;
}

export function buscarSims(sessaoId: string): Promise<EstadoSims> {
  return chamar<EstadoSims>(`/api/sessoes/${sessaoId}/sims`);
}

export interface RespostaRegistroSim {
  sessao: { id: string; roteiro_versao_id: string | null; sims: SimsSessao };
  sigilo_gravacao: ConsentimentoGravacao | null;
}

export function registrarSim(sessaoId: string, sim: SimIdentificador, confirmado: boolean): Promise<RespostaRegistroSim> {
  return chamar<RespostaRegistroSim>(`/api/sessoes/${sessaoId}/sims`, {
    method: "POST",
    body: JSON.stringify({ sim, confirmado }),
  });
}

// ---------------------------------------------------------------------------
// Ofertas (0011/0030) — GET/POST /api/jornadas/[id]/ofertas, PATCH .../[ofertaId]
// ---------------------------------------------------------------------------

export interface RespostaOfertas {
  itens: Oferta[];
  /** Bloco `preco` (Fase 4, B27) — `null` quando o servidor ainda não o devolve. */
  preco: PrecoCroqui | null;
}

export function listarOfertas(jornadaId: string): Promise<RespostaOfertas> {
  return chamar<{ itens: Oferta[]; preco?: PrecoCroqui }>(`/api/jornadas/${jornadaId}/ofertas`).then((d) => ({
    itens: d.itens ?? [],
    preco: d.preco ?? null,
  }));
}

export function registrarOferta(
  jornadaId: string,
  payload: { condicao: CondicaoOferta; valor_ofertado?: number; valida_ate?: string },
): Promise<Oferta> {
  return chamar<{ oferta: Oferta }>(`/api/jornadas/${jornadaId}/ofertas`, {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((d) => d.oferta);
}

export function marcarOfertaAceita(jornadaId: string, ofertaId: string, aceita: boolean): Promise<Oferta> {
  return chamar<{ oferta: Oferta }>(`/api/jornadas/${jornadaId}/ofertas/${ofertaId}`, {
    method: "PATCH",
    body: JSON.stringify({ aceita }),
  }).then((d) => d.oferta);
}
