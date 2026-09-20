import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { consolidarTranscricaoDaSessao } from "./consolidar";
import { encerrarBotComRetentativa } from "./recall";
import { gravarRetrospectoDaSessao } from "./retrospecto";
import type { RetrospectoDaSessao } from "@/types/copiloto";

/**
 * O EFEITO de encerrar uma sessão do copiloto — extraído de
 * `POST /api/sessoes/[id]/copiloto/encerrar` (rota) para este módulo porque
 * a partir de agora há DOIS chamadores: o clique da advogada ("Encerrar" na
 * tela) E o ciclo automático, quando `copiloto_sessao.duracao_maxima_minutos`
 * estoura (§4.4 do plano: "encerra sozinho — sessão esquecida aberta não
 * sangra dinheiro"). A 0091 já gravava essa promessa na DESCRIÇÃO da chave
 * ("Sessão de copiloto aberta além deste tempo encerra sozinha (fatia 3)")
 * — achado da revisão desta fatia: a promessa existia, o código não. Este
 * módulo é o que a torna verdadeira, nos dois caminhos, sem duplicar lógica.
 *
 * Quatro efeitos, sempre nesta ordem (as 3 primeiras são a ordem da rota
 * original; a 4ª entrou na Fase 13):
 *  1. `sessoes_copiloto.estado → 'encerrado'` (+ `encerrado_em`), só a
 *     partir de 'aguardando'/'ativo'/'erro' — idempotente, nunca reencerra.
 *  2. Consolidação em `transcricoes` (reusa o caminho de
 *     `POST /api/sessoes/[id]/transcricao`, idempotente por sha256).
 *  3. `desfecho='expirada'` em toda sugestão ainda sem desfecho.
 *  4. 🔴 FASE 13 (19/09/2026) — RETROSPECTO DA SESSÃO
 *     (`retrospecto.ts::gravarRetrospectoDaSessao`, tabela
 *     `copiloto_retrospectos`, 0125). Pendurado DEPOIS de `marcarEncerrada`
 *     ter devolvido não-nulo, que já é o portão de idempotência — roda UMA
 *     VEZ por sessão, nos TRÊS caminhos (clique, `duracao_maxima_minutos`,
 *     retomada de sessão em `'erro'`), sem duplicar lógica. A 2ª trava é o
 *     banco: `sessao_id` é PK da tabela nova.
 *
 *     Decisão do dono (19/09): o retrospecto é GRAVADO em todos os caminhos;
 *     o POP-UP só abre no encerramento MANUAL — isso é da TELA, não deste
 *     módulo. Aqui o dado sempre existe; quem decide mostrar é o front.
 */

export interface SessaoParaEncerrar {
  jornadaId: string;
  realizadaEm: string | null;
}

export interface ResultadoEncerramento {
  encerrado: boolean; // false = já estava encerrada (ou corrida perdida) — nada foi feito
  encerradoEm: string | null;
  transcricaoId: string | null;
  jaExistiaTranscricao: boolean;
  sugestoesExpiradas: number;
  /** FASE 13 (19/09/2026) — o Retrospecto da Sessão, gravado aqui dentro.
   * `null` quando `copiloto_sessao.retrospecto_ativo` está desligado (ou a
   * chave está ausente — fail-closed) OU quando a montagem falhou: o
   * encerramento NUNCA é derrubado por isso (ver `gravarRetrospectoDaSessao`).
   * `encerrado:false` sempre traz `null` — nada foi feito nesta chamada. */
  retrospecto: RetrospectoDaSessao | null;
}

interface ErroPostgrest {
  code?: string;
}

async function buscarNomePessoaDaJornada(supabase: SupabaseClient, jornadaId: string): Promise<string | null> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle<{ pessoa_id: string }>();
  if (erroJornada) throw erroJornada;
  if (!jornada) return null;

  const { data: pessoa, error: erroPessoa } = await supabase
    .from("pessoas")
    .select("nome")
    .eq("id", jornada.pessoa_id)
    .maybeSingle<{ nome: string }>();
  if (erroPessoa) throw erroPessoa;
  return pessoa?.nome ?? null;
}

/**
 * `.in('estado', [...])` na condição, não `.eq()` solto — o UPDATE não
 * "reencerra" silenciosamente uma sessão já encerrada nem sobrescreve
 * `encerrado_em`. Devolve `null` quando NENHUMA linha mudou (corrida: outra
 * requisição encerrou entre a leitura do chamador e este UPDATE, ou chamada
 * dupla do próprio ciclo automático); devolve `gravacaoExternaId` (pode ser
 * `null`, sessão sem bot) quando o UPDATE realmente encerrou a linha — é o
 * MESMO UPDATE que já fazia isso, só devolvendo mais uma coluna, para não
 * pagar uma 2ª ida ao banco só para saber se há bot para encerrar.
 *
 * 🔴 CORREÇÃO (achado do Fable: "o ciclo da pendência fechou para 1 dos 3
 * nascedouros"): `'erro'` ENTROU na lista de estados de origem aceitos.
 * Uma sessão cai em `'erro'` pelos 2 nascedouros da rota do bot (retenção
 * infinita detectada, ou falha ao persistir o vínculo) — ela NUNCA passou
 * por `marcarEncerrada` de verdade, então não tem `encerrado_em` nem foi
 * consolidada. Sem aceitar `'erro'` aqui, essas sessões ficavam BRICADAS:
 * a pendência do bot podia até ser limpa, mas a sessão nunca tinha caminho
 * formal de fim (nem bot novo — `bot/route.ts` recusa `'erro'` — nem
 * encerramento formal — este UPDATE recusava `'erro'`).
 */
async function marcarEncerrada(
  admin: SupabaseClient,
  sessaoId: string,
  encerradoEm: string,
): Promise<{ gravacaoExternaId: string | null } | null> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .update({ estado: "encerrado", encerrado_em: encerradoEm })
    .eq("sessao_id", sessaoId)
    .in("estado", ["aguardando", "ativo", "erro"])
    .select("sessao_id, gravacao_externa_id")
    .maybeSingle<{ sessao_id: string; gravacao_externa_id: string | null }>();
  if (error) throw error;
  return data === null ? null : { gravacaoExternaId: data.gravacao_externa_id };
}

/**
 * Tira o bot da sala quando a sessão encerra — Fase 10, Fatia 4
 * (docs/ARQUITETURA-FASE-10.md §4.2.2, achado do coordenador: "encerrar a
 * sessão deixa o bot na sala... a advogada encerra, a transcrição é
 * consolidada, e o bot continua gravando e cobrando até `automatic_leave`
 * estourar"). Chamado nos TRÊS caminhos de encerramento (manual,
 * `duracao_maxima_minutos` E, indiretamente, o ramo de retenção infinita de
 * `bot/route.ts`, que grava a MESMA coluna) porque manual e duração máxima
 * passam por `executarEncerramentoCopiloto` — um efeito só, sem duplicar.
 *
 * 🔴 CORREÇÃO (achado A do Fable, revisão de Solidificação): esta função
 * chamava `encerrarBot()` CRU, sem retentativa, e só registrava
 * `registrarErro` (stdout) em falha — exatamente o padrão que o achado 4
 * mandou eliminar em `bot/route.ts`, mas que sobreviveu aqui, NO CAMINHO
 * COMUM (encerramento manual e por duração máxima; "retenção infinita" é o
 * ramo raro). Corrigido: usa `encerrarBotComRetentativa` (1 retentativa,
 * resultado explícito) e grava `sessoes_copiloto.pendencia_encerramento_bot`
 * em falha — PENDÊNCIA VISÍVEL (0097/vw_pendencias_sistema), não só stdout.
 *
 * 🔴 CORREÇÃO (achado B do Fable): quando a tentativa TEM SUCESSO, limpa
 * `pendencia_encerramento_bot` de volta para `NULL` — sem isso, uma
 * pendência resolvida à mão (a equipe remove o bot manualmente da sala e
 * clica "Encerrar" de novo) ficava ETERNA no Painel do dia, porque nada
 * jamais escrevia NULL ali. Alerta que ninguém consegue apagar é alerta que
 * todo mundo aprende a ignorar.
 *
 * NUNCA lança e NUNCA impede a consolidação: falha ao tirar o bot da sala é
 * um problema de CUSTO/operação, não um motivo para a transcrição — que é o
 * ponto inteiro da Fatia 3 — deixar de ser consolidada. Por isso o UPDATE de
 * pendência (sucesso OU falha) é feito num `try/catch` que nunca propaga.
 */
async function tirarBotDaSalaSeHouver(admin: SupabaseClient, sessaoId: string, gravacaoExternaId: string | null): Promise<void> {
  if (!gravacaoExternaId) return; // sessão nunca teve bot (modo manual/digitado) — nada a fazer

  try {
    const resultado = await encerrarBotComRetentativa(gravacaoExternaId);

    if (resultado.sucesso) {
      // Limpa uma pendência anterior, se houver — encerramento com sucesso É
      // o caminho de "resolvido" (achado B). `.eq("pendencia_encerramento_bot"
      // ...)` não é necessário: um UPDATE de NULL para NULL é barato e idempotente.
      await admin
        .from("sessoes_copiloto")
        .update({ pendencia_encerramento_bot: null, pendencia_encerramento_bot_em: null })
        .eq("sessao_id", sessaoId);
      return;
    }

    // Falha DEFINITIVA (2 tentativas) — pendência visível, mesmo texto
    // operacional usado em `bot/route.ts` para o ramo de retenção infinita.
    // `pendencia_encerramento_bot_em` (0097, achado C) é o instante REAL da
    // falha — nunca `sessoes_copiloto.criado_em`, que é quando a SESSÃO foi
    // criada, não quando o encerramento falhou.
    registrarErro("copiloto/encerrar.tirarBotDaSalaSeHouver", new Error(`encerrarBotComRetentativa: ${resultado.detalhe}`), {
      sessao_id: sessaoId,
      bot_id: gravacaoExternaId,
    });
    await admin
      .from("sessoes_copiloto")
      .update({
        pendencia_encerramento_bot:
          `O servidor tentou encerrar o bot ao consolidar a sessão e NÃO CONSEGUIU após 2 tentativas ` +
          `(bot_id: ${gravacaoExternaId}). Encerre a reunião agora ou remova manualmente o participante ` +
          `"Assistente — Escritório Elaine Montenegro" da sala.`,
        pendencia_encerramento_bot_em: new Date().toISOString(),
      })
      .eq("sessao_id", sessaoId);
  } catch (erro) {
    // Defesa em profundidade: `encerrarBotComRetentativa` já captura os
    // erros dela mesma e nunca deveria lançar, mas a consolidação da
    // transcrição não pode depender dessa garantia se um dia ela quebrar.
    registrarErro("copiloto/encerrar.tirarBotDaSalaSeHouver#inesperado", erro, { sessao_id: sessaoId, bot_id: gravacaoExternaId });
  }
}

/**
 * `desfecho='expirada'` — só sugestões AINDA sem desfecho. A trigger
 * `trg_copiloto_sugestoes_desfecho_imutavel` (0095) é o backstop: se uma
 * sugestão ganhar desfecho por corrida entre a leitura e este UPDATE, o
 * 23514 é absorvido (a linha já tem desfecho real, que é o resultado certo).
 */
async function expirarSugestoesPendentes(admin: SupabaseClient, sessaoId: string, encerradoEm: string): Promise<number> {
  const { data, error } = await admin
    .from("copiloto_sugestoes")
    .update({ desfecho: "expirada", desfecho_em: encerradoEm })
    .eq("sessao_id", sessaoId)
    .is("desfecho", null)
    .select("id");
  if (error) {
    const pg = error as ErroPostgrest;
    if (pg.code === "23514") return 0;
    throw error;
  }
  return (data ?? []).length;
}

/**
 * Executa o encerramento completo. `admin` (service_role) faz toda a
 * escrita — mesmo motivo das outras escritas do copiloto (RLS de 0091 não
 * dá gaveta a `authenticated`). `supabase` (com sessão) só lê o nome da
 * pessoa para o rótulo da transcrição.
 *
 * `encerrado: false` quando a sessão já estava encerrada (ou perdeu a
 * corrida) — o CHAMADOR decide o que isso significa (a rota devolve 409;
 * o ciclo automático simplesmente não tenta de novo, silêncio).
 */
export async function executarEncerramentoCopiloto(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { sessaoId: string; sessao: SessaoParaEncerrar; criadoPor?: string | null },
): Promise<ResultadoEncerramento> {
  const encerradoEm = new Date().toISOString();

  const mudou = await marcarEncerrada(admin, params.sessaoId, encerradoEm);
  if (!mudou) {
    return {
      encerrado: false,
      encerradoEm: null,
      transcricaoId: null,
      jaExistiaTranscricao: false,
      sugestoesExpiradas: 0,
      retrospecto: null,
    };
  }

  // Tira o bot da sala ANTES de consolidar — mas NUNCA lança e NUNCA impede a
  // consolidação abaixo (comentário de topo de `tirarBotDaSalaSeHouver`): é
  // esse `await` isolado, sem propagar erro, que garante isso.
  await tirarBotDaSalaSeHouver(admin, params.sessaoId, mudou.gravacaoExternaId);

  const nomePessoa = await buscarNomePessoaDaJornada(supabase, params.sessao.jornadaId);
  const consolidacao = await consolidarTranscricaoDaSessao(admin, {
    sessaoId: params.sessaoId,
    jornadaId: params.sessao.jornadaId,
    rotulo: nomePessoa ? `Sessão de Viabilidade — ${nomePessoa}` : "Sessão de Viabilidade",
    dataReuniao: params.sessao.realizadaEm ? params.sessao.realizadaEm.slice(0, 10) : null,
  });

  if (consolidacao.transcricaoId) {
    await admin.from("sessoes_copiloto").update({ transcricao_id: consolidacao.transcricaoId }).eq("sessao_id", params.sessaoId);
  }

  const sugestoesExpiradas = await expirarSugestoesPendentes(admin, params.sessaoId, encerradoEm);

  // 🔴 FASE 13 — RETROSPECTO. Pendurado DEPOIS de `marcarEncerrada` ter
  // devolvido não-nulo, que é o portão de idempotência desta função: roda
  // UMA VEZ por sessão, nos TRÊS caminhos (clique da advogada,
  // `duracao_maxima_minutos`, retomada de sessão em `'erro'`), sem duplicar
  // lógica em lugar nenhum. A segunda trava é o banco: `sessao_id` é PK de
  // `copiloto_retrospectos` (0125) — duas linhas é impossível.
  //
  // Vem POR ÚLTIMO de propósito: `expirarSugestoesPendentes` acabou de rodar,
  // então o retrospecto retrata a sessão já fechada. E `gravarRetrospectoDaSessao`
  // NUNCA lança (try/catch interno, mesma disciplina de
  // `tirarBotDaSalaSeHouver`) — falhar aqui devolve `retrospecto: null` e o
  // encerramento continua válido: a transcrição consolidada é o que não pode
  // se perder, o documento de fim de sessão é remontável.
  //
  // 🔴 DEFESA EM PROFUNDIDADE (§D.4 item 4 do plano): `gravarRetrospectoDaSessao`
  // JÁ tem `try/catch` próprio e, por contrato, nunca lança — mas o
  // encerramento não pode DEPENDER dessa garantia. Se um dia ela quebrar (um
  // `throw` novo antes do try interno, por exemplo), a transcrição
  // consolidada não pode se perder junto. Mesmo raciocínio, literalmente, do
  // `catch` "#inesperado" de `tirarBotDaSalaSeHouver`. `encerrar.test.ts`
  // prova este caminho com um mock que REJEITA.
  let retrospecto: RetrospectoDaSessao | null = null;
  try {
    retrospecto = await gravarRetrospectoDaSessao(supabase, admin, {
      sessaoId: params.sessaoId,
      jornadaId: params.sessao.jornadaId,
      criadoPor: params.criadoPor ?? null,
    });
  } catch (erro) {
    // Só ids no log — o corpo do retrospecto carrega fala de família real.
    registrarErro("copiloto/encerrar.gravarRetrospecto#inesperado", erro, {
      sessao_id: params.sessaoId,
      jornada_id: params.sessao.jornadaId,
    });
  }

  return {
    encerrado: true,
    encerradoEm,
    transcricaoId: consolidacao.transcricaoId,
    jaExistiaTranscricao: consolidacao.jaExistia,
    sugestoesExpiradas,
    retrospecto,
  };
}

/**
 * Encerramento AUTOMÁTICO por `copiloto_sessao.duracao_maxima_minutos`
 * (§4.4 do plano) — chamado pelo ciclo (`server/copiloto/ciclo.ts`) ANTES de
 * avaliar gatilho/claim/gate: uma sessão esquecida aberta não deve nem
 * chegar a avaliar gatilho, deve encerrar e parar. Nunca lança — falha aqui
 * não pode derrubar o polling (mesmo princípio do try/catch ao redor do
 * ciclo inteiro na rota); se o encerramento automático falhar, a sessão
 * segue ativa e a próxima chamada tenta de novo.
 */
export async function encerrarSePassouDoTempo(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { sessaoId: string; jornadaId: string; realizadaEm: string | null; inicioSessaoIso: string; duracaoMaximaMinutos: number; agoraMs: number },
): Promise<boolean> {
  const minutosDecorridos = (params.agoraMs - Date.parse(params.inicioSessaoIso)) / 60_000;
  if (!(minutosDecorridos >= params.duracaoMaximaMinutos)) return false;

  try {
    const resultado = await executarEncerramentoCopiloto(supabase, admin, {
      sessaoId: params.sessaoId,
      sessao: { jornadaId: params.jornadaId, realizadaEm: params.realizadaEm },
    });
    return resultado.encerrado;
  } catch (erro) {
    registrarErro("copiloto/encerrar.encerrarSePassouDoTempo", erro, { sessao_id: params.sessaoId });
    return false;
  }
}

/**
 * Resultado de `tentarNovamenteEncerrarBotPendente` — Fase 10, Fatia 4,
 * achado B do Fable (revisão de Solidificação): "ninguém limpa a pendência
 * ... a rota recusa sessão em `erro` com 409 — então nem existe retry que
 * pudesse limpar". Uma sessão já `estado='encerrado'` com
 * `pendencia_encerramento_bot` preenchida não passa mais por
 * `marcarEncerrada` (que só transiciona `aguardando`/`ativo`) — sem este
 * caminho, a pendência ficaria ETERNA no Painel do dia mesmo depois de
 * alguém remover o bot manualmente da sala.
 *
 * `resultadoEncerramento` só é preenchido quando a sessão SAI do `'erro'`
 * nesta chamada (ver comentário de `tentarNovamenteEncerrarBotPendente`
 * abaixo, achado do Fable: "o ciclo da pendência fechou para 1 dos 3
 * nascedouros" — os 2 nascedouros da rota do bot deixavam a sessão em
 * `'erro'` SEM caminho formal de fim; esta chamada é esse caminho). O
 * CHAMADOR usa esse resultado direto para montar o payload de sucesso —
 * NUNCA chama `executarEncerramentoCopiloto` de novo (a sessão já foi
 * marcada `'encerrado'` dentro desta função; uma 2ª chamada encontraria
 * `encerrado: false` por corrida consigo mesma).
 */
export type ResultadoRetentativaPendenciaBot =
  | { tentou: false } // sessão sem pendência (ou sem sessoes_copiloto) — nada a fazer
  | { tentou: true; resolvida: boolean; resultadoEncerramento: ResultadoEncerramento | null };

/**
 * Chamada pela rota `POST /api/sessoes/[id]/copiloto/encerrar` QUANDO a
 * sessão já está `'encerrado'` OU `'erro'` (que hoje devolveria só
 * `sessao_ja_encerrada` e pararia ali) — se houver `pendencia_encerramento_bot`,
 * tenta resolver em vez de recusar cegamente.
 *
 * 🔴 CORREÇÃO (achado do Fable: "o ciclo da pendência fechou para 1 dos 3
 * nascedouros"). Os DOIS nascedouros da pendência em `bot/route.ts`
 * (retenção infinita detectada, ou falha ao persistir o vínculo) deixam a
 * sessão em `estado='erro'` — DIFERENTE do nascedouro em `tirarBotDaSalaSeHouver`
 * (caminho comum), que só grava pendência numa sessão que JÁ está
 * `'encerrado'`. As duas situações pedem efeitos DIFERENTES:
 *
 *   - `estado==='encerrado'`: a sessão já foi consolidada — só falta tirar
 *     o bot da sala. Comportamento de sempre: `tirarBotDaSalaSeHouver`
 *     sozinha (limpa a pendência em sucesso, sem re-consolidar).
 *   - `estado==='erro'`: a sessão NUNCA foi consolidada (não passou por
 *     `marcarEncerrada`, não tem `encerrado_em`) — precisa do fluxo
 *     COMPLETO. Delega para `executarEncerramentoCopiloto`, que agora
 *     aceita `'erro'` como estado de origem (`marcarEncerrada` estendida) —
 *     ela mesma chama `tirarBotDaSalaSeHouver` internamente, então esta
 *     função NÃO chama de novo (evita tentar encerrar o bot duas vezes na
 *     mesma requisição). O resultado inteiro é devolvido ao chamador — não
 *     é chamado de novo por fora, o que criaria uma corrida contra si mesma.
 */
export async function tentarNovamenteEncerrarBotPendente(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  sessaoId: string,
  sessao: SessaoParaEncerrar,
  /** FASE 13 — autoria do Retrospecto quando ESTA chamada tira a sessão do
   * `'erro'` e a encerra de verdade (o ramo que delega para
   * `executarEncerramentoCopiloto`). `null`/ausente no ramo `'encerrado'`,
   * que não grava retrospecto nenhum (a sessão já foi encerrada antes). */
  criadoPor: string | null = null,
): Promise<ResultadoRetentativaPendenciaBot> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .select("estado, gravacao_externa_id, pendencia_encerramento_bot")
    .eq("sessao_id", sessaoId)
    .maybeSingle<{ estado: string; gravacao_externa_id: string | null; pendencia_encerramento_bot: string | null }>();
  if (error) throw error;
  if (!data || !data.pendencia_encerramento_bot || !data.gravacao_externa_id) {
    return { tentou: false };
  }

  if (data.estado === "erro") {
    // Fluxo COMPLETO: marca encerrada (a partir de 'erro', ver marcarEncerrada),
    // tira o bot da sala (dentro de executarEncerramentoCopiloto), consolida
    // a transcrição, expira sugestões — a sessão nunca passou por nada disso.
    const resultado = await executarEncerramentoCopiloto(supabase, admin, { sessaoId, sessao, criadoPor });
    if (!resultado.encerrado) {
      // Corrida: outra requisição já resolveu entre a leitura acima e agora.
      return { tentou: true, resolvida: true, resultadoEncerramento: null };
    }
    const { data: depois, error: erroDepois } = await admin
      .from("sessoes_copiloto")
      .select("pendencia_encerramento_bot")
      .eq("sessao_id", sessaoId)
      .maybeSingle<{ pendencia_encerramento_bot: string | null }>();
    if (erroDepois) throw erroDepois;
    return { tentou: true, resolvida: !depois?.pendencia_encerramento_bot, resultadoEncerramento: resultado };
  }

  // estado === 'encerrado': já consolidada, só falta tirar o bot da sala.
  await tirarBotDaSalaSeHouver(admin, sessaoId, data.gravacao_externa_id);

  const { data: depois, error: erroDepois } = await admin
    .from("sessoes_copiloto")
    .select("pendencia_encerramento_bot")
    .eq("sessao_id", sessaoId)
    .maybeSingle<{ pendencia_encerramento_bot: string | null }>();
  if (erroDepois) throw erroDepois;

  return { tentou: true, resolvida: !depois?.pendencia_encerramento_bot, resultadoEncerramento: null };
}
