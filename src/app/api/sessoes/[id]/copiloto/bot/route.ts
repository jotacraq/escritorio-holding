export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { copilotoEstaAtivo, audioAoVivoEstaAtivo, provedorAudioConfigurado, PROVEDOR_AUDIO_RECALL } from "@/server/copiloto/config";
import { conferirGateCopiloto } from "@/server/copiloto/gate";
import {
  pedirBot,
  montarWebhookUrlComSegredo,
  copilotoWebhookConfigurado,
  recallConfigurado,
  encerrarBotComRetentativa,
} from "@/server/copiloto/recall";
import { lerConfiguracaoInt } from "@/server/ia/configuracao";

const ParametroSchema = z.object({ id: z.string().uuid() });

const NOME_BOT = "Assistente — Escritório Elaine Montenegro"; // B72, conferido na sonda (11/09)

const CHAVE_RETENCAO_DIAS_SEGMENTOS = "copiloto_sessao.retencao_dias_segmentos";
const PADRAO_RETENCAO_DIAS = 7;

// §4.2.2: nunca os defaults do fornecedor (20min de espera, 1h de silêncio
// são tempo cobrado). Valores próprios, fixos — não derivados de
// `duracao_maxima_minutos` nesta entrega (a duração da SESSÃO e o tempo que
// o bot tolera sala vazia/silenciosa são conceitos diferentes; usar o mesmo
// número inflaria o timeout de silêncio para 150min, o oposto do que a
// errata pede). `A MEDIR`: se a bancada mostrar que estes valores cortam
// sessões reais cedo demais, ajustar aqui — não são lidos de configuração
// nesta entrega porque `configuracoes` ainda não tem chave própria para eles
// (criar chave sem decisão de negócio por trás é configuração de fachada,
// mesmo raciocínio já registrado em `config.ts::derivarSemFocoMs`).
const AUTOMATIC_LEAVE_PADRAO = {
  waitingRoomTimeoutS: 300, // 5 min de sala de espera, não 20
  noOneJoinedTimeoutS: 300, // 5 min sem ninguém entrar, não 20
  silenceDetectionS: 900, // 15 min de silêncio, não 60
};

interface SessaoParaBot {
  id: string;
  jornada_id: string;
  link_sala: string | null;
  jornadas: { pessoa_id: string } | null;
  sessoes_copiloto: { estado: string; gravacao_externa_id: string | null } | null;
}

const MENSAGEM_GATE: Record<string, string> = {
  sem_decisao_juridica: "Sem decisão jurídica ativa para o copiloto ao vivo (escopo sessao.copiloto_ao_vivo).",
  sem_consentimento_titular: "O titular ainda não consentiu com o copiloto ao vivo (copiloto_sessao_ao_vivo).",
  falha_ao_conferir_gate: "Não foi possível conferir a autorização do copiloto ao vivo.",
};

/** Estado esperado do participante bot na sala — mensagem literal usada
 * tanto no 409 de retenção quanto na pendência de `vw_pendencias_sistema`
 * (0097), para a instrução operacional nunca divergir entre os dois lugares. */
const NOME_BOT_PARA_REMOCAO_MANUAL = `"${NOME_BOT}"`;

/**
 * POST /api/sessoes/[id]/copiloto/bot — Fase 10, Fatia 4a/4b
 * (docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2, §6.2.2, §8, §12).
 * Pede o bot do Recall.ai para a sala da sessão.
 *
 * 🔴 ORDEM, cada trava com código estável de recusa (nunca 500 no caso
 * esperado) — a ordem importa e é a errata §6.2.2 aplicada ao PEDIDO do bot,
 * não ao primeiro segmento que voltar dele:
 *
 *  1. `exigirVePatrimonio()`.
 *  2. `copiloto_sessao.ativo=false` → 409 `copiloto_desligado` (kill-switch
 *     de sempre).
 *  3. Sessão inexistente → 404. Sem `link_sala` → 409 `sem_link_sala`.
 *  4. 🔴 CORREÇÃO (item menor do Fable, revisão de Solidificação): sessão
 *     `sessoes_copiloto.estado` em `'encerrado'`/`'erro'` → 409
 *     `sessao_ja_encerrada`. Antes desta correção, a rota LIA `estado` mas
 *     nunca conferia — pedir um bot para uma sessão já encerrada (transcrição
 *     já consolidada, Fatia 3) passava, criando um bot numa sessão que
 *     ninguém mais vai olhar.
 *  5. **Gate jurídico** (`conferirGateCopiloto`) → 409
 *     `copiloto_ao_vivo_bloqueado`, **SEM chamar o Recall**. Pedir o bot é o
 *     instante em que a sala passa a ser gravada por terceiro — o áudio sai
 *     ANTES de qualquer INSERT nosso (§6.2.2). A trigger
 *     `trg_copiloto_exige_decisao_bot_pedido` (0093) sobre
 *     `gravacao_externa_id` continua como BACKSTOP; esta é a trava PRIMÁRIA.
 *  6. `copiloto_sessao.audio_ao_vivo=false` → 409 `audio_ao_vivo_desligado`.
 *     Default é `false` (0091) — é assim que a fatia sobe: com a chave nesse
 *     valor, nenhum fetch ao Recall acontece, mesmo com tudo o mais pronto.
 *  7. `copiloto_sessao.provedor_audio !== 'recall'` → 409
 *     `provedor_audio_nao_configurado`. Default `'nenhum'` (B75) — nenhum
 *     fornecedor entra em produção antes da Dra. Elaine decidir com o fato
 *     da transferência internacional na mão.
 *  8. `RECALL_API_KEY`/`COPILOTO_WEBHOOK_SECRET` ausentes → 503
 *     `servico_indisponivel` (mesmo fail-closed dos outros 4 webhooks/integrações).
 *  9. Sessão já tem bot pedido (`gravacao_externa_id` preenchido) → 409
 *     `bot_ja_pedido`, idempotente — não pede um 2º bot para a mesma sessão.
 * 10. `pedirBot()`, com `retention` explícito (§4.2.1). Resposta com
 *     `sala_invalida` → 409 `sala_invalida`, com o `sub_code` do fornecedor
 *     no corpo (nunca "erro ao iniciar" genérico — §4.2.2). Resposta com
 *     `retencao_infinita_detectada` → 409, com MENSAGEM CONDICIONAL AO
 *     RESULTADO REAL do encerramento (achado 4 do Fable, ver bloco abaixo).
 * 11. Sucesso: grava `gravacao_externa_id` — 🔴 CORREÇÃO (achado 3 do
 *     Fable): o `upsert` agora CHECA `error`. Antes, um `upsert` cego podia
 *     devolver 201 com o bot dentro da sala e o vínculo NÃO persistido — o
 *     webhook nunca resolveria a sessão (fala vira pendência muda) e o
 *     encerramento nunca acharia o `gravacao_externa_id` (bot gravando e
 *     cobrando, invisível). Em falha: `encerrarBotComRetentativa()`
 *     IMEDIATO + erro real ao cliente (nunca 201) + `registrarErro`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }

    const { data: sessao, error: erroSessao } = await supabase
      .from("sessoes_viabilidade")
      .select("id, jornada_id, link_sala, jornadas(pessoa_id), sessoes_copiloto(estado, gravacao_externa_id)")
      .eq("id", sessaoId)
      .maybeSingle<SessaoParaBot>();
    if (erroSessao) throw erroSessao;
    if (!sessao) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

    const pessoaId = sessao.jornadas?.pessoa_id;
    if (!pessoaId) throw erroNaoEncontrado("Sessão de Viabilidade sem jornada/pessoa vinculada.");

    if (!sessao.link_sala) {
      throw erroConflito("sem_link_sala", "A sessão não tem link de sala cadastrado — cole o link na Ficha antes de pedir o bot.");
    }

    // 🔴 CORREÇÃO (item menor do Fable): sessão já encerrada/em erro não
    // pede bot — a transcrição já foi consolidada (Fatia 3) ou o estado já
    // é um problema conhecido.
    const estadoAtual = sessao.sessoes_copiloto?.estado;
    if (estadoAtual === "encerrado" || estadoAtual === "erro") {
      throw erroConflito("sessao_ja_encerrada", "Esta sessão do copiloto já está encerrada — não é possível pedir um bot para ela.");
    }

    const admin = criarClienteAdmin();

    // GATE JURÍDICO — ANTES de chamar o Recall (§6.2.2, achado do coordenador).
    // Pedir o bot É o caminho de saída de dado: o áudio sai da sala no
    // instante em que o bot entra, antes de qualquer INSERT nosso.
    const gate = await conferirGateCopiloto(admin, { sessaoId, pessoaId });
    if (!gate.liberado) {
      throw erroConflito("copiloto_ao_vivo_bloqueado", MENSAGEM_GATE[gate.motivo ?? "falha_ao_conferir_gate"]);
    }

    if (!(await audioAoVivoEstaAtivo(supabase))) {
      throw erroConflito(
        "audio_ao_vivo_desligado",
        "O bot na sala está desligado (copiloto_sessao.audio_ao_vivo = false em Admin). O copiloto continua funcionando no modo digitado.",
      );
    }

    const provedor = await provedorAudioConfigurado(supabase);
    if (provedor !== PROVEDOR_AUDIO_RECALL) {
      throw erroConflito(
        "provedor_audio_nao_configurado",
        `Nenhum provedor de áudio contratado (copiloto_sessao.provedor_audio = "${provedor ?? "nenhum"}").`,
      );
    }

    if (!recallConfigurado() || !copilotoWebhookConfigurado()) {
      registrarErro("POST /api/sessoes/[id]/copiloto/bot", new Error("RECALL_API_KEY e/ou COPILOTO_WEBHOOK_SECRET ausentes"));
      throw new ErroApi(503, "servico_indisponivel", "O provedor de bot não está configurado no servidor.");
    }

    if (sessao.sessoes_copiloto?.gravacao_externa_id) {
      // Idempotente: clicar "Pedir bot" duas vezes não pede um 2º bot.
      throw erroConflito("bot_ja_pedido", "Já existe um bot pedido para esta sessão.", {
        gravacao_externa_id: sessao.sessoes_copiloto.gravacao_externa_id,
      });
    }

    const webhookUrl = montarWebhookUrlComSegredo();
    if (!webhookUrl) {
      // Defesa em profundidade: `copilotoWebhookConfigurado()` já confere
      // isso acima; se a env sumir ENTRE as duas checagens (corrida de
      // deploy improvável), ainda cai aqui em vez de mandar `webhookUrl`
      // undefined ao Recall.
      throw new ErroApi(503, "servico_indisponivel", "O segredo do webhook do copiloto não está configurado no servidor.");
    }

    const retencaoDias = await lerConfiguracaoInt(supabase, CHAVE_RETENCAO_DIAS_SEGMENTOS, PADRAO_RETENCAO_DIAS);

    const resultado = await pedirBot({
      sessaoId,
      linkSala: sessao.link_sala,
      nomeBot: NOME_BOT,
      webhookUrl,
      // §4.2.1 — SEMPRE explícito. `retencaoDias` vem de configuração
      // (`copiloto_sessao.retencao_dias_segmentos`, hoje sobre os SEGMENTOS
      // no NOSSO banco, B69) — reusado aqui como teto de retenção no
      // FORNECEDOR também, na ausência de uma chave própria para isso (B76
      // aberto: "valor inicial proposto: o menor que o fornecedor aceitar").
      //
      // 🔴 MEDIDO CONTRA A API VIVA (17/09/2026), resolvendo o `A MEDIR` que
      // estava aqui: `retention_days` NÃO existe. A API responde
      // `{"retention":{"type":["\"days\" is not a valid choice."]}}` e o
      // pedido inteiro falha com 400 — ou seja, o botão "Convidar o bot"
      // estava quebrado em produção para QUALQUER sala. O formato é `timed`
      // com `hours`; 168h (7 dias) é o teto gratuito do fornecedor.
      retention: { type: "timed", hours: Math.max(1, retencaoDias) * 24 },
      automaticLeave: {
        waitingRoomTimeoutS: AUTOMATIC_LEAVE_PADRAO.waitingRoomTimeoutS,
        noOneJoinedTimeoutS: AUTOMATIC_LEAVE_PADRAO.noOneJoinedTimeoutS,
        silenceDetectionS: AUTOMATIC_LEAVE_PADRAO.silenceDetectionS,
      },
      // B72 — o nome do NOSSO bot nunca entra na lista de matches.
      botDetectionMatches: ["Notetaker", "Otter.ai", "Fireflies.ai", "Read AI", "tl;dv"],
    });

    if (resultado.situacao === "nao_configurado") {
      throw new ErroApi(503, "servico_indisponivel", "O provedor de bot não está configurado no servidor.");
    }
    if (resultado.situacao === "falha_provedor") {
      throw new ErroApi(502, "falha_provedor_bot", "O provedor do bot não respondeu como esperado.");
    }
    if (resultado.situacao === "sala_invalida") {
      // 🔴 §4.2.2/§8: o sub_code TEM de chegar ao corpo da resposta — link de
      // sala errado é o defeito mais provável em produção.
      throw erroConflito("sala_invalida", "Não foi possível entrar na sala — o link pode estar errado ou a reunião não existe.", {
        codigo: resultado.codigo,
        sub_codigo: resultado.subCodigo,
      });
    }
    if (resultado.situacao === "retencao_infinita_detectada") {
      // 🔴 CORREÇÃO (achado 4 do Fable, B76): a mensagem é CONDICIONAL ao
      // resultado REAL do encerramento — antes desta correção, o 409
      // afirmava "o bot foi encerrado e nenhum segmento foi gravado" mesmo
      // quando `encerrarBot` tinha FALHADO. Isso é falso quanto ao
      // encerramento e ao áudio no fornecedor: o bot pode seguir gravando a
      // sessão inteira com retenção indefinida, na sala real, enquanto a
      // tela diz que está tudo resolvido.
      if (!resultado.encerramentoConfirmado) {
        // Pendência OPERACIONAL VISÍVEL (0097/vw_pendencias_sistema) — não
        // só stdout. `registrarErro` já foi chamado dentro de
        // `encerrarBotComRetentativa`; aqui gravamos o FATO OPERACIONAL.
        await admin
          .from("sessoes_copiloto")
          .upsert(
            {
              sessao_id: sessaoId,
              // 🔴 CORREÇÃO (achado do Fable, "o ciclo da pendência fechou
              // para 1 dos 3 nascedouros"): grava `gravacao_externa_id`
              // JUNTO com a pendência — sem isto o retry
              // (`tentarNovamenteEncerrarBotPendente`) nunca acharia o bot
              // para tentar de novo, e a sessão ficava BRICADA (nem bot
              // novo, nem encerramento formal, nem limpeza). É fato
              // verdadeiro: o bot existe e é desta sessão — o gate jurídico
              // já foi conferido no PEDIDO do bot (§6.2.2), antes desta
              // linha rodar.
              estado: "erro",
              gravacao_externa_id: resultado.botId,
              pendencia_encerramento_bot:
                `O bot foi criado com retenção indefinida (retention: forever) e o servidor NÃO CONSEGUIU tirá-lo da sala ` +
                `após 2 tentativas (bot_id: ${resultado.botId}).`,
              pendencia_encerramento_bot_em: new Date().toISOString(),
            },
            { onConflict: "sessao_id" },
          );
        throw erroConflito(
          "retencao_infinita_detectada",
          `O fornecedor devolveu retenção indefinida e NÃO FOI POSSÍVEL ENCERRAR O BOT — ele pode continuar gravando na sala. ` +
            `Encerre a reunião agora ou remova manualmente o participante ${NOME_BOT_PARA_REMOCAO_MANUAL} da sala.`,
        );
      }
      throw erroConflito(
        "retencao_infinita_detectada",
        "O fornecedor devolveu retenção indefinida apesar do pedido explícito — o bot foi encerrado e nenhum segmento foi gravado.",
      );
    }

    // resultado.situacao === "criado" — 🔴 CORREÇÃO (achado 3 do Fable): o
    // upsert AGORA CHECA `error`. Antes, uma falha aqui devolvia 201 com o
    // bot DENTRO DA SALA e o vínculo NÃO persistido: o webhook nunca
    // resolveria a sessão (`resolverSessaoPorBotId` sempre `null`, fala vira
    // pendência muda) e o encerramento nunca acharia `gravacao_externa_id`
    // (bot gravando e cobrando, invisível para o sistema). E se o backstop
    // da 0093 disparasse aqui (revogação de gate entre a checagem e este
    // upsert), o erro era ENGOLIDO e o 201 saía mesmo assim — o backstop
    // virava decoração.
    const { error: erroUpsert } = await admin
      .from("sessoes_copiloto")
      .upsert({ sessao_id: sessaoId, gravacao_externa_id: resultado.botId, provedor: PROVEDOR_AUDIO_RECALL }, { onConflict: "sessao_id" });

    if (erroUpsert) {
      // Falha ao persistir o vínculo com um bot que JÁ ESTÁ na sala real —
      // encerra IMEDIATAMENTE (nunca deixa um bot órfão gravando) e devolve
      // erro REAL ao cliente, nunca 201.
      const encerramento = await encerrarBotComRetentativa(resultado.botId);
      registrarErro("POST /api/sessoes/[id]/copiloto/bot#upsert_gravacao_externa_id", erroUpsert, {
        sessao_id: sessaoId,
        bot_id: resultado.botId,
        encerramento_confirmado: encerramento.sucesso,
      });
      if (!encerramento.sucesso) {
        // Nem persistiu o vínculo NEM conseguiu encerrar — pior caso: bot
        // órfão E gravando. Pendência visível, não só stdout.
        await admin.from("sessoes_copiloto").upsert(
          {
            sessao_id: sessaoId,
            // 🔴 CORREÇÃO (mesmo achado do bloco acima): `gravacao_externa_id`
            // gravado junto — este é o 2º dos 2 nascedouros da rota do bot.
            // O UPSERT original de `gravacao_externa_id` FALHOU (é por isso
            // que estamos neste ramo), então esta é a PRIMEIRA vez que o
            // vínculo é persistido de verdade.
            estado: "erro",
            gravacao_externa_id: resultado.botId,
            pendencia_encerramento_bot:
              `O bot foi criado (bot_id: ${resultado.botId}) mas o vínculo com a sessão falhou ao gravar E o servidor NÃO CONSEGUIU ` +
              `encerrá-lo após 2 tentativas — ele pode continuar gravando na sala, órfão de qualquer sessão.`,
            pendencia_encerramento_bot_em: new Date().toISOString(),
          },
          { onConflict: "sessao_id" },
        );
      }
      // 🔴 CORREÇÃO (item menor do Fable): mensagem CONDICIONAL ao resultado
      // REAL de `encerramento.sucesso` — antes afirmava incondicionalmente
      // "o bot foi encerrado por segurança", o que era FALSO exatamente no
      // sub-ramo em que a pendência acima é gravada.
      throw new ErroApi(
        500,
        "falha_ao_persistir_vinculo_bot",
        encerramento.sucesso
          ? "O bot foi criado, mas não foi possível registrar o vínculo com a sessão. O bot foi encerrado por segurança. Tente novamente."
          : "O bot foi criado, mas não foi possível registrar o vínculo com a sessão, E o servidor NÃO CONSEGUIU encerrar o bot — ele pode continuar gravando na sala, órfão de qualquer sessão. Remova manualmente o participante \"Assistente — Escritório Elaine Montenegro\" da sala.",
      );
    }

    return NextResponse.json({ sessao_id: sessaoId, bot_id: resultado.botId }, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/bot", erro);
  }
}
