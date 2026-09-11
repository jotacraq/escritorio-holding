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
import type {
  DesfechoCopiloto,
  EstadoCopiloto,
  EstadoCopilotoComPolling,
  RespostaDesfechoCopiloto,
  RespostaEncerrarCopiloto,
  RespostaSegmentos,
  RespostaSugestaoCopiloto,
  SegmentoCopiloto,
} from "@/types/copiloto";

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

// ---------------------------------------------------------------------------
// Copiloto ao vivo — Fase 10, Fatia 1 (docs/ARQUITETURA-FASE-10.md §8)
//
// Contrato em `@/types/copiloto` (entrega do backend-engineer, §12 do plano):
// GET /api/sessoes/[id]/copiloto (estado determinístico) e
// GET/POST /api/sessoes/[id]/copiloto/segmentos (segmento manual).
// ---------------------------------------------------------------------------

export function buscarEstadoCopiloto(sessaoId: string, blocoAtualIndice: number): Promise<EstadoCopiloto> {
  return chamar<EstadoCopiloto>(`/api/sessoes/${sessaoId}/copiloto?bloco=${blocoAtualIndice}`);
}

export function registrarSegmentoManual(sessaoId: string, texto: string): Promise<SegmentoCopiloto> {
  return chamar<{ segmento: SegmentoCopiloto }>(`/api/sessoes/${sessaoId}/copiloto/segmentos`, {
    method: "POST",
    body: JSON.stringify({ texto }),
  }).then((d) => d.segmento);
}

/** Lista os segmentos já registrados nesta sessão, em ordem — é a prova, na
 * própria tela, de que o texto colado virou registro (§8: "é assim que o
 * pipeline inteiro é testado sem bot nenhum"). Sem isto o campo de digitar
 * seria uma caixa que engole texto sem confirmação nenhuma. */
export function listarSegmentosCopiloto(sessaoId: string): Promise<RespostaSegmentos> {
  return chamar<RespostaSegmentos>(`/api/sessoes/${sessaoId}/copiloto/segmentos`);
}

// ---------------------------------------------------------------------------
// Copiloto ao vivo — Fase 10, Fatia 2 (docs/ARQUITETURA-FASE-10.md §8)
//
// POST /api/sessoes/[id]/copiloto/sugestao — a sugestão por IA SOB DEMANDA
// ("Me ajuda agora"). Sucesso 201 pode vir com `visivel:false` — não é erro,
// é o servidor se recusando a mostrar palpite fraco (§ contrato). Recusa vem
// como `ErroSessao` com `codigo` de `CodigoRecusaSugestaoCopiloto`; a tela
// testa sempre por `codigo`, nunca por status nem pela mensagem.
// ---------------------------------------------------------------------------

export function pedirSugestaoCopiloto(sessaoId: string, bloco?: number): Promise<RespostaSugestaoCopiloto> {
  return chamar<RespostaSugestaoCopiloto>(`/api/sessoes/${sessaoId}/copiloto/sugestao`, {
    method: "POST",
    body: JSON.stringify(bloco === undefined ? {} : { bloco }),
  });
}

// ---------------------------------------------------------------------------
// POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho — §5 do
// plano: "Ir para lá" grava `aceita`, "Ignorar" grava `ignorada`. `desfecho`
// é IMUTAVEL (trigger 0095); `desfecho_ja_registrado` (409) é CASO NORMAL de
// duplo-clique, não erro. Esta chamada é telemetria, não a ação — a tela
// nunca deve bloquear "Ir para lá"/"Ignorar" esperando esta promise nem
// mostrar erro visível quando ela falha (ver PainelCopiloto.tsx).
// ---------------------------------------------------------------------------

export function registrarDesfechoSugestaoCopiloto(
  sessaoId: string,
  sugestaoId: string,
  desfecho: DesfechoCopiloto,
): Promise<RespostaDesfechoCopiloto> {
  return chamar<RespostaDesfechoCopiloto>(`/api/sessoes/${sessaoId}/copiloto/sugestoes/${sugestaoId}/desfecho`, {
    method: "POST",
    body: JSON.stringify({ desfecho }),
  });
}

// ---------------------------------------------------------------------------
// Copiloto ao vivo — Fase 10, Fatia 3 (docs/ARQUITETURA-FASE-10.md §4.1,
// §4.3, §6.2, §8). MESMA rota `GET /api/sessoes/[id]/copiloto` da Fatia 1,
// agora com cursores incrementais e o estado do ciclo automático — é o que
// a tela chama a cada 3s/10s (§4.1). Cursor SEMPRE o último recebido; nunca
// refaz a lista inteira (§2.2/§4.1: "cuidado com o óbvio que quebra").
// ---------------------------------------------------------------------------

export function buscarPollingCopiloto(
  sessaoId: string,
  parametros: { bloco: number; desdeSegmento: number; desdeSugestao: number },
): Promise<EstadoCopilotoComPolling> {
  const busca = new URLSearchParams({
    bloco: String(parametros.bloco),
    desde_segmento: String(parametros.desdeSegmento),
    desde_sugestao: String(parametros.desdeSugestao),
  });
  return chamar<EstadoCopilotoComPolling>(`/api/sessoes/${sessaoId}/copiloto?${busca.toString()}`);
}

/**
 * POST /api/sessoes/[id]/copiloto/encerrar — §6.1 do plano. `sessao_ja_encerrada`
 * (409) é o caso normal de clicar duas vezes; a tela trata como sucesso
 * silencioso (o polling já deveria ter parado antes disso, mas o clique
 * duplo humano sempre é possível).
 */
export function encerrarCopiloto(sessaoId: string): Promise<RespostaEncerrarCopiloto> {
  return chamar<RespostaEncerrarCopiloto>(`/api/sessoes/${sessaoId}/copiloto/encerrar`, { method: "POST" });
}
