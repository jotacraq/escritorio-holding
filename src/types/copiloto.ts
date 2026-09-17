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

/** Um familiar no dossiê — papel + nome (liberado 17/09/2026) + regime de
 * casamento (só presente para cônjuge). Ver `server/copiloto/dossie.ts`. */
export interface FamiliarDossie {
  papel: string;
  /** `null` quando o familiar não tem nome cadastrado — nunca inventado. */
  nome: string | null;
  /** Só presente quando o parentesco é cônjuge e o regime foi informado. */
  regime: string | null;
}

/** O dossiê do cliente — "a IA passa a conhecer a família do cliente"
 * (decisão de 17/09/2026). Montado 1× por sessão por
 * `server/copiloto/dossie.ts::montarDossieCliente`, persistido em
 * `sessoes_copiloto.dossie_cliente`. Nunca carrega valor monetário nem
 * conteúdo de documento — só rótulo/contagem/nome (orçamento de byte, ver
 * comentário de topo de `dossie.ts`). */
export interface DossieCliente {
  /** `jornadas.faixa_patrimonio_declarada` — rótulo, nunca valor. */
  faixa_patrimonio: string | null;
  familiares: FamiliarDossie[];
  /** Tipos de bem com ao menos 1 item ativo (`patrimonio_itens.tipo`), deduplicado. */
  patrimonio_tipos: string[];
  /** Tipos de documento já recebidos (existe linha em `documentos`). */
  documentos_recebidos: string[];
  /** Tipos de documento pedidos e ainda sem conferência nem dispensa. */
  documentos_pendentes: string[];
}

// ---------------------------------------------------------------------------
// 17/09/2026 — inventário patrimonial MENCIONADO NA FALA (`server/copiloto/
// inventario.ts`, `server/copiloto/schema.ts::ItemInventarioMencionadoSchema`).
// DIFERENTE de `DossieCliente` acima: o dossiê é o que o ESCRITÓRIO já tem
// cadastrado (`patrimonio_itens`, `familiares`); isto é o que o DECISOR
// relata durante a SESSÃO — script PARTE 03 (`tmp/script-sv-oficial.md`),
// mesmo padrão do dossiê de exemplo (`tmp/dossie-exemplo-maria.md` §5):
// quantos · de quem · ordem de grandeza, por categoria.
// ---------------------------------------------------------------------------

export type CategoriaInventarioMencionado = "imovel" | "empresa" | "investimento" | "outro";

/** O filtro do pedido do dono: "empresas que eles consideram como deles DE
 * FATO". `"propria"` conta no total; `"terceiro"` nunca conta (é menção de
 * bem de outra pessoa, ex. "meu genro tem uma empresa"); `"incerta"`
 * aparece separado, como "a confirmar" — nunca somado. */
export type PosseInventarioMencionado = "propria" | "terceiro" | "incerta";

/** Um item de inventário como a IA o propôs nesta chamada — já validado
 * (evidência conferida contra a janela de transcrição) e cortado nos tetos
 * de `schema.ts`. É o formato que entra no acumulador (`inventario.ts`),
 * nunca gravado solto: todo item vem de uma citação literal. */
export interface ItemInventarioMencionado {
  categoria: CategoriaInventarioMencionado;
  descricao: string;
  /** `null` = o decisor não disse de quem é (nunca inventado). */
  titularidade: string | null;
  posse: PosseInventarioMencionado;
  /** Texto como foi dito ("uns 800 mil") — nunca convertido em número. `null`
   * quando nenhuma ordem de grandeza foi mencionada. */
  valor_mencionado: string | null;
  evidencia: string;
}

/** Um item já ACUMULADO em `sessoes_copiloto.inventario_acumulado` — mesmos
 * campos do item bruto, mais o controle de deduplicação/atualização que só
 * existe depois que o item entrou no acumulador (`server/copiloto/
 * inventario.ts::acumularInventario`). Upsert por `chave` (descrição
 * normalizada + categoria) — nunca delete+insert (regra da casa,
 * "anti-piscada": item já registrado não some por não ter sido repetido na
 * janela de 90s mais recente). */
export interface ItemInventarioAcumulado extends ItemInventarioMencionado {
  /** Chave de deduplicação — descrição normalizada (minúsculas, sem acento,
   * espaços colapsados) + categoria. Não exposta à IA; é detalhe interno do
   * acumulador. */
  chave: string;
  primeira_mencao_em: string;
  ultima_mencao_em: string;
}

/** `sessoes_copiloto.inventario_acumulado` (jsonb) — o array completo de
 * itens já vistos nesta sessão, TODAS as categorias, TODAS as posses. É o
 * que `acumularInventario` lê e escreve; NUNCA é o que vai para a IA (ver
 * `ResumoInventarioAcumulado` abaixo) — mandar a lista item a item de volta
 * ao contexto cresceria sem teto ao longo da sessão, contra a trava física
 * do p95 do ciclo (9.191 ms medido 15/09, `contexto.ts`). */
export type InventarioAcumulado = ItemInventarioAcumulado[];

/** O que REALMENTE entra no `ContextoCopiloto` (bloco G) — resumo por
 * categoria, nunca a lista item a item (teto físico de bytes/latência, ver
 * comentário de `InventarioAcumulado`). Serve para a IA saber "o que já foi
 * levantado" sem reenviar tudo: contagens + o que falta (titularidade
 * ausente), nunca o texto completo de cada item. */
export interface ResumoCategoriaInventario {
  categoria: CategoriaInventarioMencionado;
  /** Só itens com `posse:"propria"` (regra de contagem do pedido do dono —
   * "de fato"). */
  contagem_propria: number;
  /** Itens com `posse:"incerta"` — "a confirmar", nunca somado acima. */
  contagem_incerta: number;
  /** Quantos itens de posse própria AINDA não têm `titularidade` — o que
   * falta perguntar, mesmo padrão de `falta_no_bloco`. */
  sem_titularidade: number;
}

/** Bloco G do contexto de IA — resumo por categoria + total falado em
 * português (mesma frase de fechamento do script, PARTE 03: "estamos
 * falando aproximadamente de um patrimônio de R$ [X], distribuído dessa
 * forma"). `total_itens_proprios` é a CONTAGEM que responde ao pedido do
 * dono ("lógica de contagem com base nas empresas que eles consideram como
 * deles de fato") — nunca inclui `terceiro`, nunca inclui `incerta`. */
export interface ResumoInventarioAcumulado {
  por_categoria: ResumoCategoriaInventario[];
  total_itens_proprios: number;
  total_itens_incertos: number;
}

/** O que entra na IA, montado no servidor (server/copiloto/contexto.ts).
 * 🔴 17/09/2026: a fronteira de PII original ("nenhum nome de decisor,
 * nenhum valor de patrimônio") foi REVERTIDA por decisão do Marcio ("pode
 * liberar tudo pra IA, patrimônio, documentos, tudo" — vault `05 Decisoes/
 * 2026-09-17 - SIC-HF dossie completo liberado para a IA.md`). O que entra
 * agora é `dossie` (rótulo/contagem/nome — nunca valor monetário nem
 * conteúdo de documento, por orçamento de byte, não por LGPD — ver
 * `server/copiloto/dossie.ts`). Exportado para o teste de mesa do montador
 * de contexto. */
export interface ContextoCopiloto {
  /** De onde veio o roteiro deste contexto (14/09/2026, achado em produção:
   * `sessoes_viabilidade.roteiro_versao_id` só é carimbado no 1º SIM —
   * `registrar_sim_sessao`, 0030 — então toda sessão nova começa sem ele).
   * `'carimbado'` = `roteiro_versao_id` da própria sessão (o roteiro que
   * REALMENTE conduziu, se já houve 1º SIM). `'ativo_fallback'` = nenhum
   * carimbo ainda; usou o roteiro ATIVO global (`roteiros_versoes` da chave
   * 'sessao_viabilidade') só para o copiloto não ficar cego antes do 1º SIM —
   * este módulo NUNCA escreve esse fallback de volta em
   * `sessoes_viabilidade.roteiro_versao_id` (carimbar é ato de
   * `registrar_sim_sessao`, com autoria; o copiloto só lê). `'nenhum'` = sem
   * carimbo e sem versão ativa da chave — `bloco_atual` fica `null`, como
   * antes desta correção. Fica gravado em `copiloto_sugestoes.conteudo`
   * (via `execucoes_ia`/contexto enviado) para auditoria futura de por que a
   * IA sugeriu o que sugeriu. */
  roteiro_fonte: "carimbado" | "ativo_fallback" | "nenhum";
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
  /** 17/09/2026 — "a IA passa a conhecer a família do cliente"
   * (server/copiloto/dossie.ts). Montado 1× por sessão e persistido em
   * `sessoes_copiloto.dossie_cliente`; este módulo só LÊ o que já foi
   * gravado (nunca remonta a cada ciclo — o p95 do ciclo não comporta uma
   * 5ª/6ª/7ª query por chamada). `null` só na primeira leitura de uma
   * sessão sem `pessoa_id` resolvível (nunca deveria acontecer em produção
   * — toda sessão tem jornada, toda jornada tem pessoa). */
  dossie: DossieCliente | null;
  /** 17/09/2026 — bloco G: resumo por categoria do inventário MENCIONADO na
   * fala (`server/copiloto/inventario.ts`). `null` só quando o kill-switch
   * `copiloto_sessao.inventario_mencionado` está desligado, OU a sessão
   * ainda não teve nenhum item acumulado — NUNCA a lista item a item (teto
   * físico, ver `ResumoInventarioAcumulado`). Serve para a IA não repetir
   * pergunta já respondida e notar o que falta (ex.: "três imóveis citados,
   * nenhum com titularidade"). */
  inventario_resumo: ResumoInventarioAcumulado | null;
  /** `sessoes_copiloto.resumo_acumulado` como está — ninguém reescreve nesta fatia. */
  resumo_acumulado: Record<string, unknown>;
  /** Ids de todos os blocos do roteiro ativo — é contra ISTO que o servidor
   * confere `bloco_id` na validação pós-Zod (nunca contra a lista da IA). */
  roteiro_ativo_blocos_ids: string[];
  /** Fase 12, Fatia 1 — `(id, titulo, objetivo)` de TODOS os blocos do
   * roteiro ativo, SEM `falas` nem `proibido` (mesmo raciocínio de peso do
   * `bloco_atual` acima: só o essencial para a IA reconhecer QUAL bloco a
   * conversa está tocando, nunca o roteiro verbatim). É o que sustenta
   * `bloco_inferido` na saída — sem isto a IA não teria como reconhecer um
   * bloco que não seja o atual (ela só recebia o corpo do bloco corrente até
   * esta fatia). */
  roteiro_ativo_blocos: BlocoResumoRoteiro[];
}

/** Recorte `(id, titulo, objetivo)` de um bloco do roteiro — usado só para a
 * IA reconhecer o roteiro INTEIRO sem o peso de `falas`/`proibido`/`campos`/
 * `observar` de cada bloco (Fase 12, Fatia 1). */
export interface BlocoResumoRoteiro {
  id: string;
  titulo: string;
  objetivo: string | null;
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
  /** Fase 12, Fatia 1 — em que bloco a IA entende que a conversa está agora
   * (defeito-raiz: antes só a tela sabia). `?:` (não `| null` obrigatório)
   * pelo MESMO motivo de `EstadoCopilotoComPolling.expurgo_segmentos_em`:
   * contrato novo por composição sobre um tipo que
   * `PainelCopiloto.test.tsx` já literaliza — tornar obrigatório quebraria
   * testes do front sem ganho de segurança (campo ausente e `null`
   * significam a mesma coisa: "a IA não identificou o bloco nesta rodada").
   * `null`/ausente é o valor honesto quando a fala dos últimos ~90s não
   * permite identificar com segurança — NUNCA "o bloco anterior por
   * inércia" (regra do prompt, 0106). */
  bloco_inferido?: { bloco_id: string; confianca: number; evidencia: string } | null;
  /** 17/09/2026 — itens de inventário NOVOS propostos nesta chamada, já
   * validados (evidência conferida) e cortados nos tetos de `schema.ts`.
   * `[]` é o valor normal (a maioria das janelas de ~90s não menciona bem
   * novo) — não confundir com "sessão sem inventário", que é o array vazio
   * em `sessoes_copiloto.inventario_acumulado` (a ROTA acumula estes itens
   * lá, este campo aqui é só o DELTA desta chamada, para telemetria/auditoria
   * de `copiloto_sugestoes.conteudo`, mesmo padrão dos outros campos desta
   * interface). `?:` pelo mesmo motivo de `bloco_inferido`: contrato novo
   * por composição, sem quebrar literais de teste do front. */
  inventario_mencionado?: ItemInventarioMencionado[];
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
  /** Fase 12, Fatia 1 (correção de escopo do arquiteto — ver comentário de
   * topo do bloco "FASE 12" mais abaixo neste arquivo). O bloco atual já
   * resolvido pelo SERVIDOR (fixação manual recente vence; senão, a última
   * inferência da IA gravada em `copiloto_sugestoes.bloco_id`; senão,
   * indisponível) — substitui a dependência de `bloco_atual_id` (herdado de
   * `EstadoCopiloto`, que continua existindo por compatibilidade e reflete
   * o MESMO valor quando `bloco_id` não é nulo). `?:` pelo mesmo motivo do
   * campo acima: contrato novo por composição, sem quebrar literais de
   * teste do front. */
  bloco_atual_resolvido?: BlocoAtualResolvido;
  /** Fase 12, Fatia 5a (0117) — inventário patrimonial MENCIONADO na fala,
   * já resumido no servidor (`ItemInventarioRecentePainel`/
   * `InventarioParaPainel`, mais acima neste arquivo). `null`/ausente
   * (kill-switch `copiloto_sessao.inventario_mencionado` desligado, ou
   * sessão sem item acumulado ainda) faz a célula da tela sumir — nunca um
   * objeto com contagens zeradas. `?:` pelo mesmo motivo dos campos
   * acima: contrato novo por composição, sem quebrar literais de teste do
   * front. */
  inventario?: InventarioParaPainel | null;
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
  /** Bot autenticado no Zoom (17/09/2026) — link de Zoom mas
   * `integracoes_zoom.recall_credential_id` ainda NULL (conta não
   * autorizada em Admin → Integrações). Só ocorre para link de Zoom; Meet
   * nunca passa por esta checagem. */
  | "zoom_nao_autorizado"
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

// ---------------------------------------------------------------------------
// FASE 12, FATIA 1 — correção do defeito-raiz "o servidor não tem 'onde a
// advogada está agora', só a tela tem" (comentário antigo de `estado.ts`,
// agora falso: o servidor INFERE o bloco a partir da fala real). ESCOPO
// REDUZIDO de propósito pelo arquiteto na 2ª rodada desta fatia: NENHUMA
// tabela nova, NENHUMA coluna nova — `copiloto_sugestoes.bloco_id` (0091) JÁ
// EXISTE e é onde a inferência grava (a coluna nasceu em 0091 pensada para
// "desvio sugerido"; esta fatia REINTERPRETA o mesmo campo como "bloco onde
// a IA entende que a conversa está", sem quebrar o significado de
// `desvio_sugerido.bloco_id`, que é OUTRO conceito — ver `schema.ts` para a
// distinção). `0106` é só DML: 1 chave de configuração
// (`copiloto_sessao.inferencia_bloco_ativa`) + o prompt v1 atualizado com a
// regra nova. Sobe LIGADO (pedido do dono) — é correção de cegueira medida,
// não risco novo: a tela continua podendo fixar manualmente por `?bloco=`,
// que passa a valer como PRECEDÊNCIA temporária sobre a inferência, nunca é
// removido (reversão sem deploy: `?bloco=` sempre funciona; a chave
// `inferencia_bloco_ativa=false` desliga só a inferência automática).
// Contrato entre BACK e FRONT: o `frontend-engineer` importa daqui, não
// redefine.
// ---------------------------------------------------------------------------

/**
 * O bloco atual já resolvido pelo SERVIDOR — o que `montarEstadoCopiloto`
 * devolve depois de aplicar a precedência entre a fixação manual (`?bloco=`
 * recente) e a última inferência da IA gravada em
 * `copiloto_sugestoes.bloco_id`.
 *
 * `origem: "indisponivel"` é um valor de PRIMEIRA CLASSE, nunca um índice 0
 * disfarçado: nem a fixação manual nem a inferência resolveram um bloco
 * ainda (sessão nova, inferência desligada e nenhum `?bloco=` recente) — a
 * tela deve mostrar "aguardando" ou equivalente, NUNCA "Parte 1" como se
 * fosse um fato (CLAUDE.md: "nada de dado inventado na tela").
 */
export interface BlocoAtualResolvido {
  /** Id do bloco no roteiro ativo. `null` = nem fixação nem inferência
   * resolveram um bloco ainda. */
  bloco_id: string | null;
  /** Índice do bloco na lista de blocos do roteiro ativo. `null` quando
   * `bloco_id` é `null` — nunca 0 por default. */
  indice: number | null;
  /** Título do bloco, como está no roteiro ativo AGORA — nunca inventado;
   * `null` junto com `bloco_id: null`, ou se o `bloco_id` resolvido não casa
   * mais com nenhum bloco do roteiro ativo (ex.: o roteiro ativo trocou no
   * meio da sessão). */
  titulo: string | null;
  origem: "inferido" | "fixado_manualmente" | "indisponivel";
  /** 0 a 1 quando `origem === "inferido"`; `null` nos outros dois casos. */
  confianca: number | null;
  /** Instante da decisão que resolveu este bloco — `criado_em` da sugestão
   * mais recente com `bloco_id` não nulo, para `"inferido"`; o instante da
   * fixação, para `"fixado_manualmente"`; `null` para `"indisponivel"`. */
  decidido_em: string | null;
  /** Só preenchido quando `origem === "fixado_manualmente"` — quando a
   * fixação deixa de valer e a inferência volta a decidir sozinha. */
  fixacao_expira_em: string | null;
}

// ---------------------------------------------------------------------------
// FASE 12, FATIA 5a (0117, 17/09/2026) — o inventário patrimonial mencionado
// (types acima, "17/09/2026 — inventário patrimonial MENCIONADO NA FALA")
// já é ACUMULADO em `sessoes_copiloto.inventario_acumulado` desde a 0111,
// mas nunca chegou ao PAINEL AO VIVO — só ao contexto de IA
// (`ContextoCopiloto.inventario_resumo`, resumo por categoria). Achado:
// sessão real com 18 itens com evidência literal, zero visíveis na tela.
// ---------------------------------------------------------------------------

/** Um item recente do inventário, PARA A TELA — mesmo recorte de
 * `ItemInventarioAcumulado` menos `chave` (detalhe interno de deduplicação,
 * nunca exposto fora de `server/copiloto/inventario.ts`). Inclui
 * `evidencia`: é a citação literal que a advogada usa para confirmar o item
 * na tela — DIFERENTE do resumo por categoria que vai para a IA
 * (`ResumoInventarioAcumulado`, que nunca leva evidência nem item a item,
 * por orçamento de byte no PROMPT). O teto de "5 mais recentes" é do PAINEL,
 * não da IA — ver `EstadoCopilotoComPolling.inventario` abaixo. */
export interface ItemInventarioRecentePainel {
  categoria: CategoriaInventarioMencionado;
  descricao: string;
  titularidade: string | null;
  posse: PosseInventarioMencionado;
  valor_mencionado: string | null;
  evidencia: string;
  primeira_mencao_em: string;
  ultima_mencao_em: string;
}

/**
 * O que `GET /api/sessoes/[id]/copiloto` expõe do inventário acumulado desta
 * sessão — Fase 12, Fatia 5a. `null` quando o kill-switch
 * `copiloto_sessao.inventario_mencionado` está desligado (mesma chave que já
 * controla o bloco G do contexto de IA, 0111 — desligar é sobre o que se
 * EXIBE, não sobre o que se ACUMULA) OU quando a sessão ainda não tem nenhum
 * item acumulado — nunca um objeto com contagens zeradas fingindo "0 itens
 * levantados" (vazio é vazio, nunca zero, regra da casa).
 *
 * 🔴 NUNCA o array `InventarioAcumulado` bruto: mandar todos os itens (18 na
 * sessão que motivou esta fatia) com citação a cada 3s de polling é banda
 * paga para redesenhar a MESMA lista ~1.800× por sessão. `resumo` é o mesmo
 * `resumirInventario()` que já alimenta a IA (`server/copiloto/
 * inventario.ts`, zero lógica nova) e `recentes` é um corte fixo dos 5 itens
 * de `ultima_mencao_em` mais recente, COM evidência — o suficiente para a
 * advogada conferir o que acabou de ser dito sem esperar o fim da sessão. */
export interface InventarioParaPainel {
  resumo: ResumoInventarioAcumulado;
  /** Até 5 itens, mais recentes primeiro (por `ultima_mencao_em`). `[]`
   * quando o acumulado existe mas está vazio (nunca deveria acontecer na
   * prática — `inventario_acumulado` só é gravado com item dentro — mas o
   * tipo não assume isso). */
  recentes: ItemInventarioRecentePainel[];
}
