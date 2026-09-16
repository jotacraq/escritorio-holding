import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroDefinicao } from "@/types/roteiro";
import type {
  BlocoAtualResolvido,
  BlocoPendente,
  CampoPendente,
  ComparacaoDecisoresPresentes,
  EstadoBotCopiloto,
  EstadoCopiloto,
  SimPendente,
} from "@/types/copiloto";
import { erroNaoEncontrado } from "@/server/erros";
import { lerConfiguracaoBool, lerConfiguracaoInt } from "@/server/ia/configuracao";
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

/**
 * Resolve o `BlocoAtualResolvido` — a correção do defeito-raiz. Precedência:
 *   1. Fixação manual, se `fixadoEm` estiver dentro de
 *      `copiloto_sessao.janela_fixacao_manual_segundos` (300s ao nascer) a
 *      partir de AGORA — nunca calculada a partir de `criado_em` da sessão,
 *      é sempre "há quanto tempo a advogada clicou", não "há quanto tempo a
 *      sessão existe".
 *   2. Senão, e só se `copiloto_sessao.inferencia_bloco_ativa=true`: a
 *      última linha de `copiloto_sugestoes` desta sessão com `bloco_id not
 *      null`, mais recente por `ordem_evento` — MESMO índice do polling
 *      (`idx_copiloto_sugestoes_polling`, 0091), nenhum índice novo. É 1
 *      query adicional (não estava no caminho antes desta fatia) — pequena
 *      (`limit 1` sobre índice existente) e só roda quando NÃO há fixação
 *      manual vigente.
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
    // 🔴 CORRIGIDO (achado do Fable, Fase 12 Fatia 1 — defeito 1, DUAS
    // rodadas): a 1ª correção trocou `bloco_id is not null` por
    // `conteudo->'bloco_inferido' is not null` — mas `->` (sem `>`) devolve
    // o objeto jsonb inteiro, e quando `validar.ts` grava o "não sei" honesto
    // como `{"bloco_inferido": null}` (JSON null, não coluna ausente), esse
    // `->` devolve jsonb `null`, que em SQL **não é** `NULL`
    // (`'{"bloco_inferido": null}'::jsonb -> 'bloco_inferido' is not null` →
    // `true`, medido em produção). O filtro passava exatamente na resposta
    // honesta "não infiro nada" — a linha era promovida a `origem:"inferido"`
    // com `blocoInferidoId` nulo, e a inferência anterior real (a última que
    // valia) era descartada a cada ciclo em que a IA respondesse "não sei".
    // A correção usa `->>` (extrai como texto): sobre jsonb `null` o Postgres
    // devolve SQL NULL de verdade, então `not(...).is(null)` exclui tanto a
    // chave ausente (linha histórica, anterior à 0106, ou fallback antigo)
    // quanto o JSON null explícito — só passa quem tem `bloco_id` de fato.
    //
    // `confianca` também deixa de vir da coluna `copiloto_sugestoes.confianca`
    // (que é `confianca_geral` — a confiança da sugestão INTEIRA, não da
    // inferência de bloco) — lida agora de dentro do jsonb, o número certo.
    const { data: ultimaInferida, error } = await supabase
      .from("copiloto_sugestoes")
      .select("bloco_id, conteudo, criado_em")
      .eq("sessao_id", sessaoId)
      .not("conteudo->bloco_inferido->>bloco_id", "is", null)
      .order("ordem_evento", { ascending: false })
      .limit(1)
      .maybeSingle<{ bloco_id: string | null; conteudo: { bloco_inferido?: { bloco_id: string; confianca: number } | null } | null; criado_em: string }>();
    const blocoInferidoId = ultimaInferida?.conteudo?.bloco_inferido?.bloco_id ?? null;
    if (!error && ultimaInferida && blocoInferidoId) {
      const indiceInferido = blocos.findIndex((b) => b.id === blocoInferidoId);
      // `bloco_id` gravado que não casa mais com o roteiro ativo (ex.: o
      // roteiro ativo trocou no meio da sessão) → tratado como indisponível,
      // nunca um título inventado.
      if (indiceInferido >= 0) {
        const bloco = blocos[indiceInferido]!;
        return {
          bloco_id: bloco.id,
          indice: indiceInferido,
          titulo: bloco.titulo,
          origem: "inferido",
          confianca: ultimaInferida.conteudo?.bloco_inferido?.confianca ?? null,
          decidido_em: ultimaInferida.criado_em,
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
        "sessoes_copiloto(estado, gravacao_externa_id, participantes, expurgo_segmentos_em)",
    )
    .eq("id", sessaoId)
    .maybeSingle<SessaoComRoteiroEBloco>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

  const blocos = data.roteiros_versoes?.definicao?.blocos ?? [];

  const blocoAtualResolvido = await resolverBlocoAtual(supabase, sessaoId, blocos, fixacaoManual);
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
