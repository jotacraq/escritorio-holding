import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroDefinicao } from "@/types/roteiro";
import type {
  BlocoAtualResolvido,
  BlocoPendente,
  CampoPendente,
  ComparacaoDecisoresPresentes,
  EstadoBotCopiloto,
  EstadoCopiloto,
  InventarioAcumulado,
  InventarioParaPainel,
  ItemInventarioRecentePainel,
  SimPendente,
} from "@/types/copiloto";
import { erroNaoEncontrado } from "@/server/erros";
import { lerConfiguracaoBool, lerConfiguracaoInt, lerConfiguracaoJson } from "@/server/ia/configuracao";
import { resumirInventario } from "./inventario";
import { compararComDecisores } from "./participantes";

/**
 * Montagem do estado determinístico do copiloto — Fase 10, Fatias 1 e 4
 * (docs/ARQUITETURA-FASE-10.md §5, §8, §12). ZERO IA: tudo aqui é derivado de
 * dado que já existe (roteiro ativo, `sessoes_viabilidade.sims`,
 * `consentimentos`, `sessoes_copiloto.participantes`, briefing atual). Fica
 * em `server/copiloto/` (não direto na rota) porque a Fatia 3 (polling
 * automático) reusa exatamente esta função no polling de 3 s — ~1.800
 * chamadas por sessão de 90 min (§4.1 do plano). É por isso que o número de
 * idas ao banco por chamada importa aqui mais do que numa rota comum, e por
 * que as duas seções abaixo foram corrigidas (achado do Fable): a query
 * principal agora embute `jornadas(pessoa_id)` — 2 idas ao banco no total,
 * não 3 — e o comentário da 2ª ida passou a descrever o que o código
 * realmente faz (ela roda SEMPRE, não só "quando o bloco é o 1º").
 *
 * UMA QUERY COALESCIDA para sessão + jornada + roteiro + estado do copiloto
 * + participantes + briefing atual (§2.4, e achado do coordenador na
 * revisão da Fatia 4: "não faça leitura nova do briefing a cada polling"):
 * `sessoes_viabilidade` embute `jornadas(pessoa_id, briefings(conteudo,
 * atual))` pela FK `jornada_id` — mesmo padrão de embed de 3 níveis que
 * `src/app/api/agendamentos/route.ts` já usa
 * (`sessoes_viabilidade(jornada_id, jornadas(pessoa_id, pessoas(nome)))`) —
 * e `roteiros_versoes(definicao)` pela FK `roteiro_versao_id`.
 * `sessoes_copiloto(estado, gravacao_externa_id, participantes)` embute
 * junto pela FK `sessao_id`. Consentimento (1º SIM) fica de FORA do embed
 * porque `consentimentos` não tem FK para `sessao_id` (é por PESSOA, 0005)
 * — mesma limitação que já existe em `GET /api/sessoes/[id]/sims`; é a 2ª
 * (e última) ida ao banco desta função.
 *
 * `briefings` SEM filtro `atual=true` no embed — o PostgREST não tem sintaxe
 * confirmada nesta base para filtrar um embed de 2º nível de profundidade
 * (`sessoes_viabilidade → jornadas → briefings`; o único precedente de
 * filtro em embed do repo, `agente-whatsapp/links.ts:117`, filtra 1 nível).
 * Em vez de arriscar sintaxe não testada contra produção, o código escolhe o
 * item com `atual===true` DEPOIS da resposta (`escolherBriefingAtual`
 * abaixo) — mesma ida ao banco, filtro em memória. Aceitável porque
 * `uniq_briefing_atual` (0009) garante NO MÁXIMO 1 linha `atual=true` por
 * jornada, e o volume de briefings por jornada é pequeno (regeneração é ação
 * manual e rara, não um contador que cresce por ciclo de polling) — não um
 * `select *` sem teto crescendo com o tempo.
 */

interface BriefingParaDecisores {
  conteudo: { processo_decisorio?: { decisores?: string[] } };
  atual: boolean;
}

interface SessaoComRoteiroEBloco {
  id: string;
  roteiro_versao_id: string | null;
  sims: Record<string, { ok: boolean; em: string; registrado_por: string | null }>;
  jornadas: { pessoa_id: string; briefings: BriefingParaDecisores[] } | null;
  roteiros_versoes: { definicao: RoteiroDefinicao } | null;
  sessoes_copiloto: {
    estado: "aguardando" | "ativo" | "encerrado" | "erro";
    gravacao_externa_id: string | null;
    participantes: unknown;
    expurgo_segmentos_em: string | null;
    /** Fase 12, Fatia 5a (0117) — mesmo embed, ZERO query nova (achado do
     * arquiteto). `InventarioAcumulado` é importado só como `unknown[]`
     * aqui para não acoplar este módulo ao tipo de `types/copiloto.ts` além
     * do necessário; `montarInventarioParaPainel` faz o cast estrutural. */
    inventario_acumulado: InventarioAcumulado | null;
  } | null;
}

/** `uniq_briefing_atual` garante no máximo 1 — mas o embed sem filtro pode
 * trazer histórico; escolhe o `atual===true`, `null` se não houver nenhum
 * (jornada sem briefing gerado ainda). */
function escolherBriefingAtual(briefings: BriefingParaDecisores[] | undefined): BriefingParaDecisores | null {
  if (!Array.isArray(briefings)) return null;
  return briefings.find((b) => b.atual === true) ?? null;
}

/** Nomes de `processo_decisorio.decisores` do briefing atual — `[]` quando
 * não há briefing ou o campo está ausente (nunca lança).
 *
 * EXPORTADA (15/09/2026, papéis de fala): `entrada-bot.ts::registrarEventoParticipante`
 * reusa esta função (com `escolherBriefingAtual`) para resolver `decisor_N`
 * no momento do join — mesma leitura de briefing, nenhuma duplicação. Ver o
 * comentário `🔴 REMOVIDO` em `participantes.ts` (fim do arquivo): a versão
 * duplicada que existia ali foi removida de propósito; esta é a ÚNICA. */
export function extrairDecisoresEsperados(briefingAtual: BriefingParaDecisores | null): string[] {
  const decisores = briefingAtual?.conteudo?.processo_decisorio?.decisores;
  return Array.isArray(decisores) ? decisores.filter((d): d is string => typeof d === "string" && d.trim().length > 0) : [];
}

/**
 * Fatia 4, §5 — monta `bot`/`comparacao_decisores` a partir dos MESMOS dados
 * que `montarEstadoCopiloto` já leu nesta chamada (zero leitura extra).
 *
 * `bot`: `null` quando a sessão nunca teve `sessoes_copiloto` criada
 * (ninguém digitou nada nem pediu bot ainda) — o `estado_copiloto` de
 * `EstadoCopiloto` já cobre esse caso com `'aguardando'`; aqui o valor é
 * literalmente ausente, não um objeto com campos vazios. `erro_provedor` e
 * `retencao_infinita_detectada` vêm SEMPRE vazios nesta entrega — ver nota
 * em `types/copiloto.ts::EstadoCopilotoComPolling.bot` (não há coluna em
 * `sessoes_copiloto` para persistir o motivo do erro do provedor ainda).
 *
 * `comparacao_decisores`: `null` (não um objeto com arrays vazios) quando
 * NÃO HÁ DADO SUFICIENTE para comparar — sem participantes presentes na
 * sala, OU sem `processo_decisorio.decisores` no briefing (achado do
 * coordenador: "vazio é vazio, nunca zero" — uma comparação com
 * `decisores_esperados: []` pareceria "0 decisores esperados", uma afirmação
 * falsa sobre o briefing, não ausência de dado).
 */
function montarBotEComparacaoDecisores(dados: SessaoComRoteiroEBloco): {
  bot: EstadoBotCopiloto | null;
  comparacaoDecisores: ComparacaoDecisoresPresentes | null;
} {
  const sc = dados.sessoes_copiloto;
  const bot: EstadoBotCopiloto | null = sc ? { estado: sc.estado, erro_provedor: null, retencao_infinita_detectada: false } : null;

  const decisoresEsperados = extrairDecisoresEsperados(escolherBriefingAtual(dados.jornadas?.briefings));
  const participantesAtuais = sc?.participantes ?? [];

  if (decisoresEsperados.length === 0) {
    return { bot, comparacaoDecisores: null };
  }

  const comparacao = compararComDecisores(decisoresEsperados, participantesAtuais);
  if (comparacao.participantesPresentes.length === 0) {
    // Sem NENHUM participante presente na sala: não é "todos ausentes" com
    // confiança — pode ser que o bot nunca entrou, ou é o modo digitado
    // (Fatia 1, sem lista de participantes nenhuma). A tela não deve
    // renderizar "0 na sala" como se fosse um fato observado.
    return { bot, comparacaoDecisores: null };
  }

  return {
    bot,
    comparacaoDecisores: {
      decisores_esperados: comparacao.decisoresEsperados,
      participantes_presentes: comparacao.participantesPresentes,
      presentes: comparacao.presentes.map((p) => ({ nome_briefing: p.nomeBriefing, nome_participante: p.nomeParticipante })),
      ausentes: comparacao.ausentes,
      ambiguos: comparacao.ambiguos,
    },
  };
}

const ROTULOS_SIM: Record<"sigilo_gravacao" | "licitude" | "decisores" | "proximo_passo", string> = {
  sigilo_gravacao: "Sigilo e gravação",
  licitude: "Licitude",
  decisores: "Decisores presentes",
  proximo_passo: "Próximo passo",
};

/** `EstadoCopiloto` (Fatia 1, contrato estável) + os dois campos da Fatia 4
 * + o campo da Fatia 5 — composição, nunca redefinição (mesmo padrão de
 * `RoteiroVersaoResumo` em `roteiro.ts`). A rota de polling
 * (`GET /api/sessoes/[id]/copiloto`) usa este retorno inteiro; nenhum outro
 * chamador desta função existe hoje. */
export interface EstadoCopilotoCompleto extends EstadoCopiloto {
  bot: EstadoBotCopiloto | null;
  comparacao_decisores: ComparacaoDecisoresPresentes | null;
  /** Fase 10, Fatia 5 (B69/B19). `null` = segmentos ainda não expurgados
   * (inclui: expurgo desligado — o padrão de fábrica — sessão fora do
   * prazo, ou sem transcrição consolidada ainda). Preenchido = instante em
   * que `server/copiloto/expurgo.ts` removeu a fala bruta desta sessão; a
   * transcrição CONSOLIDADA em `transcricoes` continua intacta e legível
   * (§6.1 do plano) — a tela deve dizer "transcrição bruta expurgada em …",
   * nunca esconder a sessão nem mostrar erro. */
  expurgo_segmentos_em: string | null;
  /** Fase 12, Fatia 1 — ver `resolverBlocoAtual`/comentário de
   * `montarEstadoCopiloto`. Obrigatório aqui (interno); exposto como
   * OPCIONAL em `EstadoCopilotoComPolling` (types/copiloto.ts) para não
   * quebrar literais de teste do front. */
  bloco_atual_resolvido: BlocoAtualResolvido;
  /** Fase 12, Fatia 5a — ver `montarInventarioParaPainel`. `null` = kill-switch
   * desligado ou sessão sem item acumulado ainda (nunca objeto com contagens
   * zeradas). */
  inventario: InventarioParaPainel | null;
}

/** `copiloto_sessao.inventario_mencionado` (0111) — MESMA chave que já
 * controla o bloco G do contexto de IA (`contexto.ts`); reaproveitada aqui
 * para o PAINEL (Fase 12, Fatia 5a) porque é a mesma decisão de produto
 * ("mostrar o que foi levantado" x "não mostrar nada ainda") — duas chaves
 * para a mesma pergunta duplicaria interruptor sem motivo de negócio novo
 * (regra da casa: chave nasce quando há decisão distinta por trás, não
 * antes). Desligar aqui NÃO impede o CICLO de continuar ACUMULANDO itens em
 * `sessoes_copiloto.inventario_acumulado` — é sobre o que a TELA vê, não
 * sobre o que se grava (mesmo raciocínio de `contexto.ts`). */
const CHAVE_INVENTARIO_MENCIONADO_ATIVO = "copiloto_sessao.inventario_mencionado";

/** Mesma chave de `contexto.ts` — ver `carregarBlocosComFallback`. */
const CHAVE_ROTEIRO_SESSAO_VIABILIDADE = "sessao_viabilidade";

/** Quantos itens recentes (com evidência) vão para o painel — Fase 12,
 * Fatia 5a. Fixo, não é chave de `configuracoes`: é um teto de PAYLOAD, não
 * um parâmetro de negócio (mesmo raciocínio de `LIMITE_SEGMENTOS_NOVOS` na
 * rota) — mandar mais que isso a cada 3s de polling é banda paga para
 * redesenhar a mesma lista repetidamente sem ganho para a advogada, que já
 * vê o resumo por categoria acima destes itens. */
const LIMITE_ITENS_RECENTES_INVENTARIO_PAINEL = 5;

/**
 * Fase 12, Fatia 5a (0117) — achado: `sessoes_copiloto.inventario_acumulado`
 * tem itens com evidência literal (18 na sessão real que motivou esta
 * fatia) e nunca chegava ao PAINEL (só ao contexto de IA, `contexto.ts`).
 * ZERO query nova: `inventario_acumulado` já vem no MESMO embed de
 * `sessoes_copiloto` que `montarEstadoCopiloto` já lê (achado do arquiteto,
 * F5a) — esta função só RESUME o que já chegou.
 *
 * `resumo` reusa `resumirInventario()` (já existe, `inventario.ts::
 * resumirInventario`, mesma função que alimenta o bloco G do contexto de
 * IA) — nenhuma lógica de contagem duplicada.
 *
 * `recentes` corta os `LIMITE_ITENS_RECENTES_INVENTARIO_PAINEL` itens de
 * `ultima_mencao_em` mais recente — NUNCA o array inteiro (regra explícita
 * do arquiteto: mandar 18 itens com citação a cada 3s é banda paga para
 * redesenhar a mesma lista ~1.800× por sessão). `chave` (dedupe interno) é
 * removida do formato exposto — detalhe de `inventario.ts`, nunca da tela.
 *
 * Pura (zero I/O) — a leitura de `inventario_acumulado` já aconteceu no
 * SELECT principal; o kill-switch é lido pelo CHAMADOR (mesmo padrão de
 * `resolverBlocoAtual`, que também recebe config já resolvida quando possível
 * — aqui não dá porque a leitura da chave é 1 select isolado, feito no
 * chamador para poder rodar em paralelo com as outras leituras de config
 * desta função, via `Promise.all`).
 */
function montarInventarioParaPainel(
  acumulado: InventarioAcumulado | null,
  inventarioMencionadoAtivo: boolean,
): InventarioParaPainel | null {
  if (!inventarioMencionadoAtivo) return null;
  if (!acumulado || acumulado.length === 0) return null;

  const recentes: ItemInventarioRecentePainel[] = [...acumulado]
    .sort((a, b) => Date.parse(b.ultima_mencao_em) - Date.parse(a.ultima_mencao_em))
    .slice(0, LIMITE_ITENS_RECENTES_INVENTARIO_PAINEL)
    .map(({ chave: _chave, ...item }) => item);

  return {
    resumo: resumirInventario(acumulado),
    recentes,
  };
}

/** Chave de configuração da fixação manual por tempo (mesma que a rota usa
 * para decidir por quanto tempo `?bloco=`/`fixado_em=` vence a inferência). */
export const CHAVE_JANELA_FIXACAO_MANUAL_SEGUNDOS = "copiloto_sessao.janela_fixacao_manual_segundos";
const PADRAO_JANELA_FIXACAO_MANUAL_SEGUNDOS = 300;

/** Interruptor de reversão da inferência (0106) — `false` faz o servidor
 * voltar 100% à fixação manual (`?bloco=`, sem `fixado_em`, tratado como
 * índice puro — comportamento idêntico a antes desta fatia). Nasce `true`
 * (decisão do dono: é correção de cegueira medida, não risco novo). */
export const CHAVE_INFERENCIA_BLOCO_ATIVA = "copiloto_sessao.inferencia_bloco_ativa";

/**
 * Fase 12, Fatia 1 (0117) — HISTERESE DO BLOCO INFERIDO. As 3 chaves abaixo
 * são HIPÓTESE CONSERVADORA, não medição: só há 1 sessão real com bloco
 * inferido (~19 sugestões com `bloco_inferido` não nulo) e o eco do Zoom
 * (8% da fala, ver `docs/ARQUITETURA-FASE-10.md`) contamina essa amostra —
 * não há base para calibrar com confiança estatística ainda. Ver a
 * migration 0117 para o raciocínio completo.
 */

/** Confiança mínima para uma inferência de bloco ENTRAR na janela de
 * histerese — abaixo disto a linha é descartada como se não existisse
 * (nem soma nem quebra concordância). */
export const CHAVE_PISO_CONFIANCA_BLOCO = "copiloto_sessao.piso_confianca_bloco";
const PADRAO_PISO_CONFIANCA_BLOCO = 0.7;

/** Quantas das inferências mais recentes (já filtradas pelo piso) precisam
 * CONCORDAR no mesmo bloco para a histerese aceitar uma mudança. */
export const CHAVE_HISTERESE_N = "copiloto_sessao.histerese_n";
const PADRAO_HISTERESE_N = 2;

/** `false` (padrão): retroceder para um bloco de índice MENOR que o vigente
 * só é aceito com confiança >= 0.90 (`CONFIANCA_MINIMA_RETROCESSO_FORCADO`,
 * logo abaixo) mesmo com concordância das N mais recentes — retroceder é o
 * sintoma do bug medido (0,65 apontando o início sobrescrevendo 0,85 no
 * fim), então a barra para aceitar é mais alta que para avançar. `true`
 * remove essa barra extra (retrocesso aceito nas mesmas condições que
 * avanço) — existe como reversão SEM DEPLOY caso a barra alta se mostre
 * conservadora demais na prática. */
export const CHAVE_BLOCO_PERMITE_RETROCESSO = "copiloto_sessao.bloco_permite_retrocesso";
const PADRAO_BLOCO_PERMITE_RETROCESSO = false;

/** Confiança mínima para um RETROCESSO ser aceito mesmo com
 * `bloco_permite_retrocesso=false` — retrocesso muito confiante (ex.: a
 * advogada voltou de propósito a um bloco anterior) não deveria ficar preso
 * atrás do vigente para sempre. Não é chave de `configuracoes` (ninguém
 * pediu ajustar este número isoladamente — mesmo raciocínio de
 * `FATOR_SEM_FOCO` em `config.ts`): se um dia for preciso, a chave nasce
 * então, não antes. */
const CONFIANCA_MINIMA_RETROCESSO_FORCADO = 0.9;

/** Teto de linhas lidas do banco para alimentar `aplicarHisterese` —
 * DIFERENTE de `histerese_n` (o tamanho da JANELA de concordância): o piso de
 * confiança é aplicado DEPOIS da leitura (em memória, `aplicarHisterese`),
 * então leituras fracas intercaladas (ex.: o eco do Zoom gerando 2-3
 * inferências de baixa confiança seguidas) podem "engolir" a janela antes de
 * alcançar candidatas válidas suficientes — ler só `n + 1` não basta nesse
 * caso. 10 é uma margem generosa sobre `histerese_n` (padrão 2) sem custo
 * relevante: mesmo índice `(sessao_id, ordem_evento)` de sempre, e o teto é
 * FIXO (não escala com o tamanho da sessão) — a 6ª pergunta do protocolo de
 * sustentabilidade ("e com 10x mais linha?") está coberta por construção.
 * Não é chave de `configuracoes`: é um limite técnico de leitura, não um
 * parâmetro de negócio (mesmo raciocínio de `LIMITE_SEGMENTOS_NOVOS` na
 * rota). */
const LIMITE_CANDIDATAS_LIDAS_HISTERESE = 10;

/** Fixação manual recebida da rota (`?bloco=<indice>&fixado_em=<iso>`).
 * `fixadoEm` é OBRIGATÓRIO para a fixação valer — um `?bloco=` sem
 * `fixado_em` (ex.: link antigo, ou `sessionStorage` remanescente de uma
 * sessão de antes desta fatia) NUNCA ressuscita como fixação: sem carimbo de
 * tempo não há como calcular a janela, e aceitar cegamente reintroduziria o
 * próprio defeito que esta fatia corrige (índice velho da tela tratado como
 * fato). */
export interface FixacaoManualBloco {
  indice: number;
  fixadoEm: string;
}

/** Uma linha de `copiloto_sugestoes` já normalizada para a histerese — só o
 * que `aplicarHisterese` precisa, sem o jsonb bruto. Ordem: MAIS RECENTE
 * primeiro (mesma ordem que a query já traz, `ordem_evento desc`). */
interface CandidataHisterese {
  blocoId: string;
  confianca: number;
  criadoEm: string;
}

/** Config lida 1x por chamada e repassada à função pura (nunca lida dentro
 * dela — `aplicarHisterese` não faz I/O, é testável de mesa). */
interface ConfigHisterese {
  pisoConfianca: number;
  n: number;
  permiteRetrocesso: boolean;
}

/**
 * 🔴 HISTERESE DO BLOCO INFERIDO (Fase 12, Fatia 1, correção 0117) — o bug
 * medido em produção (sessão `ebbf08d4-9ed3-4d0d-a5c9-a780225726ce`): a regra
 * antiga pegava SIMPLESMENTE A ÚLTIMA inferência (`limit 1`), sem piso de
 * confiança e sem impedir retrocesso. Uma leitura fraca (0,65) apontando o
 * INÍCIO do roteiro sobrescrevia uma forte (0,85) apontando o FIM — a tela
 * "voltava" para trás no meio de uma sessão que já estava avançada.
 *
 * Pura (zero I/O, testável de mesa) — recebe as `candidatas` BRUTAS já
 * ORDENADAS mais-recente-primeiro (o CHAMADOR lê `LIMITE_CANDIDATAS_LIDAS_
 * HISTERESE` linhas do banco, uma margem generosa sobre `n` — ver comentário
 * daquela constante para o motivo: o piso de confiança só é aplicado AQUI,
 * em memória, então ler pouco deixaria leituras fracas intercaladas
 * engolirem a janela). Depois do filtro de piso, as `n` primeiras (já
 * válidas) formam a JANELA de concordância; a candidata válida seguinte
 * (índice `n` da lista já filtrada) é o "VIGENTE" — o que a regra já tinha
 * decidido ANTES desta janela mais recente. Isso substitui persistência: não
 * existe coluna de "bloco vigente" (decisão do arquiteto: zero coluna nova,
 * zero escrita — um UPDATE a mais por ciclo de polling que já faz ~12 idas
 * ao banco não se paga); a própria série de `copiloto_sugestoes` já É a
 * memória.
 *
 * Quando não há uma candidata válida além da janela (sessão ainda muito
 * nova, ou não há histórico suficiente), a mais ANTIGA da própria janela faz
 * esse papel — é o melhor "antes" disponível.
 *
 * REGRA (do plano do arquiteto):
 *   1. Descarta `confianca < piso` — leitura fraca não entra na janela nem
 *      pode ser o vigente.
 *   2. Se as `n` mais recentes válidas NÃO concordam no MESMO `blocoId` →
 *      MANTÉM o vigente (a variação nas últimas leituras não é forte o
 *      bastante para mudar nada).
 *   3. Se concordam (`candidataNova` = a mais recente da janela):
 *      - `indiceNovo > indiceVigente` → aceita (avanço).
 *      - `indiceNovo === indiceVigente` → aceita (reafirma o mesmo bloco; é
 *        o caminho comum quando a conversa não mudou de parte).
 *      - `indiceNovo < indiceVigente` → só se `permiteRetrocesso=true` OU a
 *        candidata mais recente tem confiança >=
 *        `CONFIANCA_MINIMA_RETROCESSO_FORCADO` (0,90).
 *   4. Nada resolve (piso zerou tudo, sem candidata válida nenhuma) → `null`
 *      — cabe ao CHAMADOR decidir o fallback (aqui, `indisponivel`, que só
 *      acontece quando não há NENHUM histórico de inferência válida ainda,
 *      nunca no meio de uma sessão que já tinha um bloco resolvido).
 *
 * `blocos.findIndex` resolve `blocoId → índice` para cada candidata — um
 * `blocoId` que não casa mais com o roteiro ativo é tratado como se não
 * existisse (mesmo raciocínio de antes: nunca um título inventado).
 */
function aplicarHisterese(
  candidatas: CandidataHisterese[],
  blocos: RoteiroDefinicao["blocos"],
  config: ConfigHisterese,
): { blocoId: string; indice: number; confianca: number; criadoEm: string } | null {
  const validas = candidatas
    .filter((c) => c.confianca >= config.pisoConfianca)
    .map((c) => ({ ...c, indice: blocos.findIndex((b) => b.id === c.blocoId) }))
    .filter((c) => c.indice >= 0);

  if (validas.length === 0) return null;

  // Janela = as `n` mais recentes válidas. Vigente = a linha seguinte (a
  // `(n+1)`-ésima) se existir; senão, a mais antiga da própria janela.
  const janela = validas.slice(0, config.n);
  const vigente = validas[config.n] ?? janela[janela.length - 1]!;

  if (janela.length < config.n) {
    // Não há `n` leituras válidas ainda — não há como formar concordância;
    // mantém o vigente (regra 4).
    return vigente;
  }

  const todasConcordam = janela.every((c) => c.blocoId === janela[0]!.blocoId);
  if (!todasConcordam) {
    return vigente;
  }

  const candidataNova = janela[0]!;
  if (candidataNova.indice >= vigente.indice) {
    // Avanço ou reafirmação do mesmo bloco — sempre aceito quando a janela concorda.
    return candidataNova;
  }
  // Retrocesso: só aceito com o interruptor ligado, ou confiança forte o
  // bastante para presumir correção deliberada (não ruído/eco).
  const retrocessoAceito = config.permiteRetrocesso || candidataNova.confianca >= CONFIANCA_MINIMA_RETROCESSO_FORCADO;
  return retrocessoAceito ? candidataNova : vigente;
}

/**
 * Resolve o `BlocoAtualResolvido` — a correção do defeito-raiz. Precedência:
 *   1. Fixação manual, se `fixadoEm` estiver dentro de
 *      `copiloto_sessao.janela_fixacao_manual_segundos` (300s ao nascer) a
 *      partir de AGORA — nunca calculada a partir de `criado_em` da sessão,
 *      é sempre "há quanto tempo a advogada clicou", não "há quanto tempo a
 *      sessão existe". Continua vencendo TUDO abaixo, sem alteração desta
 *      fatia (0117 não toca este bloco).
 *   2. Senão, e só se `copiloto_sessao.inferencia_bloco_ativa=true`: as
 *      últimas `copiloto_sessao.histerese_n` inferências de bloco desta
 *      sessão, mais recentes por `ordem_evento` — MESMO índice do polling
 *      (`idx_copiloto_sugestoes_polling`, 0091), nenhum índice novo — passam
 *      por `aplicarHisterese` (ver comentário da função: piso de confiança,
 *      concordância das N mais recentes, barra maior para retroceder).
 *      `limit(N)` no lugar do antigo `limit(1)` — mesmo predicado
 *      (`conteudo->bloco_inferido->>bloco_id is not null`), só o teto muda.
 *   3. Senão, `indisponivel` — NUNCA um índice 0 por default (dado
 *      inventado, CLAUDE.md).
 */
async function resolverBlocoAtual(
  supabase: SupabaseClient,
  sessaoId: string,
  blocos: RoteiroDefinicao["blocos"],
  fixacaoManual: FixacaoManualBloco | null,
): Promise<BlocoAtualResolvido> {
  if (fixacaoManual) {
    const janelaSegundos = await lerConfiguracaoInt(
      supabase,
      CHAVE_JANELA_FIXACAO_MANUAL_SEGUNDOS,
      PADRAO_JANELA_FIXACAO_MANUAL_SEGUNDOS,
    );
    const idadeSegundos = (Date.now() - Date.parse(fixacaoManual.fixadoEm)) / 1000;
    const fixacaoValida =
      Number.isInteger(fixacaoManual.indice) &&
      fixacaoManual.indice >= 0 &&
      fixacaoManual.indice < blocos.length &&
      Number.isFinite(idadeSegundos) &&
      idadeSegundos >= 0 &&
      idadeSegundos < janelaSegundos;

    if (fixacaoValida) {
      const bloco = blocos[fixacaoManual.indice]!;
      const expiraEm = new Date(Date.parse(fixacaoManual.fixadoEm) + janelaSegundos * 1000).toISOString();
      return {
        bloco_id: bloco.id,
        indice: fixacaoManual.indice,
        titulo: bloco.titulo,
        origem: "fixado_manualmente",
        confianca: null,
        decidido_em: fixacaoManual.fixadoEm,
        fixacao_expira_em: expiraEm,
      };
    }
    // Fixação expirada ou fora de intervalo: cai para a inferência abaixo,
    // exatamente como se não tivesse vindo `?bloco=` nesta chamada.
  }

  const inferenciaAtiva = await lerConfiguracaoBool(supabase, CHAVE_INFERENCIA_BLOCO_ATIVA, true);
  if (inferenciaAtiva) {
    const [pisoBruto, nBruto, permiteRetrocesso] = await Promise.all([
      lerConfiguracaoJson<number>(supabase, CHAVE_PISO_CONFIANCA_BLOCO, PADRAO_PISO_CONFIANCA_BLOCO),
      lerConfiguracaoInt(supabase, CHAVE_HISTERESE_N, PADRAO_HISTERESE_N),
      lerConfiguracaoBool(supabase, CHAVE_BLOCO_PERMITE_RETROCESSO, PADRAO_BLOCO_PERMITE_RETROCESSO),
    ]);

    // 🔴 SANEAMENTO OBRIGATÓRIO (achado do security-pentester, 17/09/2026).
    // As duas leituras acima fazem CAST, não validação: `lerConfiguracaoInt`
    // aceita `0` como inteiro legítimo e `lerConfiguracaoJson<number>` faz
    // `data.valor as T` sem conferir `typeof`. Nenhuma das duas protege
    // contra um valor GRAVADO e inválido — só contra chave ausente.
    //
    // O cenário não é ataque, é erro de digitação em Admin → Configurações
    // (a tela grava qualquer jsonb): com `histerese_n = 0`, a janela vira
    // `slice(0,0) = []`, a guarda `janela.length < n` não pega (`0 < 0` é
    // falso), `every` sobre array vazio é `true` por vacuidade e
    // `janela[0].indice` lança `TypeError`. A exceção sobe até o GET do
    // polling e derruba a tela da sessão AO VIVO com 500 a cada 3 s, até
    // alguém corrigir a config à mão. O pentester reproduziu isso em Node.
    //
    // Regra: valor inválido cai no padrão, NUNCA quebra. Mesma régua de
    // robustez que já valia para chave ausente.
    const n = Number.isInteger(nBruto) && nBruto >= 1 ? nBruto : PADRAO_HISTERESE_N;
    const pisoConfianca =
      typeof pisoBruto === "number" && Number.isFinite(pisoBruto) && pisoBruto >= 0 && pisoBruto <= 1
        ? pisoBruto
        : PADRAO_PISO_CONFIANCA_BLOCO;

    // 🔴 CORRIGIDO (achado do Fable, Fase 12 Fatia 1 — defeito 1, DUAS
    // rodadas, preservado nesta correção de histerese): a 1ª correção trocou
    // `bloco_id is not null` por `conteudo->'bloco_inferido' is not null` —
    // mas `->` (sem `>`) devolve o objeto jsonb inteiro, e quando
    // `validar.ts` grava o "não sei" honesto como `{"bloco_inferido": null}`
    // (JSON null, não coluna ausente), esse `->` devolve jsonb `null`, que em
    // SQL **não é** `NULL` (`'{"bloco_inferido": null}'::jsonb ->
    // 'bloco_inferido' is not null` → `true`, medido em produção). A
    // correção usa `->>` (extrai como texto): sobre jsonb `null` o Postgres
    // devolve SQL NULL de verdade — o filtro abaixo continua idêntico, só o
    // `limit` muda de 1 para `LIMITE_CANDIDATAS_LIDAS_HISTERESE` (histerese
    // precisa das `n` mais recentes PARA A JANELA de concordância, mais
    // margem para achar "o que valia antes dela" sem persistir estado — ver
    // `aplicarHisterese`; o piso de confiança só é aplicado DEPOIS, em
    // memória, então ler só `n + 1` deixaria leituras fracas intercaladas
    // engolirem a janela antes de chegar a candidatas válidas).
    //
    // `confianca` vem de dentro do jsonb (`bloco_inferido.confianca`), NUNCA
    // da coluna `copiloto_sugestoes.confianca` (que é `confianca_geral` — a
    // confiança da sugestão INTEIRA, não da inferência de bloco).
    const { data: candidatasRaw, error } = await supabase
      .from("copiloto_sugestoes")
      .select("bloco_id, conteudo, criado_em")
      .eq("sessao_id", sessaoId)
      .not("conteudo->bloco_inferido->>bloco_id", "is", null)
      .order("ordem_evento", { ascending: false })
      .limit(Math.max(LIMITE_CANDIDATAS_LIDAS_HISTERESE, n + 1))
      .returns<
        Array<{
          bloco_id: string | null;
          conteudo: { bloco_inferido?: { bloco_id: string; confianca: number } | null } | null;
          criado_em: string;
        }>
      >();

    if (!error && candidatasRaw) {
      const candidatas: CandidataHisterese[] = candidatasRaw
        .map((linha) => {
          const blocoInferido = linha.conteudo?.bloco_inferido;
          return blocoInferido?.bloco_id
            ? { blocoId: blocoInferido.bloco_id, confianca: blocoInferido.confianca, criadoEm: linha.criado_em }
            : null;
        })
        .filter((c): c is CandidataHisterese => c !== null);

      const resolvido = aplicarHisterese(candidatas, blocos, { pisoConfianca, n, permiteRetrocesso });
      if (resolvido) {
        const bloco = blocos[resolvido.indice]!;
        return {
          bloco_id: bloco.id,
          indice: resolvido.indice,
          titulo: bloco.titulo,
          origem: "inferido",
          confianca: resolvido.confianca,
          decidido_em: resolvido.criadoEm,
          fixacao_expira_em: null,
        };
      }
    }
  }

  return {
    bloco_id: null,
    indice: null,
    titulo: null,
    origem: "indisponivel",
    confianca: null,
    decidido_em: null,
    fixacao_expira_em: null,
  };
}

/**
 * 🔴 CORRIGIDO (Fase 12, Fatia 1): até esta fatia, `indiceBlocoAtual` vinha
 * do CHAMADOR (a rota recebia `?bloco=<indice>` — o mesmo índice que
 * `ConduzirSessaoApp` guardava em `sessionStorage`) e este comentário dizia,
 * por escrito, que "o servidor não tem 'onde a advogada está agora', só a
 * tela tem". Isso deixou de ser verdade: o servidor agora INFERE o bloco a
 * partir da fala real (`copiloto_sugestoes.bloco_id`, escrito pelo ciclo
 * automático a partir de `bloco_inferido` da IA — `ciclo.ts`,
 * `schema.ts::BlocoInferidoSchema`) e só cede a vez para o índice da tela
 * quando essa fixação é RECENTE (`fixacaoManual`, ver
 * `resolverBlocoAtual`/`CHAVE_JANELA_FIXACAO_MANUAL_SEGUNDOS`). O parâmetro
 * `indiceBlocoAtual` permanece (compatibilidade com `contexto.ts`/`ciclo.ts`,
 * que continuam usando um índice simples para montar o CONTEÚDO do bloco
 * atual do roteiro — não para decidir QUAL é o bloco atual) — quem decide
 * qual bloco é "atual" para a TELA é `bloco_atual_resolvido` no retorno
 * desta função, não mais `indiceBlocoAtual`.
 */
export async function montarEstadoCopiloto(
  supabase: SupabaseClient,
  sessaoId: string,
  indiceBlocoAtual: number | null,
  fixacaoManual: FixacaoManualBloco | null = null,
): Promise<EstadoCopilotoCompleto> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select(
      "id, roteiro_versao_id, sims, jornadas(pessoa_id, briefings(conteudo, atual)), roteiros_versoes(definicao), " +
        // Fase 12, Fatia 5a: `inventario_acumulado` entra no MESMO embed —
        // ZERO query nova (achado do arquiteto: "já vem no mesmo embed que
        // montarEstadoCopiloto já faz").
        "sessoes_copiloto(estado, gravacao_externa_id, participantes, expurgo_segmentos_em, inventario_acumulado)",
    )
    .eq("id", sessaoId)
    .maybeSingle<SessaoComRoteiroEBloco>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

  // 🔴 FALLBACK DE ROTEIRO ATIVO — medido na sessão AO VIVO de 18/09/2026
  // (Carlos Alberto, `b3eca233`). O fallback já existia em `contexto.ts`
  // (achado do coordenador, 14/09) e NÃO foi propagado para cá: a mesma
  // correção ficou aplicada em um só dos dois lugares que leem o roteiro.
  //
  // `roteiro_versao_id` só é carimbado por `registrar_sim_sessao` (0030) no
  // 1º SIM — nascer NULO é o DESENHO, não defeito de dado. Sem o fallback,
  // `blocos` fica `[]`, o `blocos.findIndex` de `aplicarHisterese` devolve
  // -1 para TODA candidata, as 16 inferências válidas da IA são descartadas
  // e `resolverBlocoAtual` cai em `indisponivel` — que `route.ts` converte
  // em índice 0 para montar contexto. Efeito medido em 1h10 de sessão real:
  // `copiloto_ciclos.bloco_indice = 0` em 100% das 215 janelas e 98 de 113
  // sugestões (87%) dizendo "desvie do bloco atual", comparando conversa de
  // partilha patrimonial contra o bloco de Check-in.
  //
  // Mesma query e mesmo contrato de `contexto.ts`: `uniq_roteiro_ativo`
  // (índice único parcial em `(chave) where ativo`, 0030), Index Scan por
  // igualdade, e só roda quando a FK é NULA. NUNCA escreve
  // `roteiro_versao_id` de volta — carimbar é ato de `registrar_sim_sessao`,
  // com autoria; inventar o carimbo contaminaria o registro de qual roteiro
  // realmente conduziu a sessão.
  let blocos = data.roteiros_versoes?.definicao?.blocos ?? [];
  if (blocos.length === 0) {
    const { data: ativo, error: erroAtivo } = await supabase
      .from("roteiros_versoes")
      .select("definicao")
      .eq("chave", CHAVE_ROTEIRO_SESSAO_VIABILIDADE)
      .eq("ativo", true)
      .maybeSingle<{ definicao: RoteiroDefinicao }>();
    if (erroAtivo) throw erroAtivo;
    blocos = ativo?.definicao?.blocos ?? [];
  }

  const [blocoAtualResolvido, inventarioMencionadoAtivo] = await Promise.all([
    resolverBlocoAtual(supabase, sessaoId, blocos, fixacaoManual),
    // Fase 12, Fatia 5a — mesma chave que já controla o bloco G do contexto
    // de IA (0111); lida aqui em PARALELO com a resolução do bloco (que já
    // faz suas próprias leituras de config) — nenhuma serialização nova.
    lerConfiguracaoBool(supabase, CHAVE_INVENTARIO_MENCIONADO_ATIVO, true),
  ]);
  // `indice` para o CONTEÚDO do bloco (campos/observar/percorridos) segue o
  // mesmo fallback de sempre (0 quando nada resolve) — é um detalhe de
  // MONTAGEM DE CONTEXTO, diferente de `bloco_atual_resolvido`, que é o FATO
  // exposto à tela e nunca finge um índice que não existe.
  const indiceParaConteudo =
    blocoAtualResolvido.indice ??
    (Number.isInteger(indiceBlocoAtual) && (indiceBlocoAtual as number) >= 0 && (indiceBlocoAtual as number) < blocos.length
      ? (indiceBlocoAtual as number)
      : 0);
  const blocoAtual = blocos[indiceParaConteudo] ?? null;

  const camposPendentes: CampoPendente[] = (blocoAtual?.campos ?? []).map((c) => ({
    id: c.id,
    rotulo: c.rotulo,
    tipo: c.tipo,
  }));
  const observarPendente: string[] = blocoAtual?.observar ?? [];

  const simsPendentes = await calcularSimsPendentes(supabase, data.jornadas?.pessoa_id ?? null, data.sims);

  const blocosNaoPercorridos: BlocoPendente[] = blocos
    .map((b, i) => ({ id: b.id, titulo: b.titulo, indice: i }))
    .filter((b) => b.indice > indiceParaConteudo);

  const { bot, comparacaoDecisores } = montarBotEComparacaoDecisores(data);

  return {
    sessao_id: data.id,
    bloco_atual_id: blocoAtual?.id ?? null,
    falta_no_bloco: { campos: camposPendentes, observar: observarPendente },
    sims_pendentes: simsPendentes,
    blocos_nao_percorridos: blocosNaoPercorridos,
    estado_copiloto: data.sessoes_copiloto?.estado ?? "aguardando",
    bot,
    comparacao_decisores: comparacaoDecisores,
    expurgo_segmentos_em: data.sessoes_copiloto?.expurgo_segmentos_em ?? null,
    bloco_atual_resolvido: blocoAtualResolvido,
    inventario: montarInventarioParaPainel(data.sessoes_copiloto?.inventario_acumulado ?? null, inventarioMencionadoAtivo),
  };
}

/**
 * Os 4 SIMs — 3 vêm de `sessoes_viabilidade.sims` (já na query principal); o
 * 1º (sigilo_gravacao) é o consentimento MAIS RECENTE do tipo
 * 'gravacao_sessao' da pessoa (mesma regra de "vigente" que
 * `GET /api/sessoes/[id]/sims` já usa) — 2ª leitura, pequena (1 linha, por
 * pessoa_id indexado em `idx_consent_pessoa_tipo`, 0005). Roda em TODA
 * chamada (não só quando o bloco atual é o 1º): o 1º SIM pode continuar
 * pendente em qualquer bloco da sessão, e a lista de pendentes precisa
 * refletir isso o tempo todo.
 *
 * `pessoaId` já vem resolvido do embed da query principal — nenhuma consulta
 * a `jornadas` aqui (era uma 3ª ida ao banco; achado do Fable, corrigido).
 */
async function calcularSimsPendentes(
  supabase: SupabaseClient,
  pessoaId: string | null,
  simsConducao: SessaoComRoteiroEBloco["sims"],
): Promise<SimPendente[]> {
  const pendentes: SimPendente[] = [];

  if (pessoaId) {
    const { data: consentimento, error: erroConsentimento } = await supabase
      .from("consentimentos")
      .select("concedido, revogado_em")
      .eq("pessoa_id", pessoaId)
      .eq("tipo", "gravacao_sessao")
      .order("concedido_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ concedido: boolean; revogado_em: string | null }>();
    if (erroConsentimento) throw erroConsentimento;

    const sigiloOk = !!consentimento && consentimento.concedido && !consentimento.revogado_em;
    if (!sigiloOk) pendentes.push({ sim: "sigilo_gravacao", rotulo: ROTULOS_SIM.sigilo_gravacao });
  }

  for (const sim of ["licitude", "decisores", "proximo_passo"] as const) {
    if (!simsConducao?.[sim]?.ok) {
      pendentes.push({ sim, rotulo: ROTULOS_SIM[sim] });
    }
  }

  return pendentes;
}
