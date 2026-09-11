/**
 * Tipos do Copiloto ao Vivo da Sessão de Viabilidade — Fase 10
 * (docs/ARQUITETURA-FASE-10.md §4.3, §6.2, §8, §12). Contrato entre BACK e
 * FRONT: o `frontend-engineer` importa daqui — nenhum destes tipos é
 * redefinido em `src/components/**`.
 *
 * Mesmo padrão de composição de `src/types/roteiro.ts`: as tabelas novas
 * (0091) não entram em `banco.ts` (fora da fronteira desta entrega), ganham
 * tipo próprio aqui.
 *
 * FATIA 1 — determinístico puro, zero IA:
 *   - `EstadoCopiloto` é o payload de `GET /api/sessoes/[id]/copiloto`:
 *     o que falta no bloco atual, SIMs pendentes, blocos não percorridos.
 *   - `SegmentoCopiloto`/`RegistrarSegmentoInput` são o par de
 *     `GET`/`POST /api/sessoes/[id]/copiloto/segmentos`, o campo de
 *     digitar/colar que testa o pipeline sem bot nenhum.
 *
 * FATIA 2 — a sugestão por IA sob demanda (botão "Me ajuda agora"):
 *   - `ContextoCopiloto` é o que entra na IA (server/copiloto/contexto.ts).
 *   - `SugestaoCopiloto`/`RespostaSugestaoCopiloto` são a saída já validada
 *     (Zod + pós-Zod) de `POST /api/sessoes/[id]/copiloto/sugestao`.
 *   - `CodigoRecusaSugestaoCopiloto` é o conjunto fechado de códigos de
 *     recusa — mesmo padrão de `copiloto_desligado` da Fatia 1.
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

// ---------------------------------------------------------------------------
// Fase 10, Fatia 2 (docs/ARQUITETURA-FASE-10.md §4.3, §8, §12) — a sugestão
// por IA sob demanda ("Me ajuda agora"). Contrato entre BACK e FRONT: o
// `frontend-engineer` importa daqui.
// ---------------------------------------------------------------------------

/** O que entra na IA, montado no servidor (server/copiloto/contexto.ts).
 * Nenhum nome de decisor, nenhum valor de patrimônio, nenhum CPF — ver §7 do
 * plano. Exportado para o teste de mesa do montador de contexto. */
export interface ContextoCopiloto {
  bloco_atual: {
    id: string;
    titulo: string;
    objetivo: string | null;
    acao: string | null;
    falas: string[];
    campos: string[];
    observar: string[];
    proibido: string[];
  } | null;
  bloco_anterior_titulo: string | null;
  bloco_seguinte_titulo: string | null;
  briefing_recorte: {
    disc_predominante: string | null;
    disc_secundario: string | null;
    objecao_provavel: string | null;
    tom_recomendado: string | null;
  } | null;
  estado_factual: {
    sims_registrados: string[];
    blocos_percorridos: string[];
    campos_pendentes_no_bloco: string[];
    /** Do briefing (`processo_decisorio.decisores.length`) — contagem, nunca nome. */
    decisores_esperados: number | null;
    /** De `sessoes_copiloto.participantes` (Fatia 4) — contagem, nunca nome. */
    decisores_presentes: number | null;
  };
  /** Últimos ~90s de fala, `"papel: texto"` — nome próprio já trocado por papel. */
  janela_transcricao: string[];
  /** `sessoes_copiloto.resumo_acumulado` como está — ninguém reescreve nesta fatia. */
  resumo_acumulado: Record<string, unknown>;
  /** Ids de todos os blocos do roteiro ativo — é contra ISTO que o servidor
   * confere `bloco_id` na validação pós-Zod (nunca contra a lista da IA). */
  roteiro_ativo_blocos_ids: string[];
}

export type TipoObservacaoCopiloto = "fato" | "hipotese" | "inferencia" | "recomendacao";

/** A saída já validada — depois do Zod E da validação pós-Zod (§4.3: "a IA
 * propõe, o servidor confere"). É o que `copiloto_sugestoes.conteudo` guarda
 * e o que a tela recebe. Todo campo pode ter sido anulado pela validação
 * (bloco_id inexistente → sugestão inteira descartada antes de chegar aqui;
 * evidência não conferida → só aquele campo vira nulo, com a marca abaixo). */
export interface SugestaoCopiloto {
  proxima_pergunta: { texto: string; motivo: string; evidencia: string | null } | null;
  falta_no_bloco: Array<{ item: string; evidencia: string | null }>;
  observacao: {
    tipo: TipoObservacaoCopiloto;
    texto: string;
    evidencia: string | null;
    confianca: number;
  } | null;
  desvio_sugerido: { bloco_id: string; motivo: string; confianca: number } | null;
  confianca_geral: number;
  /** Nomes de campo (ex.: "proxima_pergunta.evidencia") cuja evidência não
   * casou por substring com a janela D nem com o estado C — o campo já foi
   * anulado; esta lista é só para telemetria/tela mostrar "não conferida"
   * em vez de simplesmente sumir sem explicação (§4.3 do plano). */
  campos_evidencia_nao_conferida: string[];
}

/** Resposta de sucesso de `POST /api/sessoes/[id]/copiloto/sugestao`. */
export interface RespostaSugestaoCopiloto {
  sugestao_id: string;
  gatilho: "sob_demanda";
  confianca_geral: number;
  /** `false` quando a confiança ficou abaixo de `copiloto_sessao.confianca_minima`
   * — a sugestão foi GRAVADA (histórico), mas a tela não deve mostrar nada
   * além do aviso de que a IA não teve confiança suficiente desta vez. */
  visivel: boolean;
  sugestao: SugestaoCopiloto | null;
}

/**
 * Códigos estáveis de recusa de `POST /api/sessoes/[id]/copiloto/sugestao` —
 * mesmo padrão de `copiloto_desligado` (Fatia 1). Todos vêm como
 * `{ erro: <código>, mensagem }` via `erroConflito`/`ErroApi`, nunca 500.
 */
export type CodigoRecusaSugestaoCopiloto =
  /** `copiloto_sessao.ativo=false` (mesmo kill-switch da Fatia 1). */
  | "copiloto_desligado"
  /** Prompt `copiloto_sessao` inativo (0094 nasce assim) — "é assim que sobe". */
  | "copiloto_ia_nao_ativada"
  /** `copiloto_sessao.teto_ia_sessao` ou `teto_ia_dia` estourado (§4.4). */
  | "teto_ia_copiloto_atingido"
  /** 8s sem resposta do provedor (§4.3/C3) — nunca sugestão velha disfarçada de nova. */
  | "timeout_copiloto"
  /** Sem decisão jurídica ativa e/ou sem consentimento do titular — o banco
   * recusou o INSERT em `copiloto_sugestoes` (0093, trigger incondicional). */
  | "copiloto_ao_vivo_bloqueado"
  /** A IA recusou processar, ou a saída não validou contra o schema. */
  | "recusa_ia"
  | "saida_invalida"
  /** Validador pós-Zod achou termo de valor/preço na SAÍDA (B61) — a
   * sugestão inteira foi descartada antes de qualquer INSERT. */
  | "conteudo_proibido";

// ---------------------------------------------------------------------------
// POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho — §5 do
// plano: "o registro de que a sugestão foi aceita [...] é o dado que, daqui
// a 20 sessões, dirá se o copiloto acerta". `desfecho`/`desfecho_em` (0091)
// só vão de NULL para um valor, uma vez — imutável depois (trigger, 0095).
// ---------------------------------------------------------------------------

export type DesfechoCopiloto = "aceita" | "ignorada" | "expirada";

export interface RegistrarDesfechoInput {
  desfecho: DesfechoCopiloto;
}

export interface RespostaDesfechoCopiloto {
  sugestao_id: string;
  desfecho: DesfechoCopiloto;
  desfecho_em: string;
}

/** Códigos de recusa de `POST .../desfecho`. `desfecho_ja_registrado` é o
 * caso normal de clicar duas vezes (dois botões, cliente que dá duplo-clique)
 * — 409, nunca 500: o dado já existe, só não pode ser trocado. */
export type CodigoRecusaDesfechoCopiloto = "copiloto_desligado" | "sugestao_nao_encontrada" | "desfecho_ja_registrado";
