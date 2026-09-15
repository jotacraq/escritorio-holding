import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { conferirGateCopiloto } from "./gate";
import { conferirOrcamentoCopiloto } from "./orcamento";
import { montarContextoCopiloto } from "./contexto";
import { executarIaCopiloto } from "./executar-ia";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";

/**
 * WARM-UP DE CACHE (0099) — medido em produção, 1ª sessão ao vivo: a 1ª
 * chamada de IA de cada sessão ESCREVE o prompt em cache e é sistematicamente
 * mais lenta que as seguintes (9.642 ms > TIMEOUT_COPILOTO_MS = 8.000 ms,
 * contra 5.623 ms de média nas 7 chamadas seguintes, que LEEM cache). A
 * PRIMEIRA sugestão de toda sessão é descartada por timeout — a advogada não
 * vê nada logo na abertura, que é justamente quando ela mais precisa se
 * orientar.
 *
 * Este módulo dispara UMA chamada de IA "de aquecimento" no primeiro
 * segmento registrado da sessão (`POST .../copiloto/segmentos`, quando
 * `sessoes_copiloto` vira 'ativo') — o resultado é SEMPRE descartado: nunca
 * grava `copiloto_sugestoes`, nunca aparece no polling. O único efeito
 * observável é o cache do provedor ficar quente para a primeira chamada REAL
 * (o ciclo automático, ~45s depois, via `executarCicloCopiloto`).
 *
 * MESMO CAMINHO das chamadas reais — não inventa atalho:
 *   1. `warmupAtivo` — interruptor próprio (0099, nasce `true`).
 *   2. Claim atômica por `sessoes_copiloto.aquecido_em` (`update ... where
 *      aquecido_em is null`, count exact) — mesmo padrão de
 *      `reivindicarJanela` (ciclo.ts/0096): duas abas na mesma sessão não
 *      disparam dois warm-ups.
 *   3. `conferirGateCopiloto` — mesmo gate jurídico do ciclo automático e da
 *      rota sob demanda. Sem decisão/consentimento, o warm-up NÃO roda —
 *      aquecer cache não é motivo para pular a trava que existe para não
 *      mandar fala do cliente à IA sem autorização (aqui não há fala real
 *      ainda no 1º segmento, mas o contexto pode incluir o recorte do
 *      briefing — mesma regra, sem exceção por ser "só aquecimento").
 *   4. `conferirOrcamentoCopiloto` — mesmo teto de sessão/dia. Estourado, o
 *      warm-up NÃO roda: nunca fura o teto para aquecer cache.
 *   5. `montarContextoCopiloto` + `executarIaCopiloto` — o MESMO contexto e
 *      timeout (8s) do caminho real. O resultado (sucesso, timeout ou
 *      indisponível) é só logado para telemetria — nunca persiste sugestão.
 *
 * FIRE-AND-FORGET: o chamador (`POST .../copiloto/segmentos`) invoca
 * `dispararWarmupCopiloto(...)` SEM `await` — esta função nunca deve ser
 * aguardada pelo request/response da rota (runtime `nodejs` da Hostinger,
 * não serverless: o processo continua vivo depois do `return`, a Promise
 * solta termina em segundo plano). Por isso ela NUNCA lança: todo erro é
 * capturado e registrado aqui dentro — um warm-up que falha não pode
 * derrubar o POST de segmento nem aparecer como erro na tela (não há tela
 * nenhuma esperando por ele).
 *
 * 🔴 SÓ `admin` (service_role), NUNCA o cliente de sessão do usuário: este
 * módulo roda DEPOIS do `return` da rota que o disparou. O cliente de sessão
 * (`criarClienteServidor()`) é ligado a `cookies()` de `next/headers`, válido
 * só durante o ciclo de vida do request — usá-lo numa Promise que continua
 * viva depois da resposta já ter sido enviada não é garantido pelo runtime
 * do Next (App Router). RLS não é um problema aqui: toda tabela que este
 * caminho lê (`sessoes_viabilidade`, `roteiros_versoes`, `briefings`,
 * `sessoes_copiloto_segmentos`, `configuracoes`) já tem GRANT para
 * `service_role`, que ignora RLS por completo — mesma razão de
 * `executarCicloCopiloto` usar `admin` para a claim e o INSERT de sugestão.
 */

const CHAVE_WARMUP_ATIVO = "copiloto_sessao.warmup_ativo";

async function warmupAtivo(admin: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(admin, CHAVE_WARMUP_ATIVO, true);
  } catch {
    // Falha de leitura cai no PADRÃO desta chave (nasce 'true' — é
    // otimização, não risco): "não saber" aqui não é o mesmo "não saber" de
    // copilotoEstaAtivo/conferirGateCopiloto, porque o pior caso de rodar o
    // warm-up sem saber o valor real é gastar uma chamada de IA a mais,
    // dentro do MESMO gate/orçamento que já protegem qualquer chamada de IA
    // do copiloto — nunca abre superfície nova de risco jurídico ou de custo
    // sem teto.
    return true;
  }
}

/**
 * Claim atômica — mesma forma de `reivindicarJanela` (ciclo.ts): o UPDATE
 * condicional EM SI é a claim, não um SELECT seguido de escrita (que teria
 * janela de corrida entre as duas idas ao banco). `admin` (service_role):
 * mesmo motivo de `executarCicloCopiloto` — é o servidor quem decide quando
 * aquecer, nunca a tela.
 */
async function reivindicarWarmup(admin: SupabaseClient, sessaoId: string): Promise<boolean> {
  // `{ count: "exact" }` como 2º argumento de `.update()` — mesmo padrão de
  // `server/copiloto/expurgo.ts::carimbar` e de `ativarSessaoCopiloto`
  // (segmentos/route.ts): "devolve true se a linha foi carimbada AGORA".
  const { error, count } = await admin
    .from("sessoes_copiloto")
    .update({ aquecido_em: new Date().toISOString() }, { count: "exact" })
    .eq("sessao_id", sessaoId)
    .is("aquecido_em", null);

  if (error) throw error;
  return (count ?? 0) > 0; // 0 = outra requisição já reivindicou (ou a sessão não existe)
}

export interface ParamsWarmupCopiloto {
  sessaoId: string;
  jornadaId: string;
  pessoaId: string;
  /** `sessoes_copiloto.iniciado_em` (o instante REAL em que o copiloto
   * começou a ouvir, carimbado por `ativarSessaoCopiloto` no mesmo INSERT/
   * UPDATE que criou a linha) — MESMO valor que `executarCicloCopiloto`
   * usaria como início da sessão para o orçamento. Passado pelo chamador
   * porque `ativarSessaoCopiloto` já o conhece (evita uma 3ª leitura de
   * `sessoes_copiloto` só para redescobrir o que o chamador já tem em mãos).
   * NUNCA "agora": usar o instante do warm-up como piso do filtro
   * `gte(criado_em)` de `conferirOrcamentoCopiloto` zeraria a contagem
   * "na sessão" para qualquer chamada futura que reusasse esse piso errado. */
  inicioSessaoIso: string;
}

/**
 * Ponto de entrada — chamado SEM `await` pelo POST de segmento. Nunca lança:
 * toda falha (claim, gate, orçamento, montagem de contexto, chamada de IA) é
 * capturada e vira `registrarErro`, nunca propaga para o chamador.
 */
export async function dispararWarmupCopiloto(
  admin: SupabaseClient,
  params: ParamsWarmupCopiloto,
): Promise<void> {
  try {
    if (!(await warmupAtivo(admin))) return;

    const claimada = await reivindicarWarmup(admin, params.sessaoId);
    if (!claimada) return; // já aqueceu (ou outra aba já está aquecendo) — silêncio

    const gate = await conferirGateCopiloto(admin, { sessaoId: params.sessaoId, pessoaId: params.pessoaId });
    if (!gate.liberado) return; // sem decisão/consentimento — warm-up não é motivo para pular a trava

    const orcamento = await conferirOrcamentoCopiloto(admin, {
      jornadaId: params.jornadaId,
      inicioSessaoIso: params.inicioSessaoIso,
    });
    if (!orcamento.dentro) return; // teto estourado — nunca fura para aquecer cache

    const contexto = await montarContextoCopiloto(admin, params.sessaoId, 0);
    // 🔴 abortarNoTimeout: false — Fase 11 abriu `executar-ia.ts` para abortar
    // de verdade a chamada em voo depois de 8s (economiza tokens/orçamento no
    // caminho REAL do ciclo automático), mas o warm-up é o ÚNICO caminho que
    // NÃO PODE herdar isso: o cache do provedor só é escrito se o voo
    // terminar (comentário de topo deste arquivo, §145-151 do original) —
    // abortar aqui mataria a otimização inteira desta migration 0101, e o
    // sintoma ("a 1ª sugestão da sessão voltou a sumir") apareceria semanas
    // depois sem ninguém ligar as duas coisas. Teste obrigatório em
    // warmup.test.ts prova que este `false` nunca é removido por engano.
    const execucao = await executarIaCopiloto(admin, { jornadaId: params.jornadaId, contexto, abortarNoTimeout: false });

    // Resultado SEMPRE descartado — o único efeito que importa (o cache do
    // provedor) já aconteceu no momento em que `executarIaCopiloto` retornou
    // (sucesso OU timeout local: o comentário de `executar-ia.ts` explica que
    // a chamada real segue em voo e grava `execucoes_ia` mesmo depois do
    // timeout de 8s — o cache é escrito pelo PROVEDOR nesse voo, não por nós
    // aqui). Nunca um INSERT em `copiloto_sugestoes`, nunca um retorno que a
    // rota HTTP possa expor.
    if (execucao.situacao === "ok" || execucao.situacao === "timeout") {
      // Telemetria de sucesso: nem erro, nem dado sensível — só o fato de o
      // aquecimento ter sido tentado com êxito de disparo.
      return;
    }
    // "indisponivel" (prompt inativo, recusa do modelo, saída fora do schema)
    // já é registrado dentro de `executarIaCopiloto` quando não é o caso
    // esperado de `prompt_ativo_nao_encontrado` — nada a fazer aqui.
  } catch (erro) {
    // Falha em silêncio (requisito duro): warm-up nunca derruba o POST que o
    // disparou nem vira erro de tela — não há tela nenhuma esperando por ele.
    registrarErro("copiloto/warmup.dispararWarmupCopiloto", erro, { sessao_id: params.sessaoId });
  }
}
