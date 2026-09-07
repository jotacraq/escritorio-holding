/** Croqui Estrutural: slides, versões e a apresentação que avança a etapa. */
import { chamar } from "./nucleo";
import type { EventoTimeline } from "./jornadas";
import type { CroquiFase } from "@/lib/pasta/sinais";

export type StatusCroqui = "rascunho" | "pronto" | "apresentado";

export interface CroquiSlide {
  id: string;
  tipo:
    | "legado"
    | "controle"
    | "familia"
    | "patrimonio"
    | "risco"
    | "alternativas"
    | "celula_1"
    | "celula_2"
    | "celula_3"
    | "controle_arquitetura"
    | "economia"
    | "implementacao"
    | "investimento";
  titulo: string;
  conteudo: string;
  objetivo?: string;
  pergunta_ao_cliente?: string;
  /** Campos ADITIVOS (ARQUITETURA-FASE-3.md §3.3, `SlideCroquiSchema` em
   * `src/server/ia/schema-croqui-slides.ts`, onda 2/agente E — pedido
   * explícito para o agente H editar aqui). Croquis gravados antes desta
   * mudança continuam válidos: chaves ausentes, nunca `undefined`
   * obrigatório. `revisado` ausente conta como `false` no trigger de banco
   * (0043) — nunca `true` por omissão. */
  origem?: "metodo" | "ia" | "humano";
  revisado?: boolean;
  como_apresentar?: string;
  categoria?: "fato_declarado" | "dado_documental" | "inferencia" | "ponto_a_validar";
  fontes?: string[];
  pontos?: string[];
  grafico?: string;
}

export interface Croqui {
  id: string;
  jornada_id: string;
  versao: number;
  titulo: string;
  status: StatusCroqui;
  conteudo: { slides: CroquiSlide[] };
  /** Fase 8 (0086): fase de `vw_croqui_estado`; `null` = sem informação. Só `GET /api/croquis/[id]` preenche. */
  fase?: CroquiFase | null;
}

/**
 * Não existe `GET /api/croquis?jornada_id=` (nem `/api/jornadas/[id]/croqui`,
 * apesar do que diz o §3 do ARQUITETURA.md — gap sinalizado pelo próprio time
 * de IA no código deles). O jeito real de achar o croqui de uma jornada é pelo
 * evento `tipo:'croqui'` que o trigger `app.timeline_croqui()` grava em
 * `eventos_timeline` (dados.croqui_id) — por isso esta função lê a timeline
 * já carregada na Ficha 360 em vez de bater outro endpoint.
 */
export function acharCroquiIdNaTimeline(timeline: EventoTimeline[]): string | null {
  const evento = timeline.find((e) => e.tipo === "croqui");
  const croquiId = evento?.dados?.croqui_id;
  return typeof croquiId === "string" ? croquiId : null;
}

export function buscarCroquiPorId(id: string) {
  return chamar<{ croqui: Croqui }>(`/api/croquis/${id}`);
}

export function criarCroqui(jornadaId: string, payload: { titulo: string; conteudo?: { slides: CroquiSlide[] } }) {
  return chamar<{ croqui: Croqui }>(`/api/croquis`, { method: "POST", body: JSON.stringify({ jornada_id: jornadaId, ...payload }) });
}
export function atualizarCroqui(croquiId: string, payload: { titulo?: string; conteudo?: { slides: CroquiSlide[] }; status?: StatusCroqui }) {
  return chamar<{ croqui: Croqui }>(`/api/croquis/${croquiId}`, { method: "PUT", body: JSON.stringify(payload) });
}
/**
 * Registra a apresentação do croqui. O `encerrar` sai com `keepalive`: ele
 * dispara junto do `router.back()`, e quando a volta é navegação de documento
 * (link aberto direto, aba nova, F5) o navegador cancelaria a requisição no
 * unload — medido no Playwright: `iniciar` gravava, `encerrar` sumia, e era
 * justamente o `encerrar` que avança a etapa `croqui_apresentado`.
 */
export function registrarApresentacaoCroqui(croquiId: string, payload: { acao: "iniciar" | "encerrar"; slides_vistos?: number }) {
  return chamar<{ apresentacao: { id: string } }>(`/api/croquis/${croquiId}/apresentacao`, {
    method: "POST",
    body: JSON.stringify(payload),
    keepalive: payload.acao === "encerrar",
  });
}
