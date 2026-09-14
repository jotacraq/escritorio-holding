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
    // `falas` NÃO entra aqui de propósito (14/09/2026): era 94-97% do peso do
    // bloco e a latência é quase linear no tamanho do contexto (r=0,95;
    // +1.000 tokens ≈ +2,5 s). As falas existem para a ADVOGADA ler na tela —
    // o prompt v2 proíbe a IA de redigir fala pronta, então mandá-las
    // alimentava justamente o que é vedado. Ver o comentário em
    // `server/copiloto/contexto.ts`, com a medição lado a lado.
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

// ---------------------------------------------------------------------------
// FATIA 3 (docs/ARQUITETURA-FASE-10.md §4.1, §4.3, §6.2, §8) — o ciclo
// automático e o polling coalescido. Contrato entre BACK e FRONT — o
// `frontend-engineer` importa daqui, não redefine.
//
// `GET /api/sessoes/[id]/copiloto` (mesma rota da Fatia 1) GANHA parâmetros
// e campos novos — o formato NASCEU coalescido desde a Fatia 1 exatamente
// para isto (§2.4/C9: "é o formato que a Fatia 3 vai reusar sem trocar de
// contrato"). Nenhuma rota nova de polling: é a MESMA `GET` de sempre.
// ---------------------------------------------------------------------------

/** Query string de `GET /api/sessoes/[id]/copiloto` a partir da Fatia 3.
 * `bloco` já existia (Fatia 1). `desde_segmento`/`desde_sugestao` são os
 * cursores incrementais (§2.2/§4.1) — 0 = "desde o início", como os cursores
 * de `GET .../segmentos` já fazem. Omitir os dois é válido (a tela pode só
 * querer o estado + disparar avaliação de ciclo, sem novidade de conteúdo). */
export interface ConsultaPollingCopiloto {
  bloco?: number;
  desde_segmento?: number;
  desde_sugestao?: number;
}

/** Uma sugestão do copiloto como o POLLING a entrega — MESMO formato de
 * `RespostaSugestaoCopiloto` (Fatia 2), mais o cursor de ordenação
 * (`ordem_evento`, bigint identity — §2.2: "uuid não ordena"). É o que a
 * tela usa tanto para desenhar o card quanto para calcular o próximo
 * `desde_sugestao`. */
export interface SugestaoCopilotoPolling {
  sugestao_id: string;
  ordem_evento: number;
  gatilho: TipoGatilhoCopilotoPolling;
  confianca_geral: number;
  visivel: boolean;
  sugestao: SugestaoCopiloto | null;
  desfecho: DesfechoCopiloto | null;
  criado_em: string;
}

export type TipoGatilhoCopilotoPolling = "intervalo" | "virada_bloco" | "sob_demanda";

/** O intervalo de polling que o SERVIDOR manda a tela usar — corrige a
 * divergência achada pelo frontend/coordenador na revisão desta fatia:
 * `copiloto_sessao.polling_ms` existe em `configuracoes` desde a 0091, com
 * descrição prometendo controlar o polling, mas nenhuma rota a expunha; o
 * front hardcodou `POLLING_MS_EM_FOCO=3000` porque não tinha de onde ler.
 * "Ajuste que não ajusta" — mudar a chave no banco não mudava nada na tela.
 *
 * SÓ `em_foco_ms` vem de uma chave própria (`copiloto_sessao.polling_ms`,
 * 0091) — é a ÚNICA das duas que o banco declara como configurável. O valor
 * "sem foco" (§4.1: "mitigação de conforto... sobe para 10s quando a aba
 * perde o foco") NÃO tem chave própria em `configuracoes`: não é um ajuste
 * operacional independente, é uma REGRA DE UX derivada — sempre
 * `em_foco_ms * FATOR_SEM_FOCO` (server/copiloto/config.ts). Criar uma 11ª
 * chave só para isto seria configuração sem decisão de negócio por trás
 * (ninguém jamais pediu ajustar o multiplicador em si). Se um dia isso
 * mudar, aí sim a chave nasce — não antes de haver motivo real.
 *
 * Fail-safe do lado da tela: campo ausente/valor inválido → usa 3000/10000
 * (os mesmos defaults que a 0091 já grava) — nunca trava o polling por falta
 * deste campo. */
export interface ConfigPollingCopiloto {
  em_foco_ms: number;
  sem_foco_ms: number;
}

/** O que a rota de polling relata sobre o CICLO AUTOMÁTICO desta chamada —
 * é como a tela sabe "um ciclo rodou" sem inferir pelo aparecimento de uma
 * sugestão nova (silêncio na sala = ciclo avaliado, gatilho não bateu, ZERO
 * chamada — isso também é "um ciclo rodou", só que sem sugestão; a tela não
 * deve interpretar ausência de sugestão como "o copiloto está com defeito"). */
export interface InfoCicloCopiloto {
  avaliado: boolean;
  /** Só preenchido quando `avaliado=true` E o gatilho disparou nesta chamada
   * (`nenhum_gatilho`/`janela_ja_claimada_por_outra_requisicao` → `null`,
   * porque não houve tentativa de execução, só avaliação). */
  resultado:
    | "sugestao_gravada"
    | "bloqueado_pelo_gate"
    | "orcamento_estourado"
    | "timeout"
    | "indisponivel"
    | "conteudo_recusado"
    | "sessao_encerrada_por_duracao_maxima"
    | null;
  /** SÓ preenchido quando `resultado='bloqueado_pelo_gate'` — é como a tela
   * sabe que o GATE FECHOU NO MEIO DA SESSÃO (§6.2.2 da errata: revogação de
   * decisão/consentimento cala o ciclo seguinte). A tela deve mostrar aviso
   * explícito ("o copiloto de IA foi desativado nesta sessão"), nunca
   * silêncio mudo — silêncio mudo pareceria bug, não decisão deliberada. */
  motivo_bloqueio: string | null;
}

/** `resultado === "sessao_encerrada_por_duracao_maxima"` (§4.4 do plano):
 * `copiloto_sessao.duracao_maxima_minutos` estourou e o SERVIDOR encerrou a
 * sessão sozinho, sem a advogada clicar "Encerrar" — mesmo efeito de
 * `POST .../encerrar` (consolidação em transcrições, sugestões expiradas).
 * A tela deve mostrar isso como estado explícito ("sessão encerrada
 * automaticamente por tempo"), nunca inferir por silêncio; o próximo GET de
 * `EstadoCopiloto.estado_copiloto` já virá `'encerrado'`. */

/** Payload de `GET /api/sessoes/[id]/copiloto` a partir da Fatia 3 — estende
 * `EstadoCopiloto` (Fatia 1) por composição, nunca a redefine (mesmo padrão
 * de `RoteiroVersaoResumo = Omit<RoteiroVersao, ...>` em `roteiro.ts`). */
export interface EstadoCopilotoComPolling extends EstadoCopiloto {
  segmentos_novos: SegmentoCopiloto[];
  /** Cursor para a PRÓXIMA chamada (`desde_segmento`) — a maior `ordem`
   * devolvida, ou o `desde_segmento` recebido se não houve novidade. */
  proximo_cursor_segmento: number;
  sugestoes_novas: SugestaoCopilotoPolling[];
  /** Cursor para a PRÓXIMA chamada (`desde_sugestao`) — a maior
   * `ordem_evento` devolvida, ou o `desde_sugestao` recebido se não houve
   * novidade. */
  proximo_cursor_sugestao: number;
  ciclo: InfoCicloCopiloto;
  polling: ConfigPollingCopiloto;
  /** Fatia 4 — `sessoes_copiloto.estado`/`gravacao_externa_id` já cobertos
   * por `estado_copiloto`/participantes; este campo é o DETALHE do erro do
   * PROVEDOR (§4.2.2). `null` quando a sessão nunca teve bot pedido — nunca
   * um objeto com campos vazios fingindo que houve tentativa.
   *
   * `erro_provedor`/`retencao_infinita_detectada` SEMPRE vêm vazios nesta
   * entrega (achado da revisão: `sessoes_copiloto` ainda não tem coluna
   * para persistir o `sub_code`/o motivo do erro — `POST .../bot` hoje só
   * devolve isso na RESPOSTA SÍNCRONA do próprio POST; se a advogada
   * recarregar a página depois de um `meeting_not_found`, a tela perde essa
   * informação). Migration futura fecha isso; até lá, `bot.estado` reflete
   * `sessoes_copiloto.estado`, que É persistido. */
  bot: EstadoBotCopiloto | null;
  /** Fatia 4/§5 — a CAMADA 1 do caso dos decisores, fato sem IA
   * (`server/copiloto/participantes.ts::compararComDecisores`). `null`
   * quando não há dado suficiente para comparar (sem participantes
   * presentes, OU sem `processo_decisorio.decisores` no briefing) — nunca
   * um objeto com `decisores_esperados: []` fingindo "0 decisores
   * esperados": vazio é vazio, nunca zero (regra da casa). A tela decide o
   * que mostrar (ou nada) quando este campo é `null`. */
  comparacao_decisores: ComparacaoDecisoresPresentes | null;
  /** Fase 10, Fatia 5 (B69/B19, `docs/ARQUITETURA-FASE-10.md` §8 Fatia 5).
   * `null` = segmentos brutos ainda não expurgados (inclui: expurgo
   * desligado — `copiloto_sessao.expurgo_ativo=false`, o padrão de fábrica
   * — sessão dentro do prazo, ou sem transcrição consolidada ainda).
   * Preenchido = instante em que `server/copiloto/expurgo.ts` removeu a
   * fala bruta (`sessoes_copiloto_segmentos`) desta sessão por retenção
   * vencida. A transcrição CONSOLIDADA (`transcricoes`, o que o Agente do
   * Croqui lê) continua intacta — a tela deve mostrar algo como
   * "transcrição ao vivo expurgada em …", NUNCA esconder a sessão nem
   * mostrar erro: expurgo é o comportamento esperado depois do prazo, não
   * uma falha.
   *
   * Campo OPCIONAL de propósito (`?:`, não `string | null` obrigatório): é
   * o contrato NOVO desta fatia, entregue por composição sobre
   * `EstadoCopilotoCompleto` — tornar obrigatório quebraria todo literal já
   * escrito em `src/components/sessao/PainelCopiloto.test.tsx` (fronteira
   * do FRONT, fora do escopo desta entrega, §12 do plano) sem nenhum ganho
   * de segurança: ausência de campo e `null` significam a MESMA coisa aqui
   * ("não sei que foi expurgado"). Quando o `frontend-engineer` consumir
   * este campo, `undefined` e `null` devem ser tratados de forma idêntica. */
  expurgo_segmentos_em?: string | null;
}

// ---------------------------------------------------------------------------
// POST /api/sessoes/[id]/copiloto/encerrar — Fatia 3 (§6.1, §8). Marca
// `sessoes_copiloto.estado='encerrado'`, expira sugestões pendentes
// (`desfecho='expirada'`) e consolida os segmentos em `transcricoes`
// reusando `POST /api/sessoes/[id]/transcricao` (0032) — idempotente por
// sha256, como sempre.
// ---------------------------------------------------------------------------

export interface RespostaEncerrarCopiloto {
  sessao_id: string;
  estado: "encerrado";
  encerrado_em: string;
  /** `null` quando não havia nenhum segmento a consolidar (sessão nunca
   * usou o copiloto para transcrever nada) — nunca insere transcrição vazia. */
  transcricao_id: string | null;
  ja_existia_transcricao: boolean;
  sugestoes_expiradas: number;
}

/** `sessao_ja_encerrada` é o caso normal de clicar duas vezes — 409, nunca
 * 500: encerrar de novo não reconsolida nem duplica transcrição. */
export type CodigoRecusaEncerrarCopiloto = "copiloto_desligado" | "sessao_nao_encontrada" | "sessao_ja_encerrada";

// ---------------------------------------------------------------------------
// FATIA 4 (docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2, §5, §7, §8,
// §12) — o bot na sala (Recall.ai). Contrato entre BACK e FRONT: o
// `frontend-engineer` importa daqui. `src/server/copiloto/recall.ts`
// (pedirBot/encerrarBot), o webhook (`POST /api/webhooks/copiloto/transcricao`),
// a comparação de participantes (`server/copiloto/participantes.ts`) E a
// rota `POST /api/sessoes/[id]/copiloto/bot` (com botão na tela,
// `src/components/sessao/PainelCopiloto.tsx`) estão todos implementados —
// ver `RespostaPedirBotCopiloto`/`CodigoRecusaBotCopiloto` mais abaixo para
// o contrato exato da rota.
// ---------------------------------------------------------------------------

/** `sessoes_copiloto.estado` já cobre 'erro' desde a Fatia 1 — aqui é o
 * DETALHE do erro quando a causa é o bot (§4.2.2/B74): a tela nunca deve
 * mostrar "erro ao iniciar" genérico quando o motivo real é a sala. */
export interface EstadoBotCopiloto {
  /** Espelha `sessoes_copiloto.estado`. 'erro' cobre TANTO falha de sala
   * quanto `retencao_infinita_detectada` (§4.2.1) — ver `motivo` abaixo
   * para distinguir. */
  estado: "aguardando" | "ativo" | "encerrado" | "erro";
  /** Preenchido só quando `estado==='erro'` E a causa foi o PROVEDOR (nunca
   * inventado quando a causa foi outra, ex.: gate jurídico fechado). */
  erro_provedor: {
    /** `code` do `status_changes[]` mais recente do Recall (ex.: 'fatal'). */
    codigo: string | null;
    /** 🔴 `sub_code` (ex.: 'meeting_not_found') — TEM de chegar à tela
     * (§4.2.2): "erro ao iniciar" genérico não ajuda ninguém a saber que o
     * link da sala está errado, que é o defeito mais provável em produção. */
    sub_codigo: string | null;
  } | null;
  /** `true` quando o motivo do erro foi a resposta trazer `retention.type
   * ==='forever'` apesar do pedido explícito (§4.2.1) — a tela deve mostrar
   * um aviso DIFERENTE de "sala inválida": é falha de configuração nossa/do
   * fornecedor, não do link colado pela advogada. */
  retencao_infinita_detectada: boolean;
}

/** `sessoes_copiloto.participantes` (Fatia 4) x `processo_decisorio
 * .decisores` do briefing — a CAMADA 1 do §5, fato sem IA
 * (`server/copiloto/participantes.ts::compararComDecisores`). É o dado que
 * sustenta o 3º SIM deixar de ser um booleano sem lastro. NOME de pessoa
 * real aparece aqui (é para a TELA, sob `app.ve_patrimonio()` — nunca isto
 * é enviado para a IA; o contexto de IA só recebe a CONTAGEM, ver
 * `ContextoCopiloto.estado_factual`). */
export interface ComparacaoDecisoresPresentes {
  decisores_esperados: string[];
  participantes_presentes: string[];
  /** Decisor do briefing que casou, sem ambiguidade, com 1 participante
   * presente agora. */
  presentes: Array<{ nome_briefing: string; nome_participante: string }>;
  /** Decisor sem nenhum participante presente casando — é o fato "Cleison
   * não entrou" do exemplo do plano (§5). */
  ausentes: string[];
  /** AMBÍGUO NÃO CASA (postura do porteiro, Fase 9): mais de um
   * participante presente casa com o mesmo nome do decisor. A tela mostra
   * como "não foi possível confirmar" — nunca escolhe um dos dois. */
  ambiguos: string[];
}

// ---------------------------------------------------------------------------
// POST /api/sessoes/[id]/copiloto/bot — Fase 10, Fatia 4a/4b. Implementada em
// `src/app/api/sessoes/[id]/copiloto/bot/route.ts`. Tipos do FRONT, derivados
// por leitura da rota (não redeclarados pelo BACK nesta entrega):
// `frontend-engineer` consome, próxima rodada de BACK pode formalizar aqui.
// ---------------------------------------------------------------------------

/** Sucesso (201) de `POST /api/sessoes/[id]/copiloto/bot`. */
export interface RespostaPedirBotCopiloto {
  sessao_id: string;
  bot_id: string;
}

/** `detalhes` de `sala_invalida` (409) — o `sub_codigo` é o campo que mais
 * importa (§4.2.2): `"meeting_not_found"` é link de sala errado, o defeito
 * mais provável em produção. Códigos fora deste conjunto são mostrados
 * CRUS pela tela (o backend não mapeia todos) em vez de engolidos. */
export interface DetalhesSalaInvalidaBot {
  codigo: string | null;
  sub_codigo: string | null;
}

/**
 * Códigos estáveis de recusa de `POST /api/sessoes/[id]/copiloto/bot`
 * (`route.ts`, comentário de topo — a ordem das travas é a ORDEM desta
 * union, de cima para baixo). Todos vêm como `{erro: <código>, mensagem,
 * detalhes?}` via `erroConflito`/`ErroApi`, nunca 500 no caso esperado.
 */
export type CodigoRecusaBotCopiloto =
  /** `copiloto_sessao.ativo=false` (mesmo kill-switch de sempre). */
  | "copiloto_desligado"
  | "sessao_nao_encontrada"
  /** Sessão sem `link_sala` cadastrado — cole o link na Ficha antes. */
  | "sem_link_sala"
  /** 🔴 CORREÇÃO (item menor do Fable): sessão com `sessoes_copiloto.estado`
   * em `'encerrado'`/`'erro'` — não é possível pedir bot para sessão já
   * finalizada (transcrição já consolidada pela Fatia 3). */
  | "sessao_ja_encerrada"
  /** Gate jurídico (B65/B67), ANTES de qualquer fetch ao Recall (§6.2.2). */
  | "copiloto_ao_vivo_bloqueado"
  /** `copiloto_sessao.audio_ao_vivo=false` — ESTADO NORMAL hoje (default). */
  | "audio_ao_vivo_desligado"
  /** `copiloto_sessao.provedor_audio !== 'recall'` — ESTADO NORMAL hoje
   * (default `'nenhum'`, B75: aguarda decisão da Dra. Elaine). */
  | "provedor_audio_nao_configurado"
  /** `RECALL_API_KEY`/`COPILOTO_WEBHOOK_SECRET` ausentes no servidor. */
  | "servico_indisponivel"
  /** Idempotência — sessão já tem bot pedido. CASO NORMAL, não erro:
   * clicar duas vezes (ou reabrir a tela) não pede um 2º bot. */
  | "bot_ja_pedido"
  /** O provedor não respondeu como esperado (502) — pode tentar de novo. */
  | "falha_provedor_bot"
  /** 🔴 Link de sala errado ou reunião inexistente — `detalhes.sub_codigo`
   * TEM de aparecer na mensagem (§4.2.2). Nunca "erro ao iniciar" genérico. */
  | "sala_invalida"
  /** O fornecedor devolveu retenção indefinida apesar do pedido explícito
   * (§4.2.1). A MENSAGEM é CONDICIONAL ao resultado real do encerramento
   * (achado 4 do Fable, B76) — pode significar "o bot foi encerrado, zero
   * segmento gravado" OU "o servidor NÃO CONSEGUIU encerrar o bot, ele pode
   * seguir gravando" (2ª tentativa também falhou). A tela NÃO PODE assumir
   * sucesso a partir só deste código — precisa ler a `mensagem` devolvida. */
  | "retencao_infinita_detectada"
  /** 🔴 CORREÇÃO (achado 3 do Fable): o bot foi criado no fornecedor mas o
   * `upsert` de `gravacao_externa_id` falhou — o servidor já tentou encerrar
   * o bot (com retentativa) antes de devolver este 500. Caso raro (falha de
   * banco entre criar o bot e persistir o vínculo); "tente de novo" é a
   * ação certa — um novo `POST` pede outro bot do zero. */
  | "falha_ao_persistir_vinculo_bot";
