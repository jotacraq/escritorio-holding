import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoBool, lerConfiguracaoInt } from "@/server/ia/configuracao";
import { redigirEvidenciasInventario, temEvidenciaNaoRedigidaNoInventario } from "@/server/copiloto/inventario";
import type { InventarioAcumulado, SugestaoCopiloto } from "@/types/copiloto";

/**
 * Expurgo de `sessoes_copiloto_segmentos` por idade — Fase 10, Fatia 5
 * (docs/ARQUITETURA-FASE-10.md §8 Fatia 5, §10 B69). Fecha o B19, aberto
 * desde a Fase 7. MESMO PADRÃO de `server/ligacao-ia/expurgo.ts`
 * (`etapaExpurgoLigacoesIa`) — lote com teto, seleciona antes de escrever,
 * chave de configuração ausente/desligada nunca apaga nada — com duas
 * diferenças que este domínio exige:
 *
 *   1. DOIS interruptores, não um. `ligacao_ia.retencao_dias` é uma chave só
 *      (ausente = não expurga). Aqui a REGRA DURA do coordenador é mais
 *      forte ("mais sério que nas outras fatias... expurgo ligado por
 *      engano destrói fala de cliente de forma irreversível"): o PRAZO
 *      (`copiloto_sessao.retencao_dias_segmentos`, existe desde a 0091 com
 *      valor 7) e a AUTORIZAÇÃO de apagar
 *      (`copiloto_sessao.expurgo_ativo`, 0098, nasce 'false') são chaves
 *      SEPARADAS de propósito — mudar o prazo não liga o apagamento sozinho.
 *      As DUAS têm de estar corretas para qualquer DELETE acontecer.
 *   2. 🔴 ORDEM: só expurga segmento de sessão com `transcricao_id IS NOT
 *      NULL` (consolidada por `consolidar.ts`, chamada em
 *      `executarEncerramentoCopiloto`). Segmento apagado sem a transcrição
 *      consolidada é fala do cliente perdida PARA SEMPRE — e o Agente do
 *      Croqui, que lê `transcricoes` (não `sessoes_copiloto_segmentos`),
 *      fica sem insumo. Prova dessa ordem: `expurgo.test.ts` (sessão sem
 *      `transcricao_id`, mesmo com segmentos vencidos há 100 dias, não perde
 *      nenhuma linha).
 *   3. 🔴 BACKSTOP NO DELETE (achado do coordenador — "fala digitada depois
 *      do encerramento é destruída em silêncio", errata §6.2.2 aplicada
 *      aqui: trava no CAMINHO DE SAÍDA, não só na feature que grava).
 *      `removerSegmentosVencidos` só apaga segmento com `criado_em <=
 *      sessoes_copiloto.encerrado_em` — mesmo que a trava de rota
 *      (`POST .../copiloto/segmentos` recusando sessão `'encerrado'`/
 *      `'erro'`) seja reintroduzida com um buraco no futuro, este módulo
 *      NUNCA apaga um segmento gravado depois do encerramento. Sessão sem
 *      `encerrado_em` conhecido é FAIL-CLOSED (nada dela é apagado).
 *
 * O QUE É REMOVIDO, E O QUE FICA (rastro — nunca DELETE silencioso):
 *   - `sessoes_copiloto_segmentos` das sessões elegíveis: DELETE de verdade
 *     (não é PII "resumível" como `ligacoes_ia.transcricao`, é a fala bruta
 *     inteira, ~180 linhas por sessão — zerar campo a campo seria manter
 *     lixo estrutural sem função, o que o critério de otimização do Fable
 *     reprova).
 *   - `sessoes_copiloto` (a linha-PAI) NUNCA é apagada — só ganha
 *     `expurgo_segmentos_em`/`expurgo_segmentos_motivo` preenchidos, e SÓ
 *     depois que TODOS os segmentos daquela sessão já saíram (nunca
 *     carimbado "pela metade": um expurgo interrompido no meio de uma
 *     sessão fica sem carimbo e a PRÓXIMA passagem retoma essa mesma sessão
 *     — idempotente e retomável, precedente do "expurgo de Storage em 3
 *     tempos", Fase 7/0080).
 *   - `transcricoes` (a consolidada) NUNCA é tocada por este módulo — é
 *     permanente, por desenho (§6.1 do plano).
 *   - 🔴 `copiloto_sugestoes.conteudo` das sessões cujo expurgo de segmentos
 *     é CONCLUÍDO nesta passagem: os campos `evidencia` (citação literal da
 *     fala do cliente, em `proxima_pergunta`/`falta_no_bloco[]`/
 *     `observacao`/`bloco_inferido`) são REDIGIDOS (ver
 *     `redigirEvidenciasConteudo`/`redigirSugestoesDaSessao`) — achado do
 *     `security-pentester`, Fase 12 Fatia 1: sem isto, a citação sobrevivia
 *     INDEFINIDAMENTE ao insumo que a originou (`copiloto_sugestoes` só tem
 *     `on delete cascade` de `sessoes_viabilidade`, nunca apagada por
 *     rotina). A LINHA inteira nunca é apagada (é histórico de decisão da
 *     IA, auditável) — só a citação, no mesmo instante em que a fala bruta
 *     correspondente sai de `sessoes_copiloto_segmentos`.
 *   - 🔴 `sessoes_copiloto.inventario_acumulado` (0111) das sessões cujo
 *     expurgo de segmentos é CONCLUÍDO nesta passagem: o campo `evidencia`
 *     de CADA item do array é REDIGIDO (ver `redigirEvidenciasInventario`
 *     em `inventario.ts`) — achado do `security-pentester`, MESMA CLASSE do
 *     item acima, achado no dia seguinte (17/09/2026) num campo que nasceu
 *     na 0111: `inventario_acumulado[].evidencia` também é citação literal
 *     ("a sala comercial no centro é minha e da minha irmã, comprei há 8
 *     anos") e, sem isto, sobreviveria à fala bruta expurgada. `categoria`/
 *     `descricao`/`titularidade`/`posse`/`valor_mencionado` sobrevivem — só
 *     a citação sai (o LEVANTAMENTO continua valendo).
 *
 *   ⛔ `dossie_cliente` (0109) — proposital FORA desta redação. O pentester
 *   foi preciso: aquilo é ESPELHO de dado CADASTRAL que já existe
 *   PERMANENTEMENTE em `familiares`/`patrimonio_itens`/`documentos` (não é
 *   evidência de FALA transitória como os dois casos acima). A retenção do
 *   dossiê é decisão de PRODUTO pendente com o dono — não bug a corrigir
 *   nesta correção cirúrgica.
 */

const LOTE_SEGMENTOS = 1000; // teto por passada — ~5-6 sessões inteiras (~180 seg/sessão, §2.1 do plano)
const LOTE_SESSOES_ELEGIVEIS = 50; // teto de sessões avaliadas por passada, antes mesmo de contar segmento

export const CHAVE_EXPURGO_ATIVO = "copiloto_sessao.expurgo_ativo";
export const CHAVE_RETENCAO_DIAS_SEGMENTOS = "copiloto_sessao.retencao_dias_segmentos";
const PADRAO_RETENCAO_DIAS = 7;

export interface ResultadoExpurgoCopiloto {
  /** Segmentos (linhas de `sessoes_copiloto_segmentos`) removidos nesta passada. */
  segmentosRemovidos: number;
  /** Sessões cujo expurgo foi CONCLUÍDO (todos os segmentos removidos OU
   * todos os vencidos restantes retidos pelo backstop, carimbo gravado). */
  sessoesConcluidas: number;
  /** 🔴 Achado (i) do Fable, revisão da Fatia 5: o CONTADOR PRÓPRIO que torna
   * a anomalia "segmento pós-encerramento retido" VISÍVEL DE VERDADE no
   * resultado do cron — não só descobrível por SQL direto. `0` no caminho
   * normal (a imensa maioria das passagens); `> 0` sinaliza que existiu
   * corrida (webhook tardio) nesta passagem — preservado, nunca perdido. */
  sessoesComSegmentosRetidos: number;
  /** 🔴 Achado do Fable (otimização, defeito 3 — "falha de redação fica
   * muda"): sessão carimbada (expurgo de segmentos concluído) cuja REDAÇÃO
   * da citação literal em `copiloto_sugestoes.conteudo` falhou
   * (`redigirSugestoesDaSessao`). `0` no caminho normal; `> 0` sinaliza que
   * existe evidência literal ainda gravada além do prazo de retenção — a
   * sessão já saiu do pool (`buscarSessoesElegiveis`), então nenhuma
   * passagem futura tenta de novo sozinha; investigação manual necessária. */
  sessoesComFalhaDeRedacao: number;
  /** 🔴 Achado do Fable (otimização) — nº de sessões cuja redação bateu o
   * teto de `LOTE_SUGESTOES_REDACAO` (200) nesta passada: sinal de
   * SUB-PROCESSAMENTO (sobrou sugestão daquela sessão não avaliada). Hoje
   * inalcançável com `teto_ia_sessao=90` — garantia frágil, sinalizada aqui
   * para não depender de ninguém lembrar de checar o teto do produto. */
  sessoesComRedacaoParcial: number;
  /** 🔴 Achado do `security-pentester` (17/09/2026) — MESMA CLASSE de
   * `sessoesComFalhaDeRedacao`, aplicada a `sessoes_copiloto.
   * inventario_acumulado`: sessão carimbada cuja REDAÇÃO da citação literal
   * em `inventario_acumulado[].evidencia` falhou (`redigirInventarioDaSessao`).
   * `0` no caminho normal; `> 0` sinaliza evidência literal ainda gravada
   * além do prazo de retenção — a sessão já saiu do pool, nenhuma passagem
   * futura tenta de novo sozinha; investigação manual necessária. */
  sessoesComFalhaDeRedacaoInventario: number;
  /** `expurgo_desligado` = `copiloto_sessao.expurgo_ativo` != true (default e estado seguro).
   * `sem_retencao_configurada` = a chave do prazo não é um inteiro positivo válido. */
  pulada?: "expurgo_desligado" | "sem_retencao_configurada";
  retencaoDias?: number;
  /** `true` quando o LOTE de segmentos encheu — a próxima passagem do cron continua
   * (mesma semântica de `resta_lote` em `ResultadoExpurgoLigacoes`). */
  restaLote?: boolean;
  erro?: string;
}

interface ErroPostgrest {
  code?: string;
}

interface SessaoElegivel {
  sessao_id: string;
  encerrado_em: string | null;
}

/**
 * Sessões cujos segmentos JÁ PODEM ser avaliados para expurgo: transcrição
 * consolidada (regra dura §🔴 acima) E ainda não carimbadas
 * (`expurgo_segmentos_em is null` — não reavalia sessão já concluída a cada
 * passada, mesmo que ela não tenha segmento nenhum sobrando). Não filtra por
 * IDADE aqui: a idade é por SEGMENTO (`sessoes_copiloto_segmentos.criado_em`),
 * não por sessão — uma sessão pode ter segmentos velhos e novos misturados
 * (fala digitada meses depois de uma sessão antiga, por exemplo) e o corte
 * certo é por linha, não por sessão inteira.
 *
 * 🔴 `order by criado_em asc` — NÃO É COSMÉTICO. Sem ordem, o teto de
 * `LOTE_SESSOES_ELEGIVEIS` (50) poderia devolver, passagem após passagem, o
 * MESMO conjunto arbitrário de sessões recém-consolidadas (segmento ainda
 * dentro do prazo, nada a fazer nesta passada) enquanto sessões MAIS
 * ANTIGAS — as que de fato têm segmento vencido — nunca entram no lote
 * porque o Postgres não garante ordem sem `order by` explícito. Com FIFO
 * (mais antiga primeiro), o pior caso é 50 sessões "ainda não venceram" por
 * ALGUMAS passagens seguidas — nunca starvation permanente: o tempo passa,
 * as mais antigas da fila vencem e saem (carimbadas), abrindo vaga para a
 * próxima leva. Nenhuma sessão fica presa atrás de outra mais nova para
 * sempre (a lição do vault: "fila com teto por passada — conferir a
 * aritmética teto × intervalo × janela, senão parte da lista fica de fora
 * sem erro nenhum").
 *
 * 🔴 Traz `encerrado_em` junto (achado do coordenador — "fala digitada
 * depois do encerramento é destruída em silêncio"): é o dado que
 * `removerSegmentosVencidos` usa como BACKSTOP no próprio caminho do
 * DELETE — mesma leitura, sem 2ª ida ao banco.
 */
async function buscarSessoesElegiveis(admin: SupabaseClient): Promise<Map<string, string | null>> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .select("sessao_id, encerrado_em")
    .not("transcricao_id", "is", null)
    .is("expurgo_segmentos_em", null)
    .order("criado_em", { ascending: true })
    .limit(LOTE_SESSOES_ELEGIVEIS)
    .returns<SessaoElegivel[]>();
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.sessao_id, s.encerrado_em]));
}

/**
 * Remove, EM UM LOTE COM TETO (`LOTE_SEGMENTOS`, nunca um DELETE sem limite
 * — regra dura do PROTOCOLO-SUSTENTABILIDADE, "fila com teto por passada"),
 * os segmentos vencidos das sessões elegíveis. Seleciona os ids ANTES de
 * apagar (mesmo padrão de `etapaExpurgoLigacoesIa`): permite contar
 * exatamente o que saiu e nunca depende de um DELETE...WHERE sem visibilidade
 * do que foi afetado.
 *
 * 🔴 BACKSTOP (achado do coordenador — "fala digitada depois do
 * encerramento é destruída em silêncio", trava no CAMINHO DE SAÍDA, não só
 * na feature — errata §6.2.2 aplicada ao expurgo). A correção (a) —
 * `POST .../copiloto/segmentos` recusando sessão `'encerrado'`/`'erro'` —
 * fecha o caminho NORMAL, mas não cobre a corrida (POST em voo no instante
 * exato do encerramento). Por isso este módulo NUNCA confia só na correção
 * de rota: um segmento só é ELEGÍVEL AO DELETE se, além de vencido por
 * idade (`criado_em < limiteIso`), também satisfizer
 * `criado_em <= sessoes_copiloto.encerrado_em` — a mesma condição, escrita
 * no ÚNICO lugar que pode efetivamente apagar a linha. Um segmento gravado
 * DEPOIS do encerramento (por qualquer caminho, presente ou futuro) NUNCA
 * é apagável por este job — mesmo que alguém reintroduza o buraco em (a).
 *
 * Sessão SEM `encerrado_em` (não deveria existir aqui — só entra elegível
 * com `transcricao_id` preenchido, e `transcricao_id` só é setado depois
 * de `marcarEncerrada`, que carimba `encerrado_em` na mesma transação de
 * negócio, `encerrar.ts`) fica FAIL-CLOSED: nenhum segmento dela é
 * apagado nesta passagem — "não saber quando encerrou" não é licença para
 * apagar, mesmo raciocínio de `copilotoEstaAtivo`/`conferirGateCopiloto`.
 *
 * Filtro aplicado em MEMÓRIA sobre o lote já trazido pelo banco (não uma
 * 2ª query por sessão): o volume por passagem é pequeno por desenho
 * (LOTE_SEGMENTOS=1000, LOTE_SESSOES_ELEGIVEIS=50), e o predicado do banco
 * (`sessao_id in (...) and criado_em < limiteIso`) já usa o índice do
 * caminho quente (`idx_copiloto_segmentos_polling`) — o backstop não muda
 * o plano de consulta, só decide o que do lote trazido é de fato apagável.
 *
 * 🔴 `sessoesComVencidoNaoApagavel` (achado (ii) do Fable via coordenador,
 * revisão da Fatia 5 — "o pool não pode saturar NEM NO RARO"). Cobre o
 * caso RESIDUAL que a 1ª versão desta correção deixava passar: uma sessão
 * cujo `trazidas` tem linha vencida, mas NENHUMA delas é apagável (0%, não
 * "sobrou uma parte") — hoje só acontece sem `encerrado_em` conhecido (o
 * comentário abaixo já registra que "não deveria existir", mas o schema
 * NÃO impede: `sessoes_copiloto.encerrado_em` é nullable sem CHECK que
 * amarre a `transcricao_id`). Sem devolver esse conjunto, essa sessão
 * NUNCA entraria em `sessoesAfetadas` (que só contém quem teve DELETE de
 * verdade) e `carimbarSessoesSemPendencia` jamais a avaliaria — o MESMO
 * starvation do achado (ii), por um caminho diferente.
 */
async function removerSegmentosVencidos(
  admin: SupabaseClient,
  sessoesElegiveis: Map<string, string | null>,
  limiteIso: string,
): Promise<{
  removidos: number;
  encheuLote: boolean;
  sessoesAfetadas: Set<string>;
  sessoesComVencidoNaoApagavel: Set<string>;
}> {
  const sessaoIds = [...sessoesElegiveis.keys()];
  const { data, error } = await admin
    .from("sessoes_copiloto_segmentos")
    .select("id, sessao_id, criado_em")
    .in("sessao_id", sessaoIds)
    .lt("criado_em", limiteIso)
    .limit(LOTE_SEGMENTOS)
    .returns<{ id: string; sessao_id: string; criado_em: string }[]>();
  if (error) throw error;

  const trazidas = data ?? [];
  if (trazidas.length === 0) {
    return { removidos: 0, encheuLote: false, sessoesAfetadas: new Set(), sessoesComVencidoNaoApagavel: new Set() };
  }

  // 🔴 Backstop: só passa quem tem `encerrado_em` conhecido E o segmento é
  // anterior (ou igual) a esse instante — nunca um segmento pós-encerramento,
  // mesmo que ele tenha "idade" suficiente por `criado_em < limiteIso`.
  //
  // 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5 — "a fronteira
  // <= compara strings de formatos diferentes"). `criado_em` vem do
  // PostgREST como `...123456+00:00` (microssegundos, offset explícito);
  // `encerradoEm` é gerado pela aplicação via `new Date().toISOString()`
  // (`...123Z`, milissegundos, sufixo `Z`). Comparar essas duas strings com
  // `<=` LEXICOGRÁFICO funcionava até agora só por ACIDENTE DE PREFIXO
  // (dígitos de data/hora iguais até o ponto de corte de precisão) — não é
  // garantido pela ordem lexicográfica de formatos DIFERENTES em geral, e o
  // teste de fronteira anterior usava strings do MESMO formato nos dois
  // lados, o que produção nunca faz. `Date.parse` nos dois lados torna a
  // comparação SEMÂNTICA (instantes reais), não textual.
  const apagavel = (l: { sessao_id: string; criado_em: string }): boolean => {
    const encerradoEm = sessoesElegiveis.get(l.sessao_id);
    if (encerradoEm === undefined || encerradoEm === null) return false;
    return Date.parse(l.criado_em) <= Date.parse(encerradoEm);
  };

  const apagaveis = trazidas.filter(apagavel);

  // Sessões cujo `trazidas` tem linha, mas NENHUMA é apagável — precisam
  // ser avaliadas por `carimbarSessoesSemPendencia` mesmo sem terem tido
  // DELETE nesta passagem (achado (ii), ver comentário de topo desta
  // função). Calculado ANTES de qualquer early-return, para nenhum caso
  // escapar da avaliação.
  const sessoesComAlgumVencido = new Set(trazidas.map((l) => l.sessao_id));
  const sessoesComAlgumApagavel = new Set(apagaveis.map((l) => l.sessao_id));
  const sessoesComVencidoNaoApagavel = new Set(
    [...sessoesComAlgumVencido].filter((id) => !sessoesComAlgumApagavel.has(id)),
  );

  // O lote inteiro (`trazidas`) contou para o teto de LOTE_SEGMENTOS mesmo
  // que parte fique retida pelo backstop — `encheuLote` reflete o que o
  // BANCO devolveu (o teto real da query), não o que foi de fato apagado.
  const encheuLote = trazidas.length === LOTE_SEGMENTOS;

  if (apagaveis.length === 0) {
    return { removidos: 0, encheuLote, sessoesAfetadas: new Set(), sessoesComVencidoNaoApagavel };
  }

  const ids = apagaveis.map((l) => l.id);
  const { error: erroDelete } = await admin.from("sessoes_copiloto_segmentos").delete().in("id", ids);
  if (erroDelete) throw erroDelete;

  return {
    removidos: ids.length,
    encheuLote,
    sessoesAfetadas: sessoesComAlgumApagavel,
    sessoesComVencidoNaoApagavel,
  };
}

/**
 * Carimba `expurgo_segmentos_em`/`_motivo` nas sessões CANDIDATAS (o
 * chamador — `etapaExpurgoSegmentosCopiloto` — une três origens distintas:
 * `sessoesAfetadas`, `sessoesComVencidoNaoApagavel` e `sessoesEsvaziadas`;
 * ver o comentário daquela função para o porquê de cada uma). A regra:
 * carimba SÓ quando não há mais NENHUM segmento vencido APAGÁVEL restante.
 * Isso evita três erros distintos, não dois:
 *
 *   - carimbar "pela metade" (sobrou vencido APAGÁVEL, o teto da QUERY DE
 *     LEITURA de `removerSegmentosVencidos` cortou antes de alcançar essa
 *     linha) — resolvido pela leitura abaixo, que NUNCA carimba enquanto
 *     houver linha vencida que o PRÓXIMO DELETE ainda vai conseguir
 *     remover;
 *   - 🔴 carimbar uma sessão que NUNCA teve nada vencido (todo segmento dela
 *     ainda está dentro do prazo de retenção) — achado do teste
 *     `expurgo.test.ts` ("segmento DENTRO do prazo... sessão NÃO é
 *     carimbada"): `expurgo_segmentos_em` significa "removi algo daqui, ou
 *     confirmei que não sobrava nada apagável", nunca "não olhei";
 *   - 🔴 (5º caminho, achado do Fable via coordenador — "squatter eterno por
 *     soluço de banco") DEIXAR uma sessão elegível com ZERO segmentos
 *     restantes SEM CARIMBO NENHUM. Isso acontecia quando o laço abortava
 *     no meio (um `throw` bastava — timeout de rede, conexão perdida) DEPOIS
 *     dos DELETEs de uma passagem já terem commitado: a sessão ficava
 *     esvaziada, sem carimbo, e como `sessoesAfetadas`/
 *     `sessoesComVencidoNaoApagavel` só existem quando há segmento VENCIDO,
 *     ela nunca mais seria candidata — ETERNAMENTE elegível, ocupando
 *     assento VITALÍCIO na janela do FIFO (`LOTE_SESSOES_ELEGIVEIS`). O
 *     parágrafo anterior deste comentário CHAMAVA esse cenário de
 *     "raríssimo... reavaliada com query vazia, sem custo" — essa
 *     afirmação NÃO SOBREVIVE ao achado (ii) abaixo: elegibilidade eterna
 *     não é "sem custo", é uma vaga permanentemente ocupada. Resolvido por
 *     `buscarSessoesEsvaziadas` (uma query agregada) + isolamento por
 *     sessão neste laço (achado (b) abaixo).
 *
 * 🔴 CORREÇÃO (achado (i)+(ii) do Fable via coordenador, revisão da Fatia 5
 * — "a pendência eterna ressuscita o starvation que você matou"). A versão
 * anterior deste módulo NUNCA carimbava sessão com segmento retido pelo
 * backstop (pós-encerramento) — decisão que parecia certa isolada
 * ("anomalia visível > carimbo falso"), mas quebrava em DUAS frentes
 * quando combinada com as OUTRAS decisões corretas desta fatia:
 *
 *   (i) "Visivelmente pendente" era FALSO: essas sessões não aparecem em
 *       `vw_pendencias_sistema` nem em contador nenhum do JSON do cron — só
 *       SQL direto as encontra. Alerta invisível é pior que alerta que
 *       ninguém apaga (foi o que reprovou a Fatia 4).
 *   (ii) O agravante FUNCIONAL: a sessão nunca-carimbada fica ETERNAMENTE
 *        elegível, e o FIFO (`buscarSessoesElegiveis`, `order by criado_em
 *        asc`) ordena por antiguidade — então essas sessões, envelhecendo,
 *        ocupam PERMANENTEMENTE a frente da janela de 50
 *        (`LOTE_SESSOES_ELEGIVEIS`). Como o gatilho (webhook tardio) é
 *        corrida NORMAL, elas acumulam: na 50ª, o lote vira 100% no-op e
 *        NENHUMA sessão nova é expurgada nunca mais — silenciosamente, cron
 *        devolvendo 200, "funcionando". É exatamente o starvation que o
 *        FIFO existe para matar, ressuscitado pela interação entre três
 *        decisões corretas isoladamente: backstop × FIFO × não-carimbo.
 *
 * A CORREÇÃO: sessão cujos vencidos RESTANTES estão TODOS retidos pelo
 * backstop (nenhum deles é apagável — todos têm `criado_em > encerrado_em`,
 * ou `encerrado_em` desconhecido) SAI DO POOL — carimbada com um motivo
 * DISTINTO e VERDADEIRO (nunca o motivo padrão de "vencida", porque não é
 * bem esse fato: os segmentos retidos CONTINUAM lá, preservados,
 * fail-closed). Só NÃO carimba quando sobra pelo menos 1 vencido APAGÁVEL
 * (o teto da query de leitura cortou antes de chegar nele — caso "pela
 * metade" de sempre, resolvido pela PRÓXIMA passagem sozinha). A distinção
 * exige BUSCAR as linhas restantes (não só `count`), para aplicar o MESMO
 * filtro de backstop que `removerSegmentosVencidos` usa (`Date.parse`,
 * mesma correção da fronteira de formato).
 *
 * (b) 🔴 ISOLAMENTO POR SESSÃO (achado do 5º caminho via coordenador): erro
 * transiente numa sessão específica (timeout de rede, conexão perdida)
 * NUNCA aborta o laço inteiro — os DELETEs de TODA a passagem já
 * commitaram antes deste laço rodar, e um `throw` sacrificaria o carimbo
 * das sessões IRMÃS, produzindo o mesmo squatter. Mesmo isolamento que
 * `rodarEtapa` (`POST /api/cron/regua`) já aplica ENTRE etapas, aplicado
 * ENTRE sessões dentro desta etapa.
 */
interface ResultadoCarimbo {
  concluidas: number;
  /** Sessões carimbadas com segmento pós-encerramento RETIDO (preservado,
   * nunca apagado) — a anomalia visível DE VERDADE (achado (i) do Fable):
   * exposta no resultado do cron, não só em SQL direto. */
  concluidasComRetidos: number;
  /** 🔴 Achado do Fable (otimização, defeito 3 — "falha de redação fica
   * muda"): sessão que foi carimbada (expurgo de segmentos concluído) mas
   * `redigirSugestoesDaSessao` FALHOU para ela — a evidência literal segue
   * gravada em `copiloto_sugestoes.conteudo` além do prazo, sem que nenhuma
   * passagem futura tente de novo sozinha (a sessão já saiu do pool de
   * `buscarSessoesElegiveis`, carimbada). Antes desta correção o único
   * rastro era `registrarErro` (log), invisível no resultado do cron —
   * mesma classe de "alerta que ninguém vê" já corrigida para
   * `sessoesComSegmentosRetidos`. */
  concluidasComFalhaDeRedacao: number;
  /** 🔴 Achado do Fable (otimização) — `LOTE_SUGESTOES_REDACAO` (200) bateu
   * o teto para pelo menos 1 sessão: sinal de SUB-PROCESSAMENTO (sobrou
   * sugestão não avaliada nesta passada) — hoje inalcançável com
   * `teto_ia_sessao=90`, mas é garantia frágil que pode deixar de valer sem
   * aviso se o teto do produto subir. */
  concluidasComLoteCheio: number;
  /** 🔴 Achado do pentester (17/09/2026) — sessão carimbada cuja redação de
   * `inventario_acumulado[].evidencia` FALHOU (ver `sessoesComFalhaDeRedacaoInventario`
   * em `ResultadoExpurgoCopiloto`). Contador SEPARADO de `concluidasComFalhaDeRedacao`
   * (que é sobre `copiloto_sugestoes`) — as duas redações são passos
   * independentes; uma pode falhar sem a outra falhar. */
  concluidasComFalhaDeRedacaoInventario: number;
}

async function carimbarSessoesSemPendencia(
  admin: SupabaseClient,
  candidatas: Set<string>,
  sessoesEsvaziadas: Set<string>,
  sessoesElegiveis: Map<string, string | null>,
  limiteIso: string,
  motivoPadrao: string,
): Promise<ResultadoCarimbo> {
  let concluidas = 0;
  let concluidasComRetidos = 0;
  let concluidasComFalhaDeRedacao = 0;
  let concluidasComLoteCheio = 0;
  let concluidasComFalhaDeRedacaoInventario = 0;

  for (const sessaoId of candidatas) {
    // CORRECAO (achado (b) do 5o caminho via coordenador - "squatter
    // eterno por soluco de banco"). Erro transiente (timeout de rede
    // basta) numa sessao NAO PODE abortar o laco inteiro: os DELETEs da
    // passagem JA COMMITARAM antes deste laco rodar, e um `throw` aqui
    // sacrificaria o carimbo de TODAS as sessoes irmas desta passagem -
    // exatamente o mecanismo que produz o squatter. Mesmo isolamento que
    // `rodarEtapa` ja aplica ENTRE etapas do cron, aplicado ENTRE sessoes
    // dentro desta etapa.
    try {
      const { data, error: erroLeitura } = await admin
        .from("sessoes_copiloto_segmentos")
        .select("criado_em")
        .eq("sessao_id", sessaoId)
        .lt("criado_em", limiteIso)
        .returns<{ criado_em: string }[]>();
      if (erroLeitura) throw erroLeitura;

      const restantes = data ?? [];
      if (restantes.length === 0) {
        // Nada sobrou. Duas origens possiveis, motivo DIFERENTE para cada
        // uma (achado (a) do 5o caminho - "carimbo != nunca teve nada a
        // remover"): sessao ESVAZIADA numa passagem anterior (nunca teve
        // DELETE AGORA, so chegou aqui via `sessoesEsvaziadas`) carrega um
        // motivo que diz isso por escrito; sessao que teve DELETE NESTA
        // passagem usa o motivo padrao de sempre.
        const motivo = sessoesEsvaziadas.has(sessaoId)
          ? "concluido; esvaziada em passagem anterior (carimbo pendente resolvido agora)"
          : motivoPadrao;
        if (await carimbar(admin, sessaoId, motivo)) {
          concluidas++;
          // 🔴 Achado do pentester: expurgo de segmentos concluído para esta
          // sessão → a citação literal em `copiloto_sugestoes.conteudo`
          // (que sobrevivia indefinidamente ao insumo que a originou) sai
          // JUNTO, não numa passagem futura hipotética.
          const resultadoRedacao = await redigirSugestoesDaSessao(admin, sessaoId);
          if (!resultadoRedacao.ok) concluidasComFalhaDeRedacao++;
          if (resultadoRedacao.loteCheio) concluidasComLoteCheio++;
          // 🔴 Achado do pentester (17/09/2026, mesma classe): a citação
          // literal em `sessoes_copiloto.inventario_acumulado[].evidencia`
          // sai JUNTO, no mesmo instante — não numa passagem futura.
          const okInventario = await redigirInventarioDaSessao(admin, sessaoId);
          if (!okInventario) concluidasComFalhaDeRedacaoInventario++;
          // 18/09/2026 (Fatia A da memória do copiloto) — NO-OP deliberado
          // hoje (ver comentário de `redigirResumoDaSessao`); cabeada aqui
          // para o expurgo já CONHECER o campo `resumo_acumulado` antes da
          // Fatia B precisar dele.
          await redigirResumoDaSessao(admin, sessaoId);
        }
        continue;
      }

      // Distingue "sobra que o PROXIMO delete resolve" (nao carimba ainda)
      // de "sobra que NUNCA vai ser apagavel neste job" (carimba com
      // motivo de retencao, sai do pool). Cobre os DOIS caminhos para
      // "nunca apagavel": (a) tudo pos-encerramento (encerradoEm
      // conhecido, mas todo criado_em > encerradoEm); (b) encerradoEm
      // DESCONHECIDO - sem ele, o backstop NUNCA vai conseguir confirmar
      // nenhum segmento como apagavel (fail-closed permanente), entao
      // "sobra" aqui ja significa "nunca resolve sozinho", nao "proxima
      // passagem resolve" - tratar como "pela metade" faria essa sessao
      // ficar eternamente na frente do FIFO (o MESMO starvation do
      // achado (ii), por um caminho diferente).
      const encerradoEm = sessoesElegiveis.get(sessaoId);
      const existeAlgumApagavel =
        encerradoEm !== undefined && encerradoEm !== null && restantes.some((r) => Date.parse(r.criado_em) <= Date.parse(encerradoEm));

      if (existeAlgumApagavel) {
        // Sobra pelo menos 1 vencido APAGAVEL - "pela metade" de verdade,
        // nao carimba ainda (a proxima passagem tenta apagar de novo).
        continue;
      }

      // NADA do que sobrou e apagavel (retido pelo backstop OU
      // encerrado_em desconhecido) - a sessao SAI DO POOL (nao fica presa
      // na frente do FIFO para sempre), com um motivo DISTINTO e
      // VERDADEIRO: os segmentos NAO foram apagados, so deixaram de
      // contar como pendencia de expurgo comum.
      const motivo =
        encerradoEm === undefined || encerradoEm === null
          ? "concluido; " + restantes.length + " segmento(s) sem encerrado_em conhecido, retido(s) por fail-closed (nunca apagados)"
          : "concluido; " + restantes.length + " segmento(s) pos-encerramento retido(s) (nunca apagados)";
      if (await carimbar(admin, sessaoId, motivo)) {
        concluidas++;
        concluidasComRetidos++;
        // Mesmo raciocínio do outro ramo: expurgo desta sessão concluído
        // (mesmo com segmento retido pelo backstop, o motivo de retenção é
        // sobre o SEGMENTO — a evidência já citada em `copiloto_sugestoes`
        // não precisa do segmento vivo para ser redigida).
        const resultadoRedacao = await redigirSugestoesDaSessao(admin, sessaoId);
        if (!resultadoRedacao.ok) concluidasComFalhaDeRedacao++;
        if (resultadoRedacao.loteCheio) concluidasComLoteCheio++;
        // Mesmo raciocínio: retenção pelo backstop é sobre o SEGMENTO — a
        // citação já registrada em `inventario_acumulado` não precisa do
        // segmento vivo para ser redigida.
        const okInventario = await redigirInventarioDaSessao(admin, sessaoId);
        if (!okInventario) concluidasComFalhaDeRedacaoInventario++;
        // Mesmo raciocínio: NO-OP deliberado hoje, cabeada para conhecimento
        // futuro do campo (ver comentário de `redigirResumoDaSessao`).
        await redigirResumoDaSessao(admin, sessaoId);
      }
    } catch (erro) {
      // CORRECAO (achado (b) do 5o caminho via coordenador). Erro nesta
      // sessao especifica (timeout de rede, conexao perdida) NUNCA aborta
      // o laco inteiro - registra e segue para a PROXIMA sessao candidata.
      // A sessao que falhou continua elegivel (sem carimbo) e sera
      // reavaliada na proxima passagem do cron - nunca vira squatter
      // porque `buscarSessoesEsvaziadas`/`sessoesComVencidoNaoApagavel`
      // vao trazê-la de volta as candidatas (ela ainda esta elegivel, com
      // ou sem segmento restante).
      registrarErro("copiloto/expurgo.carimbarSessoesSemPendencia", erro, { sessao_id: sessaoId });
    }
  }

  return {
    concluidas,
    concluidasComRetidos,
    concluidasComFalhaDeRedacao,
    concluidasComLoteCheio,
    concluidasComFalhaDeRedacaoInventario,
  };
}

/**
 * 🔴 CORREÇÃO (5º caminho do Fable via coordenador — "squatter eterno por
 * soluço de banco"). `sessoesAfetadas` e `sessoesComVencidoNaoApagavel`
 * (as duas fontes de candidatas ao carimbo) SÓ existem quando
 * `removerSegmentosVencidos` encontrou pelo menos 1 segmento VENCIDO da
 * sessão nesta passagem. Uma sessão elegível com ZERO segmentos restantes
 * (esvaziada numa passagem ANTERIOR cujo laço de carimbo abortou por erro
 * transiente — timeout de rede basta, ver achado (b) abaixo — ou cujo
 * processo morreu entre o DELETE e o carimbo) nunca aparece em nenhum dos
 * dois conjuntos: nunca é candidata, nunca é carimbada, fica ETERNAMENTE
 * elegível — e o FIFO por `criado_em asc` (`buscarSessoesElegiveis`) dá a
 * ela assento VITALÍCIO na janela de 50 (`LOTE_SESSOES_ELEGIVEIS`). O
 * "limite conhecido" documentado antes ("reavaliada com query vazia, sem
 * custo") não sobrevive ao achado (ii): elegibilidade eterna = vaga eterna
 * ocupada, não "sem custo".
 *
 * Detecta, com UMA query agregada sobre os ids do LOTE elegível (nunca 50
 * idas ao banco): quais sessões elegíveis não têm NENHUMA linha restante
 * em `sessoes_copiloto_segmentos` — contagem TOTAL, não só vencida, porque
 * a pergunta aqui é "esvaziou", não "venceu de novo".
 */
async function buscarSessoesEsvaziadas(admin: SupabaseClient, sessaoIds: string[]): Promise<Set<string>> {
  if (sessaoIds.length === 0) return new Set();

  const { data, error } = await admin
    .from("sessoes_copiloto_segmentos")
    .select("sessao_id")
    .in("sessao_id", sessaoIds)
    .returns<{ sessao_id: string }[]>();
  if (error) throw error;

  const comSegmento = new Set((data ?? []).map((l) => l.sessao_id));
  return new Set(sessaoIds.filter((id) => !comSegmento.has(id)));
}

/** `UPDATE` idempotente do carimbo — devolve `true` se a linha foi carimbada
 * AGORA (nunca sobrescreve uma sessão que outra passagem já carimbou). */
async function carimbar(admin: SupabaseClient, sessaoId: string, motivo: string): Promise<boolean> {
  const { error, count } = await admin
    .from("sessoes_copiloto")
    .update({ expurgo_segmentos_em: new Date().toISOString(), expurgo_segmentos_motivo: motivo }, { count: "exact" })
    .eq("sessao_id", sessaoId)
    .is("expurgo_segmentos_em", null); // idempotente: corrida com outra passagem não sobrescreve
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * 🔴 REDAÇÃO DE EVIDÊNCIA em `copiloto_sugestoes.conteudo` — achado do
 * `security-pentester` na Fase 12, Fatia 1 (`bloco_inferido.evidencia`
 * gravando citação literal da fala do cliente sem retenção). Confirmado ao
 * investigar: a classe do problema é ANTERIOR a esta fatia —
 * `proxima_pergunta.evidencia`, `falta_no_bloco[].evidencia` e
 * `observacao.evidencia` já gravam citação literal desde a Fase 10, Fatia 2
 * (`validar.ts`), e nenhuma delas expirava. Esta correção cobre os QUATRO
 * campos, não só o novo — redigir só `bloco_inferido` teria corrigido a
 * ocorrência relatada sem corrigir a classe (lição do vault, CNHF).
 *
 * MESMO PADRÃO de `ligacao-ia/expurgo.ts` (zera o conteúdo sensível, mantém
 * o resto do registro auditável — nunca DELETE da linha inteira):
 * `bloco_id`/`confianca`/`motivo`/`item`/`texto`/`tipo`/`campos_evidencia_
 * nao_conferida` sobrevivem intactos, só a CITAÇÃO LITERAL (`evidencia`) é
 * removida. É o que dá para a Ficha continuar mostrando "a IA sugeriu
 * perguntar sobre X, com confiança 0,8" depois do expurgo — só sem a frase
 * textual do cliente, que é o dado que teria que ter expirado junto com
 * `sessoes_copiloto_segmentos`.
 *
 * `bloco_inferido.evidencia` vira `""` (string vazia), não `null` — o
 * contrato (`SugestaoCopiloto.bloco_inferido`, `types/copiloto.ts:233`)
 * declara `evidencia: string` OBRIGATÓRIA quando o objeto existe (só o
 * objeto INTEIRO é nulável, o campo dentro dele não). Ampliar o contrato
 * para `string | null` está fora do escopo desta correção (tocaria
 * `validar.ts` e possivelmente telas); `""` é o valor honesto dentro do tipo
 * atual — a tela já tem que tratar `bloco_inferido` ausente/nulo como "sem
 * inferência", e uma evidência vazia não é uma citação, então nunca deveria
 * renderizar como blockquote (mesmo raciocínio de string vazia em
 * `PISO_COMPRIMENTO_EVIDENCIA`, que já rejeitaria isso na validação).
 *
 * Pura — nenhum I/O aqui, só o mapeamento do jsonb.
 */
export function redigirEvidenciasConteudo(conteudo: SugestaoCopiloto): SugestaoCopiloto {
  return {
    ...conteudo,
    proxima_pergunta: conteudo.proxima_pergunta ? { ...conteudo.proxima_pergunta, evidencia: null } : null,
    falta_no_bloco: conteudo.falta_no_bloco.map((item) => ({ ...item, evidencia: null })),
    observacao: conteudo.observacao ? { ...conteudo.observacao, evidencia: null } : null,
    bloco_inferido: conteudo.bloco_inferido ? { ...conteudo.bloco_inferido, evidencia: "" } : conteudo.bloco_inferido,
  };
}

/** `true` quando `conteudo` tem PELO MENOS uma evidência não redigida ainda
 * — usado para pular, sem escrever, sugestão já redigida numa passagem
 * anterior (idempotência, mesmo raciocínio de `carimbar`). `bloco_inferido`
 * é `string` obrigatória no contrato (nunca `null`), por isso o marcador de
 * "já redigido" ali é string vazia, não `null` (ver `redigirEvidenciasConteudo`). */
function temEvidenciaNaoRedigida(conteudo: SugestaoCopiloto): boolean {
  if (conteudo.proxima_pergunta?.evidencia) return true;
  if (conteudo.falta_no_bloco.some((item) => item.evidencia)) return true;
  if (conteudo.observacao?.evidencia) return true;
  if (conteudo.bloco_inferido?.evidencia) return true;
  return false;
}

// 🔴 CORRIGIDO (achado do Fable, otimização — "N+1 e teto sem repaginação").
// `teto_ia_sessao` (orcamento.ts/0102) é 90 hoje — uma sessão nunca gera mais
// de 90 sugestões, então 200 é folga real (~2,2×), não um teto que já bate
// no limite. Ainda assim é uma garantia FRÁGIL (o teto do PRODUTO pode subir
// sem ninguém lembrar de olhar este número): `loteCheio` devolvido por
// `redigirSugestoesDaSessao` SINALIZA quando o teto encher de verdade — o
// chamador (`carimbarSessoesSemPendencia`) propaga isso para
// `sessoesComRedacaoParcial` no resultado do cron, para o operador enxergar
// sub-processamento em vez de a sessão ficar carimbada com sugestões desta
// faixa nunca redigidas (o carimbo de `sessoes_copiloto` não espera a
// redação terminar — é ato SEPARADO, ver `carimbarSessoesSemPendencia`).
const LOTE_SUGESTOES_REDACAO = 200;

/**
 * Redige `copiloto_sugestoes.conteudo` de UMA sessão cujo expurgo de
 * segmentos ACABOU DE SER CONCLUÍDO nesta passagem (chamada só a partir de
 * `carimbar`, nunca solta) — nunca lança: erro aqui é registrado, devolvido
 * ao chamador (achado do Fable: "sessão que falha fica carimbada, sai do
 * pool, e ninguém descobre" — ver `sessoesComFalhaDeRedacao` em
 * `ResultadoExpurgoCopiloto`) e a sessão segue carimbada normalmente (o
 * carimbo de `sessoes_copiloto` já commitou; uma falha na redação NÃO deve
 * reverter isso nem travar o laço — mesmo isolamento por sessão que
 * `carimbarSessoesSemPendencia` já aplica). A PRÓXIMA passagem do cron não
 * tenta de novo por conta própria (a sessão já está carimbada, fora do pool
 * de `buscarSessoesElegiveis`) — por isso o resultado TEM de ser visível no
 * resultado do cron, não só em log.
 *
 * ⚠️ FILTRO NO BANCO por `conteudo` jsonb (pedido do Fable) FICOU DE FORA
 * desta correção: os 4 campos de evidência têm formatos diferentes dentro
 * do jsonb (3 escalares aninhados sob chaves distintas + 1 array de até 4
 * itens, `falta_no_bloco[].evidencia`) e nenhum operador simples do
 * PostgREST expressa "algum item do array tem esta chave truthy" sem uma
 * função SQL nova — e este agente não tem acesso ao banco de produção para
 * provar a sintaxe de um filtro `.or()` em jsonb aninhado antes de aplicar
 * (regra da casa: sem `explain (analyze)` medido, não sobe). Arriscar um
 * filtro não testado teria trocado "traz 90 linhas à toa" por "quebra em
 * produção com erro de sintaxe do PostgREST, capturado no catch como falha
 * de redação". Seleciona ANTES de escrever, com TETO
 * (`LOTE_SUGESTOES_REDACAO`, sem filtro de conteúdo) — decide em JS com
 * `temEvidenciaNaoRedigida`, mesmo padrão de antes desta correção.
 *
 * 🔴 CORRIGIDO — DUAS voltas (achado do Fable):
 *   1ª volta (N+1): o `UPDATE` por linha dentro de um `for` (até
 *      `LOTE_SUGESTOES_REDACAO` idas ao banco por sessão) virou um `upsert`
 *      só, `{ id, conteudo }` por linha com `onConflict: "id"` — inspirado em
 *      `radar/pedir.ts::upsert(linhas, { onConflict: ... })`.
 *   2ª volta (o `upsert` da 1ª volta falhava em TODA execução): `upsert` é
 *      `INSERT ... ON CONFLICT DO UPDATE` — o Postgres valida NOT NULL da
 *      linha PROPOSTA antes de resolver o conflito, mesmo quando a linha
 *      já existe. `copiloto_sugestoes` (0091) tem `sessao_id`/`gatilho`/
 *      `conteudo`/`criado_em` NOT NULL sem default (exceto `criado_em`); um
 *      payload `{ id, conteudo }` sempre disparava `23502` em `sessao_id`
 *      (medido no schema real). Pior: o caminho de INSERT do upsert também
 *      passa pelo `before insert` `trg_copiloto_exige_decisao_sugestoes`
 *      (0093) — sessão elegível para expurgo (consentimento revogado ou
 *      janela vencida) faria o trigger levantar em vez de gravar. Diferente
 *      de `radar/pedir.ts`, que envia a linha COMPLETA (todas as colunas
 *      obrigatórias) — não é o mesmo caso, upsert parcial nunca é seguro
 *      aqui. Voltou a ser `UPDATE` por linha (`.update({conteudo}).eq("id",
 *      ...)`): o N+1 é real, mas fica atrás de `expurgo_ativo=false` (cron,
 *      não caminho quente) e sob o MESMO teto de sempre
 *      (`LOTE_SUGESTOES_REDACAO`, ~90/sessão) — grave, porém correto, é
 *      preferível a rápido e quebrado em 100% das chamadas.
 */
async function redigirSugestoesDaSessao(
  admin: SupabaseClient,
  sessaoId: string,
): Promise<{ ok: boolean; loteCheio: boolean }> {
  try {
    const { data, error } = await admin
      .from("copiloto_sugestoes")
      .select("id, conteudo")
      .eq("sessao_id", sessaoId)
      .limit(LOTE_SUGESTOES_REDACAO)
      .returns<{ id: string; conteudo: SugestaoCopiloto }[]>();
    if (error) throw error;

    const linhas = data ?? [];
    const loteCheio = linhas.length === LOTE_SUGESTOES_REDACAO;
    const paraRedigir = linhas
      .filter((linha) => temEvidenciaNaoRedigida(linha.conteudo))
      .map((linha) => ({ id: linha.id, conteudo: redigirEvidenciasConteudo(linha.conteudo) }));

    if (paraRedigir.length === 0) return { ok: true, loteCheio }; // idempotente: nada a fazer, não escreve à toa

    // UPDATE por linha (não upsert — ver comentário acima): só a coluna
    // `conteudo`, `.eq("id", ...)` mira SEMPRE uma linha já existente, nunca
    // passa pelo caminho de INSERT do trigger.
    for (const linha of paraRedigir) {
      const { error: erroUpdate } = await admin
        .from("copiloto_sugestoes")
        .update({ conteudo: linha.conteudo })
        .eq("id", linha.id);
      if (erroUpdate) throw erroUpdate;
    }
    return { ok: true, loteCheio };
  } catch (erro) {
    // Isolamento: falha na redação de UMA sessão nunca aborta o carimbo (já
    // commitado) nem a redação das OUTRAS sessões da mesma passagem — mesmo
    // raciocínio de `carimbarSessoesSemPendencia`. `ok:false` propagado ao
    // chamador para virar `sessoesComFalhaDeRedacao` no resultado do cron.
    registrarErro("copiloto/expurgo.redigirSugestoesDaSessao", erro, { sessao_id: sessaoId });
    return { ok: false, loteCheio: false };
  }
}

/**
 * 🔴 REDAÇÃO DE EVIDÊNCIA em `sessoes_copiloto.inventario_acumulado` —
 * achado do `security-pentester` (17/09/2026), MESMA CLASSE do defeito
 * corrigido um dia antes em `copiloto_sugestoes.conteudo` (ver
 * `redigirSugestoesDaSessao` acima, achado da Fase 12 Fatia 1): sem isto, a
 * citação literal em `inventario_acumulado[].evidencia` sobreviveria
 * INDEFINIDAMENTE ao expurgo de `sessoes_copiloto_segmentos` (a fala bruta
 * que a originou) — a coluna nasceu HOJE, na 0111, já com o mesmo buraco.
 *
 * Chamada só a partir de `carimbar` (nunca solta), no MESMO instante em que
 * o expurgo de segmentos da sessão é confirmado — nunca lança: erro aqui é
 * registrado e devolvido ao chamador (`sessoesComFalhaDeRedacaoInventario`
 * em `ResultadoExpurgoCopiloto`), o carimbo de `sessoes_copiloto` já
 * commitou e não é revertido. A PRÓXIMA passagem do cron não tenta de novo
 * por conta própria (a sessão já está carimbada, fora do pool de
 * `buscarSessoesElegiveis`) — por isso o resultado TEM de ser visível no
 * resultado do cron, não só em log (mesma exigência do achado de ontem).
 *
 * Leitura por PK (`sessoes_copiloto_pkey`, 0091) — 1 linha, sem lote/teto: a
 * ÚNICA linha possível por sessão é a própria `sessoes_copiloto`
 * (`inventario_acumulado` não é uma tabela auxiliar como
 * `copiloto_sugestoes`, é UMA coluna jsonb de UMA linha já identificada por
 * `sessaoId`). `UPDATE` por linha (não upsert), mesmo motivo do vizinho: a
 * linha SEMPRE já existe (é a própria sessão sendo carimbada), `.eq
 * ("sessao_id", ...)` nunca passa por caminho de INSERT.
 */
async function redigirInventarioDaSessao(admin: SupabaseClient, sessaoId: string): Promise<boolean> {
  try {
    const { data, error: erroLeitura } = await admin
      .from("sessoes_copiloto")
      .select("inventario_acumulado")
      .eq("sessao_id", sessaoId)
      .maybeSingle<{ inventario_acumulado: InventarioAcumulado | null }>();
    if (erroLeitura) throw erroLeitura;

    const acumulado = data?.inventario_acumulado ?? [];
    if (acumulado.length === 0) return true; // sem inventário nesta sessão — nada a redigir
    if (!temEvidenciaNaoRedigidaNoInventario(acumulado)) return true; // idempotente: já redigido, não escreve à toa

    const redigido = redigirEvidenciasInventario(acumulado);
    const { error: erroUpdate } = await admin
      .from("sessoes_copiloto")
      .update({ inventario_acumulado: redigido })
      .eq("sessao_id", sessaoId);
    if (erroUpdate) throw erroUpdate;
    return true;
  } catch (erro) {
    // Isolamento: falha na redação do inventário desta sessão nunca aborta o
    // carimbo (já commitado) nem a redação das OUTRAS sessões da mesma
    // passagem — mesmo raciocínio de `redigirSugestoesDaSessao`. `false`
    // propagado ao chamador para virar `sessoesComFalhaDeRedacaoInventario`
    // no resultado do cron.
    registrarErro("copiloto/expurgo.redigirInventarioDaSessao", erro, { sessao_id: sessaoId });
    return false;
  }
}

/**
 * `sessoes_copiloto.resumo_acumulado` (0091/0120, Fatia A da MEMÓRIA DO
 * COPILOTO, 18/09/2026) — achado do arquiteto na revisão desta entrega,
 * MESMA CLASSE de `redigirInventarioDaSessao`/`redigirEvidenciasConteudo`:
 * todo campo novo que guarda algo derivado da fala precisa de um ponto de
 * redação no expurgo, mesmo quando NADA precisa ser redigido AGORA.
 *
 * 🔴 NA FATIA A, `resumo_acumulado.perguntado[]` NÃO GUARDA CITAÇÃO LITERAL —
 * só `t` (`RoteiroCampo.id`, um identificador de campo do roteiro, não fala
 * do cliente), `em` (timestamp) e `n` (contagem). Não há `evidencia` aqui: a
 * decisão do dono (B72) foi explícita em manter a Fatia A sem
 * `fato_estabelecido`/`fatos[]` — é exatamente esses campos, ainda
 * inexistentes, que carregariam citação literal na Fatia B. Esta função hoje
 * é um NO-OP DELIBERADO (sempre `true`, nunca lê nem escreve) — existe para
 * que o expurgo CONHEÇA o campo desde já e não vire um buraco silencioso no
 * dia em que a Fatia B acrescentar `fatos[]` com evidência: quem implementar
 * aquela fatia edita ESTA função (já cabeada em `carimbarSessoesSemPendencia`,
 * nos dois pontos que chamam `redigirInventarioDaSessao`), em vez de precisar
 * descobrir que falta um caminho de redação para um campo que já existe em
 * produção há dias.
 */
async function redigirResumoDaSessao(admin: SupabaseClient, sessaoId: string): Promise<boolean> {
  // NO-OP deliberado — ver comentário de topo. Assinatura já IGUAL à de
  // `redigirInventarioDaSessao` para a Fatia B só trocar o corpo, sem tocar
  // nos dois pontos de chamada em `carimbarSessoesSemPendencia`. `void` nos
  // dois parâmetros deixa explícito que ainda não são lidos (nunca `_prefix`
  // solto: evita o linter apontar código morto de verdade no dia em que
  // alguém esquecer de implementar o corpo).
  void admin;
  void sessaoId;
  return true;
}

/**
 * Etapa chamada pelo cron (`POST /api/cron/regua`, via `server/regua/
 * externas.ts::etapaExpurgoCopiloto`) — MESMO padrão de isolamento de
 * `etapaExpurgoLigacoesIa`: nunca lança, sempre devolve um resultado, uma
 * falha aqui não derruba as outras etapas da mesma passagem.
 */
export async function etapaExpurgoSegmentosCopiloto(admin: SupabaseClient): Promise<ResultadoExpurgoCopiloto> {
  const expurgoAtivo = await lerConfiguracaoBool(admin, CHAVE_EXPURGO_ATIVO, false);
  if (!expurgoAtivo) {
    return {
      segmentosRemovidos: 0,
      sessoesConcluidas: 0,
      sessoesComSegmentosRetidos: 0,
      sessoesComFalhaDeRedacao: 0,
      sessoesComRedacaoParcial: 0,
      sessoesComFalhaDeRedacaoInventario: 0,
      pulada: "expurgo_desligado",
    };
  }

  const retencaoDias = await lerConfiguracaoInt(admin, CHAVE_RETENCAO_DIAS_SEGMENTOS, PADRAO_RETENCAO_DIAS);
  if (!Number.isFinite(retencaoDias) || retencaoDias <= 0) {
    return {
      segmentosRemovidos: 0,
      sessoesConcluidas: 0,
      sessoesComSegmentosRetidos: 0,
      sessoesComFalhaDeRedacao: 0,
      sessoesComRedacaoParcial: 0,
      sessoesComFalhaDeRedacaoInventario: 0,
      pulada: "sem_retencao_configurada",
    };
  }

  const limiteIso = new Date(Date.now() - retencaoDias * 86_400_000).toISOString();

  try {
    const sessoesElegiveis = await buscarSessoesElegiveis(admin);
    if (sessoesElegiveis.size === 0) {
      return {
        segmentosRemovidos: 0,
        sessoesConcluidas: 0,
        sessoesComSegmentosRetidos: 0,
        sessoesComFalhaDeRedacao: 0,
        sessoesComRedacaoParcial: 0,
        sessoesComFalhaDeRedacaoInventario: 0,
        retencaoDias,
      };
    }

    const { removidos, encheuLote, sessoesAfetadas, sessoesComVencidoNaoApagavel } = await removerSegmentosVencidos(
      admin,
      sessoesElegiveis,
      limiteIso,
    );

    // CORRECAO (5o caminho do Fable via coordenador - "squatter eterno por
    // soluco de banco"). Sessao elegivel com ZERO segmentos restantes
    // (esvaziada numa passagem ANTERIOR cujo carimbo abortou por erro
    // transiente, ou cujo processo morreu entre o DELETE e o carimbo)
    // nunca aparece em `sessoesAfetadas` nem em `sessoesComVencidoNaoApagavel`
    // - os dois so existem quando ha segmento VENCIDO. Detectada com UMA
    // query agregada sobre TODOS os ids elegiveis desta passagem (nunca
    // 50 idas ao banco).
    //
    // IMPORTANTE: roda DEPOIS do DELETE de `removerSegmentosVencidos` - uma
    // sessao que acabou de ser esvaziada NESTA MESMA passagem (estava em
    // `sessoesAfetadas`, teve todo o vencido removido agora) TAMBEM aparece
    // aqui, porque no banco ela ja esta com zero segmentos. Isso e
    // ESPERADO e nao e um erro: mas o MOTIVO tem de distinguir "esvaziei
    // agora" (motivo padrao, tratado normalmente por `sessoesAfetadas`) de
    // "ja estava vazia de uma passagem anterior" (motivo distinto) - por
    // isso `sessoesEsvaziadas` passada a `carimbarSessoesSemPendencia`
    // EXCLUI quem ja esta em `sessoesAfetadas`: so sobra quem estava
    // esvaziada e SEM CARIMBO antes desta passagem sequer tocar nela.
    const todasEsvaziadasAgora = await buscarSessoesEsvaziadas(admin, [...sessoesElegiveis.keys()]);
    const sessoesEsvaziadas = new Set([...todasEsvaziadasAgora].filter((id) => !sessoesAfetadas.has(id)));

    // Candidatas ao carimbo: quem perdeu segmento NESTA passagem
    // (`sessoesAfetadas`) UNIDO com quem tinha vencido mas NADA saiu
    // (`sessoesComVencidoNaoApagavel`, achado (ii) do Fable) UNIDO com quem
    // esta com ZERO segmentos restantes (`sessoesEsvaziadas`, achado do 5o
    // caminho) - sem esta uniao tripla, qualquer um dos tres grupos fica
    // eternamente na frente do FIFO, o mesmo starvation por caminhos
    // diferentes. `sessoesElegiveis` (o Map com `encerrado_em`) e reusado
    // aqui - mesma fonte de dado que o backstop do DELETE, sem ida extra
    // ao banco.
    const candidatasAoCarimbo = new Set([...sessoesAfetadas, ...sessoesComVencidoNaoApagavel, ...sessoesEsvaziadas]);
    const motivo = `retencao_dias_segmentos vencida (${retencaoDias} dias)`;
    const {
      concluidas: sessoesConcluidas,
      concluidasComRetidos: sessoesComSegmentosRetidos,
      concluidasComFalhaDeRedacao: sessoesComFalhaDeRedacao,
      concluidasComLoteCheio: sessoesComRedacaoParcial,
      concluidasComFalhaDeRedacaoInventario: sessoesComFalhaDeRedacaoInventario,
    } = await carimbarSessoesSemPendencia(admin, candidatasAoCarimbo, sessoesEsvaziadas, sessoesElegiveis, limiteIso, motivo);

    return {
      segmentosRemovidos: removidos,
      sessoesConcluidas,
      sessoesComSegmentosRetidos,
      sessoesComFalhaDeRedacao,
      sessoesComRedacaoParcial,
      sessoesComFalhaDeRedacaoInventario,
      retencaoDias,
      restaLote: encheuLote,
    };
  } catch (erro) {
    const pg = erro as ErroPostgrest;
    if (pg.code === "42703") {
      // Migration 0098 não aplicada ainda (coluna ausente) — nunca apaga às
      // cegas, mesmo padrão de `coluna_ausente` em `ligacao-ia/expurgo.ts`.
      return {
        segmentosRemovidos: 0,
        sessoesConcluidas: 0,
        sessoesComSegmentosRetidos: 0,
        sessoesComFalhaDeRedacao: 0,
        sessoesComRedacaoParcial: 0,
        sessoesComFalhaDeRedacaoInventario: 0,
        erro: "coluna_ausente",
      };
    }
    registrarErro("copiloto/expurgo.etapaExpurgoSegmentosCopiloto", erro, { retencao_dias: retencaoDias });
    return {
      segmentosRemovidos: 0,
      sessoesConcluidas: 0,
      sessoesComSegmentosRetidos: 0,
      sessoesComFalhaDeRedacao: 0,
      sessoesComRedacaoParcial: 0,
      sessoesComFalhaDeRedacaoInventario: 0,
      erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro).slice(0, 300),
    };
  }
}
