import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { conferirGateCopiloto } from "./gate";
import { conferirOrcamentoCopiloto } from "./orcamento";
import { montarContextoCopiloto } from "./contexto";
import { executarIaCopiloto } from "./executar-ia";
import { validarSugestaoCopiloto, sugestaoEVisivel } from "./validar";
import { acumularInventarioNaSessao } from "./inventario";
import { avaliarGatilho, type OrigemBlocoParaGatilho, type TipoGatilhoCopiloto } from "./gatilho";
import { encerrarSePassouDoTempo } from "./encerrar";
import { lerConfiguracaoInt, lerConfiguracaoJson } from "@/server/ia/configuracao";
import type { ContextoCopiloto, SugestaoCopiloto } from "@/types/copiloto";

/**
 * O CICLO AUTOMÁTICO — Fase 10, Fatia 3 (docs/ARQUITETURA-FASE-10.md §4.3,
 * §6.2, §6.2.2). Chamado a cada `GET /api/sessoes/[id]/copiloto` de polling
 * (3 s): a rota de polling avalia se É HORA de rodar um ciclo, e se for,
 * chama `executarCicloCopiloto` — que faz a claim, o gate, o orçamento e,
 * só se tudo passar, chama a IA.
 *
 * 🔴 A ERRATA §6.2.2, APLICADA AQUI (é o ponto central desta fatia): o gate
 * jurídico (`conferirGateCopiloto`) roda A CADA CICLO, não uma vez no início
 * da sessão. Revogar decisão jurídica ou consentimento NO MEIO da sessão
 * cala o CICLO SEGUINTE — nunca "só o próximo INSERT". Não existe cache de
 * "já passou no gate uma vez" em lugar nenhum deste módulo: cada chamada de
 * `executarCicloCopiloto` refaz a consulta em `decisoes_juridicas` e
 * `consentimentos`, exatamente como `POST .../sugestao` (Fatia 2) já fazia
 * para o botão sob demanda — este módulo generaliza o MESMO gate para o
 * caminho automático, não inventa um segundo.
 *
 * ORDEM (mesma ordem de risco crescente de custo da Fatia 2, com a CLAIM
 * entrando ANTES de tudo — é o que esta fatia acrescenta):
 *   1. `copiloto_sessao.ativo` — kill-switch (checado pelo CHAMADOR, a rota
 *      de polling, antes de sequer avaliar gatilho — este módulo assume que
 *      já passou).
 *   2. `sessoes_copiloto.estado` — sessão ENCERRADA ou em ERRO não dispara
 *      ciclo novo (silêncio pós-encerramento é o comportamento certo: a
 *      esta própria função já prevê `duracao_maxima_minutos` encerrando
 *      sozinho, logo abaixo).
 *   3. **Gatilho** (`avaliarGatilho`) — "o primeiro que ocorrer" entre tempo+
 *      fala-nova e virada de bloco (§4.3). Sem gatilho, retorna
 *      `nenhum_gatilho` sem tocar no banco de novo.
 *   4. **Claim atômica** (`copiloto_ciclos`, 0096) — `insert ... on conflict
 *      do nothing returning`. Só quem reivindica a janela segue adiante.
 *   5. **Gate jurídico** (`conferirGateCopiloto`) — decisão ativa +
 *      consentimento do titular. Falhando, a claim FICA GRAVADA (a janela
 *      foi avaliada) mas NADA é enviado à IA.
 *   6. **Orçamento** (`conferirOrcamentoCopiloto`) — teto por sessão/dia.
 *   7. **IA** (`executarIaCopiloto`, timeout 8s) → validação pós-Zod → grava
 *      `copiloto_sugestoes` (mesma trigger de 0093 como backstop).
 *
 * `duracao_maxima_minutos` (§4.4: "encerra sozinho") é conferida AQUI, logo
 * depois de confirmar `estado==='ativo'` e ANTES de avaliar gatilho — uma
 * sessão esquecida aberta além do teto encerra (mesmo efeito de
 * `POST .../encerrar`, via `server/copiloto/encerrar.ts`, reusado) e o ciclo
 * para por ali, sem chegar a avaliar gatilho/claim/IA. CORREÇÃO de achado da
 * revisão desta fatia: a 0091 já gravava esta promessa na DESCRIÇÃO da
 * chave ("encerra sozinha (fatia 3)") — nenhuma linha de código a lia.
 * `intervalo_segundos` é conferido logo depois — é este módulo que decide
 * "é hora de rodar IA", a rota de polling só decide "é hora de PERGUNTAR se
 * é hora".
 */

export type ResultadoCiclo =
  | { situacao: "nenhum_gatilho" }
  | { situacao: "sessao_nao_ativa_para_ciclo" }
  | { situacao: "sessao_encerrada_por_duracao_maxima" }
  | { situacao: "janela_ja_claimada_por_outra_requisicao" }
  | { situacao: "bloqueado_pelo_gate"; motivo: string }
  | { situacao: "orcamento_estourado"; motivo: string }
  | { situacao: "timeout" }
  | { situacao: "indisponivel"; motivo: string }
  | { situacao: "conteudo_recusado" }
  | {
      situacao: "sugestao_gravada";
      sugestaoId: string;
      /** `bigint identity` de `copiloto_sugestoes` (0091, §2.2: "uuid não
       * ordena") — Fase 11: propagado aqui para a rota de polling montar a
       * sugestão da PRÓPRIA chamada, sem esperar o tick seguinte
       * (`buscarSugestoesNovas` filtra por este cursor). */
      ordemEvento: number;
      criadoEm: string;
      gatilho: TipoGatilhoCopiloto;
      visivel: boolean;
      sugestao: SugestaoCopiloto | null;
      /** Confiança REAL sempre presente, mesmo quando `visivel=false` (aí
       * `sugestao` é `null` mas a confiança que causou a não-exibição
       * continua conhecida) — mesmo contrato de `copiloto_sugestoes.confianca`
       * (coluna sempre gravada) que `buscarSugestoesNovas` já lê na rota de
       * polling (Fase 11: usado para montar a entrada sem esperar o tick
       * seguinte, sem inventar `0` para uma sugestão não visível). */
      confiancaGeral: number;
    };

const CHAVE_INTERVALO_SEGUNDOS = "copiloto_sessao.intervalo_segundos";
// 20s desde 15/09/2026 (migration 0102) — era 45s. Baixado JUNTO com
// `teto_ia_sessao` (30→90, orcamento.ts): a 20s o gatilho de intervalo exige
// fala nova e o Deepgram entrega ~1 segmento a cada 4s, então o TETO passa a
// ser a trava real da sessão, não mais o intervalo (ver comentário da 0102).
const PADRAO_INTERVALO_SEGUNDOS = 20;
const CHAVE_CONFIANCA_MINIMA = "copiloto_sessao.confianca_minima";
const PADRAO_CONFIANCA_MINIMA = 0.6;
const CHAVE_DURACAO_MAXIMA_MINUTOS = "copiloto_sessao.duracao_maxima_minutos";
const PADRAO_DURACAO_MAXIMA_MINUTOS = 150;

interface SessaoParaCiclo {
  jornada_id: string;
  criado_em: string;
  realizada_em: string | null;
  sessoes_copiloto: { estado: string; iniciado_em: string | null; criado_em: string } | null;
  jornadas: { pessoa_id: string } | null;
}

/**
 * `janela = floor(segundos_desde_inicio / intervalo_segundos)` (§4.3/0096).
 * `inicioSessaoIso` é `sessoes_copiloto.iniciado_em` (carimbado no 1º
 * segmento, Fatia 1) — nunca `sessoes_viabilidade.criado_em`, que é quando a
 * LINHA da sessão foi criada no sistema, não quando o copiloto começou a
 * ouvir. Sem `sessoes_copiloto` (copiloto nunca ativado) não há como calcular
 * janela — o chamador não deveria ter chegado aqui sem uma linha existente.
 */
function calcularJanela(inicioSessaoIso: string, agoraMs: number, intervaloSegundos: number): number {
  const segundosDesdeInicio = Math.max(0, (agoraMs - Date.parse(inicioSessaoIso)) / 1000);
  return Math.floor(segundosDesdeInicio / intervaloSegundos);
}

/**
 * Reivindica a janela — `insert ... on conflict do nothing returning id`,
 * MESMO padrão de `reivindicarMensagem` (agente-whatsapp/estado.ts, Fase 9).
 * `23505` nunca deveria ocorrer aqui (o `on conflict do nothing` já absorve a
 * colisão), mas é tratado por defesa em profundidade — duas migrations de
 * bancos diferentes, versões de driver, etc.
 */
async function reivindicarJanela(
  admin: SupabaseClient,
  params: { sessaoId: string; janela: number; gatilho: TipoGatilhoCopiloto; blocoIndice: number },
): Promise<boolean> {
  const { data, error } = await admin
    .from("copiloto_ciclos")
    .insert({
      sessao_id: params.sessaoId,
      janela: params.janela,
      gatilho: params.gatilho,
      bloco_indice: params.blocoIndice,
    })
    .select("sessao_id")
    .maybeSingle<{ sessao_id: string }>();

  if (error) {
    if (error.code === "23505") return false; // outra requisição já claimou — silêncio, não é falha
    throw error;
  }
  return data !== null;
}

/**
 * Ponto de entrada único do ciclo automático. Chamado pela rota de polling
 * (`GET /api/sessoes/[id]/copiloto`) a cada 3s — a MAIORIA das chamadas sai
 * em `nenhum_gatilho` sem escrever nada além da leitura do gatilho (§2.3: "o
 * gatilho de IA não é temporal puro").
 *
 * `admin` é `service_role` — mesmo motivo de `POST .../sugestao` (Fatia 2):
 * a claim e o INSERT de sugestão não têm gaveta de escrita para
 * `authenticated` (RLS de 0091/0096). `supabase` (com sessão) é usado só
 * para montar contexto (mesmas policies de leitura que a Fatia 2 já usa).
 */
export async function executarCicloCopiloto(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: {
    sessaoId: string;
    blocoAtualIndice: number;
    /** Fase 12, Fatia 1 — origem do bloco atual RESOLVIDO pelo chamador
     * (`estado.ts::resolverBlocoAtual`, via `EstadoCopilotoCompleto.bloco_atual_resolvido.origem`
     * — `"fixado_manualmente"` mapeia para `"manual"` aqui; `"inferido"`/
     * `"indisponivel"` mapeiam 1:1). Repassado a `avaliarGatilho` para a
     * trava de `virada_bloco` (só conta quando `"manual"` — ver
     * `gatilho.ts`). Default `"indisponivel"` para quem ainda não migrou a
     * chamada (nunca dispara virada por omissão). */
    blocoAtualOrigem?: OrigemBlocoParaGatilho;
    agoraMs?: number;
  },
): Promise<ResultadoCiclo> {
  const agoraMs = params.agoraMs ?? Date.now();

  const { data: sessao, error: erroSessao } = await supabase
    .from("sessoes_viabilidade")
    .select("jornada_id, criado_em, realizada_em, sessoes_copiloto(estado, iniciado_em, criado_em), jornadas(pessoa_id)")
    .eq("id", params.sessaoId)
    .maybeSingle<SessaoParaCiclo>();
  if (erroSessao) throw erroSessao;
  if (!sessao) return { situacao: "sessao_nao_ativa_para_ciclo" };

  // Sessão sem copiloto iniciado (ninguém digitou nada ainda, Fatia 1) ou
  // 'encerrado'/'erro' (inclusive por duracao_maxima_minutos, checado logo
  // abaixo): silêncio. Só 'ativo' dispara ciclo — 'aguardando' é o estado
  // antes do primeiro segmento, nada para o ciclo avaliar ainda.
  if (!sessao.sessoes_copiloto || sessao.sessoes_copiloto.estado !== "ativo") {
    return { situacao: "sessao_nao_ativa_para_ciclo" };
  }

  const pessoaId = sessao.jornadas?.pessoa_id;
  if (!pessoaId) return { situacao: "sessao_nao_ativa_para_ciclo" };

  const inicioSessaoIso = sessao.sessoes_copiloto.iniciado_em ?? sessao.sessoes_copiloto.criado_em;

  // DURAÇÃO MÁXIMA (§4.4) — ANTES de avaliar gatilho: sessão esquecida
  // aberta encerra aqui e o ciclo para, sem gastar mais nenhuma consulta.
  //
  // As duas leituras abaixo (`duracaoMaximaMinutos`/`intervaloSegundos`) são
  // da MESMA tabela (`configuracoes`) e NENHUMA depende do resultado da
  // outra — Fase 11: paralelizadas com `Promise.all` (eram sequenciais).
  // `intervaloSegundos` só é USADO depois de `encerrarSePassouDoTempo`
  // decidir (a leitura antecipada não muda a ORDEM DE EFEITO: encerrar por
  // duração ainda acontece antes de avaliar o gatilho, só a leitura do valor
  // em si que deixou de esperar a leitura anterior terminar).
  const [duracaoMaximaMinutos, intervaloSegundos] = await Promise.all([
    lerConfiguracaoInt(admin, CHAVE_DURACAO_MAXIMA_MINUTOS, PADRAO_DURACAO_MAXIMA_MINUTOS),
    lerConfiguracaoInt(supabase, CHAVE_INTERVALO_SEGUNDOS, PADRAO_INTERVALO_SEGUNDOS),
  ]);

  const encerradaAgora = await encerrarSePassouDoTempo(supabase, admin, {
    sessaoId: params.sessaoId,
    jornadaId: sessao.jornada_id,
    realizadaEm: sessao.realizada_em,
    inicioSessaoIso,
    duracaoMaximaMinutos,
    agoraMs,
  });
  if (encerradaAgora) {
    return { situacao: "sessao_encerrada_por_duracao_maxima" };
  }

  const decisao = await avaliarGatilho(supabase, {
    sessaoId: params.sessaoId,
    blocoAtualIndice: params.blocoAtualIndice,
    blocoAtualOrigem: params.blocoAtualOrigem ?? "indisponivel",
    intervaloSegundos,
    agoraMs,
  });
  if (!decisao.dispara || !decisao.gatilho) {
    return { situacao: "nenhum_gatilho" };
  }

  const janela = calcularJanela(inicioSessaoIso, agoraMs, intervaloSegundos);

  const claimada = await reivindicarJanela(admin, {
    sessaoId: params.sessaoId,
    janela,
    gatilho: decisao.gatilho,
    blocoIndice: params.blocoAtualIndice,
  });
  if (!claimada) {
    // Outra aba/requisição já reivindicou esta janela — silêncio, não é erro.
    return { situacao: "janela_ja_claimada_por_outra_requisicao" };
  }

  // A PARTIR DAQUI a janela já está gravada como avaliada. Toda recusa
  // abaixo (gate/orçamento/timeout) NÃO desfaz a claim — a claim é sobre a
  // TENTATIVA, não sobre o resultado (comentário de topo da 0096).

  // GATE JURÍDICO — A CADA CICLO, SEMPRE SOZINHO E PRIMEIRO (é o ponto
  // §6.2.2 desta fatia: revogação no meio da sessão cala o PRÓXIMO ciclo, não
  // só o próximo INSERT). 🔴 NUNCA paralelizar com `montarContextoCopiloto`:
  // ela LÊ a transcrição do cliente (`contexto.ts:291-305`) — montar
  // contexto antes de saber se o gate liberou seria ler dado sob trava
  // jurídica antes da trava. É sigilo profissional, não performance.
  const gate = await conferirGateCopiloto(admin, { sessaoId: params.sessaoId, pessoaId });
  if (!gate.liberado) {
    return { situacao: "bloqueado_pelo_gate", motivo: gate.motivo ?? "falha_ao_conferir_gate" };
  }

  // Orçamento + contexto NÃO dependem um do outro — Fase 11: paralelizados
  // com `Promise.all` (eram sequenciais). Custo aceito: se o orçamento
  // estourar, o contexto foi montado à toa (no máximo 1× por sessão — o
  // orçamento raramente estoura no MEIO de uma sessão, e mesmo quando
  // estoura o desperdício é 1 leitura extra, não 1 chamada de IA).
  const [orcamento, contexto] = await Promise.all([
    conferirOrcamentoCopiloto(admin, { jornadaId: sessao.jornada_id, inicioSessaoIso, agora: agoraMs }),
    montarContextoCopiloto(supabase, params.sessaoId, params.blocoAtualIndice) as Promise<ContextoCopiloto>,
  ]);
  if (!orcamento.dentro) {
    return { situacao: "orcamento_estourado", motivo: orcamento.motivo ?? "falha_ao_contar_orcamento" };
  }

  const execucao = await executarIaCopiloto(admin, { jornadaId: sessao.jornada_id, contexto });

  if (execucao.situacao === "timeout") return { situacao: "timeout" };
  if (execucao.situacao === "indisponivel") return { situacao: "indisponivel", motivo: execucao.motivo };

  const validado = validarSugestaoCopiloto(execucao.saida, contexto);
  if (!validado.sugestao) {
    return { situacao: "conteudo_recusado" };
  }

  const confiancaMinima = await lerConfiguracaoJson<number>(supabase, CHAVE_CONFIANCA_MINIMA, PADRAO_CONFIANCA_MINIMA);
  const visivel = sugestaoEVisivel(validado.sugestao.confianca_geral, confiancaMinima);

  try {
    const { data: gravado, error: erroInsercao } = await admin
      .from("copiloto_sugestoes")
      .insert({
        sessao_id: params.sessaoId,
        // 🔴 CORRIGIDO (achado do Fable, Fase 12 Fatia 1 — defeito 1): `bloco_id`
        // grava SÓ `bloco_inferido.bloco_id` (já validado contra o roteiro
        // ativo em `validar.ts`), NUNCA `desvio_sugerido`/`contexto.bloco_atual`
        // como fallback. O fallback antigo misturava três significados
        // diferentes na MESMA coluna ("onde a IA acha que a conversa está" vs.
        // "para onde a sessão deveria ir" vs. "o índice que o CHAMADOR mandou
        // montar contexto") — e `resolverBlocoAtual` (estado.ts) não tinha como
        // distinguir um do outro na leitura, promovendo desvio/contexto a
        // "inferido" sempre que a IA devolvia `bloco_inferido: null` (o "não
        // sei" honesto que o prompt 0106 EXIGE). `null` aqui é o valor
        // correto quando a IA não infere nesta rodada — `resolverBlocoAtual`
        // trata isso como "sem inferência nesta linha", não como ausência de
        // dado a preencher por outra via.
        bloco_id: validado.sugestao.bloco_inferido?.bloco_id ?? null,
        gatilho: decisao.gatilho,
        conteudo: validado.sugestao,
        confianca: validado.sugestao.confianca_geral,
        execucao_ia_id: execucao.execucaoId,
      })
      // `ordem_evento`/`criado_em` a mais que antes (Fase 11, Tarefa 7 —
      // "eliminar o double-hop de polling"): ZERO query extra, é o MESMO
      // INSERT, só devolvendo 2 colunas a mais que já existiam na linha.
      .select("id, ordem_evento, criado_em")
      .single<{ id: string; ordem_evento: number; criado_em: string }>();
    if (erroInsercao) throw erroInsercao;

    // 17/09/2026 — mesma regra da rota sob demanda: acumula DEPOIS do INSERT
    // confirmado, sai cedo (zero query) sem item novo. Falha aqui não afeta
    // o resultado do ciclo (já foi gravado o que importa).
    await acumularInventarioNaSessao(admin, { sessaoId: params.sessaoId, itensNovos: validado.sugestao.inventario_mencionado ?? [] });

    return {
      situacao: "sugestao_gravada",
      sugestaoId: gravado.id,
      ordemEvento: gravado.ordem_evento,
      criadoEm: gravado.criado_em,
      gatilho: decisao.gatilho,
      visivel,
      sugestao: visivel ? validado.sugestao : null,
      confiancaGeral: validado.sugestao.confianca_geral,
    };
  } catch (erro) {
    // Backstop (trigger 0093) recusou apesar do gate ter liberado — não
    // deveria acontecer em uso normal (mesma nota da rota de sugestão sob
    // demanda). Registra e devolve como bloqueio, nunca 500 silencioso.
    registrarErro("copiloto/ciclo.executarCicloCopiloto", erro, { sessao_id: params.sessaoId });
    return { situacao: "bloqueado_pelo_gate", motivo: "recusado_pelo_banco" };
  }
}
