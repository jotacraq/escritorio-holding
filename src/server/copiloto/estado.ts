import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroDefinicao } from "@/types/roteiro";
import type {
  BlocoPendente,
  CampoPendente,
  ComparacaoDecisoresPresentes,
  EstadoBotCopiloto,
  EstadoCopiloto,
  SimPendente,
} from "@/types/copiloto";
import { erroNaoEncontrado } from "@/server/erros";
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
 * não há briefing ou o campo está ausente (nunca lança). */
function extrairDecisoresEsperados(briefingAtual: BriefingParaDecisores | null): string[] {
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
}

/**
 * `indiceBlocoAtual` vem do CHAMADOR (a rota recebe `?bloco=<indice>` — é o
 * mesmo índice que `ConduzirSessaoApp` já guarda em `sessionStorage`, nunca
 * recalculado aqui: o servidor não tem "onde a advogada está agora", só a
 * tela tem). Fora do intervalo válido → trata como 0, nunca lança.
 */
export async function montarEstadoCopiloto(
  supabase: SupabaseClient,
  sessaoId: string,
  indiceBlocoAtual: number,
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
  const indice = Number.isInteger(indiceBlocoAtual) && indiceBlocoAtual >= 0 && indiceBlocoAtual < blocos.length
    ? indiceBlocoAtual
    : 0;
  const blocoAtual = blocos[indice] ?? null;

  const camposPendentes: CampoPendente[] = (blocoAtual?.campos ?? []).map((c) => ({
    id: c.id,
    rotulo: c.rotulo,
    tipo: c.tipo,
  }));
  const observarPendente: string[] = blocoAtual?.observar ?? [];

  const simsPendentes = await calcularSimsPendentes(supabase, data.jornadas?.pessoa_id ?? null, data.sims);

  const blocosNaoPercorridos: BlocoPendente[] = blocos
    .map((b, i) => ({ id: b.id, titulo: b.titulo, indice: i }))
    .filter((b) => b.indice > indice);

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
