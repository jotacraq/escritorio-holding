/**
 * Tipos do Copiloto ao Vivo da Sessão de Viabilidade — Fase 10, Fatia 1
 * (docs/ARQUITETURA-FASE-10.md §6.2, §8, §12). Contrato entre BACK e FRONT:
 * o `frontend-engineer` importa daqui — nenhum destes tipos é redefinido em
 * `src/components/**`.
 *
 * Mesmo padrão de composição de `src/types/roteiro.ts`: as tabelas novas
 * (0091) não entram em `banco.ts` (fora da fronteira desta entrega), ganham
 * tipo próprio aqui.
 *
 * ESCOPO DESTA FATIA — determinístico puro, zero IA:
 *   - `EstadoCopiloto` é o payload de `GET /api/sessoes/[id]/copiloto`:
 *     o que falta no bloco atual, SIMs pendentes, blocos não percorridos.
 *     Nenhum campo de sugestão de IA aparece aqui — isso é Fatia 2
 *     (`copiloto_sugestoes`, já existe no banco por DDL antecipado, 0091,
 *     mas sem chamador nesta fatia).
 *   - `SegmentoCopiloto`/`RegistrarSegmentoInput` são o par de
 *     `GET`/`POST /api/sessoes/[id]/copiloto/segmentos`, o campo de
 *     digitar/colar que testa o pipeline sem bot nenhum.
 */

// ---------------------------------------------------------------------------
// GET /api/sessoes/[id]/copiloto — estado determinístico do copiloto
// ---------------------------------------------------------------------------

/** Um item de `campos[]` do bloco atual que ainda não tem resposta registrada
 * (hoje: nenhuma rota grava resposta de `campos[]` — todo campo do bloco
 * atual aparece aqui até que essa gravação exista; ausente é ausente, não é
 * um "falso positivo" a esconder). */
export interface CampoPendente {
  id: string;
  rotulo: string;
  tipo: string;
}

/** Um dos 4 SIMs (POP 05) que ainda não foi confirmado nesta sessão. */
export interface SimPendente {
  sim: "sigilo_gravacao" | "licitude" | "decisores" | "proximo_passo";
  rotulo: string;
}

/** Um bloco do roteiro ativo que o índice atual da tela ainda não alcançou. */
export interface BlocoPendente {
  id: string;
  titulo: string;
  indice: number;
}

/**
 * Payload único de `GET /api/sessoes/[id]/copiloto` (§2.4 — uma rota de
 * polling só, mesmo nesta fatia sem polling real: o formato já nasce
 * coalescido para a Fatia 3 não precisar mudar o contrato). Tudo derivado de
 * dado que já existe (roteiro ativo, `sessoes_viabilidade.sims`,
 * `consentimentos`) — zero chamada de IA, zero campo inventado.
 */
export interface EstadoCopiloto {
  sessao_id: string;
  /** Nulo quando não há roteiro ativo — a rota nunca inventa um bloco. */
  bloco_atual_id: string | null;
  /** `campos[]` do bloco atual ainda sem resposta + `observar[]` (texto puro,
   * sem id — é o que o roteiro já rotula como "observar", não um campo). */
  falta_no_bloco: { campos: CampoPendente[]; observar: string[] };
  sims_pendentes: SimPendente[];
  blocos_nao_percorridos: BlocoPendente[];
  /** `sessoes_copiloto.estado` — 'aguardando' quando a linha ainda não existe
   * (a rota não cria a linha sozinha: quem cria é o primeiro POST de
   * segmento manual, ou a Fatia 4 ao pedir o bot). */
  estado_copiloto: "aguardando" | "ativo" | "encerrado" | "erro";
}

// ---------------------------------------------------------------------------
// GET/POST /api/sessoes/[id]/copiloto/segmentos — segmento manual (0091-b)
// ---------------------------------------------------------------------------

export interface SegmentoCopiloto {
  id: string;
  sessao_id: string;
  ordem: number;
  falante: string | null;
  falante_confianca: number | null;
  texto: string;
  iniciado_ms: number | null;
  origem: "bot" | "manual";
  criado_em: string;
}

/** Corpo de `POST /api/sessoes/[id]/copiloto/segmentos`. `ordem` NÃO é
 * aceita do chamador: o servidor calcula a próxima (§2.2 — é o índice do
 * polling, tem que ser monotônica e sem buraco por corrida de cliente). */
export interface RegistrarSegmentoInput {
  texto: string;
  falante?: string;
}

export interface RespostaSegmentos {
  itens: SegmentoCopiloto[];
  /** Cursor para a próxima leitura incremental (Fatia 3) — a maior `ordem`
   * devolvida nesta página, ou a que já veio em `desde` se a lista vier vazia. */
  proximo_cursor: number;
}
