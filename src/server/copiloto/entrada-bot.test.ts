import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarSegmentoDoBot, registrarEventoParticipante } from "./entrada-bot";

/**
 * O EFEITO de cada evento do bot — Fase 10, Fatia 4b (§4.2, §6.2). Foco do
 * aceite aqui:
 *   1. vínculo pelo `gravacao_externa_id` (botId), nunca por um `sessao_id`
 *      que o chamador poderia ter injetado;
 *   2. 🔴 achados 1 e 2 do Fable (revisão de Solidificação): `ordem` NUNCA
 *      mais estoura `int4` (não depende mais de `Date.now()`/`start_timestamp`)
 *      e colisão NUNCA mais engole fala com conteúdo diferente (retentativa
 *      recalcula `max(ordem)+1`, nunca "já existia").
 */

type Resultado = { data: unknown; error: unknown };

/* eslint-disable @typescript-eslint/no-explicit-any -- mock de builder encadeável do supabase-js */
/** Builder mínimo, encadeável. Para `sessoes_copiloto_segmentos`, o SELECT
 * (leitura de `max(ordem)`) e o INSERT são distinguidos por `respostasInsert`
 * ser uma FILA (uma resposta por tentativa) — necessário porque o novo
 * `registrarSegmentoDoBot` faz até `MAX_TENTATIVAS_ORDEM` ciclos
 * select→insert dentro da MESMA chamada. */
function consultaFalsaFixa(resultadoFinal: Resultado): any {
  const consulta: any = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.order = () => consulta;
  consulta.limit = () => consulta;
  consulta.update = () => consulta;
  consulta.maybeSingle = async () => resultadoFinal;
  consulta.single = async () => resultadoFinal;
  return consulta;
}

/** Segmentos: 1 builder NOVO por chamada de `.from(...)` (`registrarSegmentoDoBot`
 * chama `.from("sessoes_copiloto_segmentos")` DUAS vezes por tentativa — uma
 * para o SELECT de `max(ordem)`, outra para o INSERT — e o loop de
 * retentativa chama `.from()` de novo a cada volta). O índice da fila de
 * INSERT por isso precisa viver FORA do builder, compartilhado entre todas
 * as chamadas de `.from()` desta mesma sessão de teste. */
function tabelaSegmentosFalsa(ultimoOrdemResultado: Resultado, filaInsert: Resultado[], estadoFila: { indice: number }): any {
  const consulta: any = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.order = () => consulta;
  consulta.limit = () => consulta;
  consulta.maybeSingle = async () => ultimoOrdemResultado; // SELECT max(ordem)
  consulta.insert = () => consulta;
  consulta.single = async () => {
    const resultado = filaInsert[estadoFila.indice] ?? filaInsert[filaInsert.length - 1];
    estadoFila.indice += 1;
    return resultado;
  };
  return consulta;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function clienteFalso(respostas: {
  sessaoLookup?: Resultado;
  participantesLookup?: Resultado;
  ultimoOrdem?: Resultado;
  filaInsertSegmento?: Resultado[];
  /** `configuracoes` — leitura de `copiloto_sessao.papeis_de_fala`. Ausente = comportamento
   * padrão de `lerConfiguracaoBool` (chave não encontrada → cai no default `true` passado
   * pelo chamador, ver `entrada-bot.ts::papeisDeFalaEstaoAtivos`). */
  configPapeisDeFala?: Resultado;
  /** `sessoes_viabilidade` — embed `jornadas(briefings(conteudo, atual))`, usado só quando
   * papéis de fala estão ativos e o evento é `join`. */
  briefingLookup?: Resultado;
  /** RPC `registrar_participantes_copiloto` (0105, CAS) — FILA de respostas, uma por
   * tentativa (o CAS pode perder e retentar). Cada item é `{ aplicado, participantes }`;
   * default: sucesso na 1ª tentativa, devolvendo o que foi enviado como `p_participantes_novos`. */
  filaCasParticipantes?: Array<{ aplicado: boolean; participantes: unknown }>;
  /** Espião da RPC `registrar_participantes_copiloto` — chamado com os argumentos exatos
   * (`p_participantes_novos` é o array MERGEADO, o que os testes de papel conferem). */
  onRpcParticipantes?: (args: { p_sessao_id: string; p_participantes_esperados: unknown; p_participantes_novos: unknown }) => void;
}): SupabaseClient {
  let chamadasSessoesCopiloto = 0;
  const estadoFilaInsert = { indice: 0 };
  const estadoFilaCas = { indice: 0 };
  const from = vi.fn((tabela: string) => {
    if (tabela === "sessoes_copiloto") {
      chamadasSessoesCopiloto += 1;
      // 1ª consulta em qualquer efeito é sempre `resolverSessaoPorBotId`
      // (select sessao_id); a 2ª (leitura de `participantes`) é a ÚNICA —
      // a escrita agora é `.rpc(...)`, não mais `.from("sessoes_copiloto").update(...)`.
      if (chamadasSessoesCopiloto === 1) {
        return consultaFalsaFixa(respostas.sessaoLookup ?? { data: null, error: null });
      }
      return consultaFalsaFixa(respostas.participantesLookup ?? { data: null, error: null });
    }
    if (tabela === "sessoes_copiloto_segmentos") {
      return tabelaSegmentosFalsa(
        respostas.ultimoOrdem ?? { data: null, error: null },
        respostas.filaInsertSegmento ?? [{ data: { id: "seg-1" }, error: null }],
        estadoFilaInsert,
      );
    }
    if (tabela === "configuracoes") {
      return consultaFalsaFixa(respostas.configPapeisDeFala ?? { data: null, error: null });
    }
    if (tabela === "sessoes_viabilidade") {
      return consultaFalsaFixa(respostas.briefingLookup ?? { data: null, error: null });
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });
  const rpc = vi.fn((nome: string, args: Record<string, unknown>) => {
    if (nome !== "registrar_participantes_copiloto") throw new Error(`rpc inesperada no mock: ${nome}`);
    respostas.onRpcParticipantes?.(args as { p_sessao_id: string; p_participantes_esperados: unknown; p_participantes_novos: unknown });
    const fila = respostas.filaCasParticipantes ?? [{ aplicado: true, participantes: args.p_participantes_novos }];
    const resultado = fila[estadoFilaCas.indice] ?? fila[fila.length - 1]!;
    estadoFilaCas.indice += 1;
    return Promise.resolve({ data: [resultado], error: null });
  });
  return { from, rpc } as unknown as SupabaseClient;
}

describe("registrarSegmentoDoBot — vínculo pelo botId (§4.2/§6.2)", () => {
  it("bot sem sessão vinculada devolve sessao_nao_encontrada, sem tentar inserir", async () => {
    const admin = clienteFalso({ sessaoLookup: { data: null, error: null } });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_orfao",
      texto: "fala de teste",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    expect(resultado).toEqual({ situacao: "sessao_nao_encontrada" });
  });

  it("bot com sessão vinculada grava o segmento na SESSÃO RESOLVIDA pelo botId, ordem = max+1", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 41 }, error: null },
      filaInsertSegmento: [{ data: { id: "seg-99" }, error: null }],
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "isso é uma fala",
      falante: "cliente",
      falanteConfianca: null,
      iniciadoMs: 1000,
    });
    expect(resultado).toEqual({ situacao: "gravado", segmentoId: "seg-99" });
  });

  it("primeiro segmento da sessão (nenhum anterior): ordem = 1", async () => {
    const filaInsert: Resultado[] = [{ data: { id: "seg-1" }, error: null }];
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: null, error: null },
      filaInsertSegmento: filaInsert,
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "primeira fala",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    expect(resultado).toEqual({ situacao: "gravado", segmentoId: "seg-1" });
  });

  it("texto vazio (silêncio transcrito) não é erro — sem_efeito, sem tentar inserir, sem consumir ordem", async () => {
    const admin = clienteFalso({ sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null } });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "   ",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    expect(resultado).toEqual({ situacao: "sem_efeito" });
  });

  // 🔴 Aceite explícito do Fable: "teste com payload transcript-sem-words" —
  // a extração do texto acontece na ROTA (route.ts::extrairTextoTranscript),
  // este teste prova o lado de cá: `registrarSegmentoDoBot` nunca depende de
  // `words`/`start_timestamp` para calcular `ordem` — só recebe `texto` já
  // extraído e `iniciadoMs` (pode vir `null`).
  it("payload sem start_timestamp (iniciadoMs null) grava normalmente, ordem vem de max(ordem)+1", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 5 }, error: null },
      filaInsertSegmento: [{ data: { id: "seg-6" }, error: null }],
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "transcript preenchido, sem words, sem start_timestamp",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null, // formato do Recall não sondado — nunca impede a gravação
    });
    expect(resultado).toEqual({ situacao: "gravado", segmentoId: "seg-6" });
  });

  // 🔴 Aceite explícito do Fable: "colisão com conteúdo diferente entra com
  // a ordem seguinte, não é engolida" — a 1ª tentativa colide (23505,
  // corrida), a 2ª (recalculando max+1) tem sucesso.
  it("colisão de ordem (23505, corrida) RETENTA com a próxima ordem — NUNCA engole a fala", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 10 }, error: null },
      filaInsertSegmento: [
        { data: null, error: { code: "23505" } }, // 1ª tentativa: corrida
        { data: { id: "seg-12" }, error: null }, // 2ª tentativa: sucesso
      ],
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "fala com conteúdo diferente, NÃO pode sumir",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    // GRAVADO, não "já existia"/silêncio — a fala entrou com outra ordem.
    expect(resultado).toEqual({ situacao: "gravado", segmentoId: "seg-12" });
  });

  it("colisão persistente esgota as tentativas e LANÇA (nunca finge sucesso)", async () => {
    const filaSempreColide: Resultado[] = new Array(10).fill({ data: null, error: { code: "23505" } });
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 1 }, error: null },
      filaInsertSegmento: filaSempreColide,
    });
    await expect(
      registrarSegmentoDoBot(admin, {
        botId: "bot_valido",
        texto: "fala que nunca consegue gravar",
        falante: null,
        falanteConfianca: null,
        iniciadoMs: null,
      }),
    ).rejects.toThrow("falha_ao_persistir_segmento_bot_apos_retentativas");
  });

  it("erro de INSERT que não é colisão (ex.: conexão perdida) PROPAGA, nunca é engolido", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 1 }, error: null },
      filaInsertSegmento: [{ data: null, error: { code: "08006", message: "conexão perdida" } }],
    });
    await expect(
      registrarSegmentoDoBot(admin, {
        botId: "bot_valido",
        texto: "fala qualquer",
        falante: null,
        falanteConfianca: null,
        iniciadoMs: null,
      }),
    ).rejects.toBeDefined();
  });

  // 🔴 Achado do coordenador — "o webhook do bot continua entrando: a porta
  // dos fundos". Cenário NORMAL, não anômalo: última fala em trânsito entre
  // `marcarEncerrada` e o bot sair da sala de verdade — o webhook chega
  // DEPOIS de `transcricao_id` já preenchido (a consolidação já rodou).
  it("🔴 sessão JÁ CONSOLIDADA (transcricao_id preenchido): sessao_ja_consolidada, NUNCA insere segmento órfão", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: "transcricao-1" }, error: null },
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "fala que chegou tarde demais",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    expect(resultado).toEqual({ situacao: "sessao_ja_consolidada" });
  });

  it("sessão SEM transcricao_id (não consolidada — caso comum): grava normalmente", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      ultimoOrdem: { data: { ordem: 3 }, error: null },
      filaInsertSegmento: [{ data: { id: "seg-4" }, error: null }],
    });
    const resultado = await registrarSegmentoDoBot(admin, {
      botId: "bot_valido",
      texto: "fala normal, sessão ainda ativa",
      falante: null,
      falanteConfianca: null,
      iniciadoMs: null,
    });
    expect(resultado).toEqual({ situacao: "gravado", segmentoId: "seg-4" });
  });
});

describe("registrarEventoParticipante — vínculo pelo botId", () => {
  it("bot sem sessão vinculada devolve sessao_nao_encontrada", async () => {
    const admin = clienteFalso({ sessaoLookup: { data: null, error: null } });
    const resultado = await registrarEventoParticipante(admin, {
      botId: "bot_orfao",
      tipo: "join",
      nomeParticipante: "Terezinha",
      idParticipante: null,
      isHost: false,
      quando: "2026-09-11T10:00:00Z",
    });
    expect(resultado).toEqual({ situacao: "sessao_nao_encontrada" });
  });

  it("join com sessão vinculada grava participantes (papéis de fala desligados — nasce papel null)", async () => {
    const admin = clienteFalso({
      sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
      participantesLookup: { data: { participantes: [] }, error: null },
      configPapeisDeFala: { data: { valor: false }, error: null },
    });
    const resultado = await registrarEventoParticipante(admin, {
      botId: "bot_valido",
      tipo: "join",
      nomeParticipante: "Terezinha",
      idParticipante: null,
      isHost: false,
      quando: "2026-09-11T10:00:00Z",
    });
    expect(resultado).toEqual({ situacao: "gravado" });
  });

  it("leave nunca consulta configuracoes/briefing — papel só é resolvido no join", async () => {
    const configSpy = vi.fn();
    const admin = {
      from: vi.fn((tabela: string) => {
        if (tabela === "sessoes_copiloto") {
          const chamada = (admin.from as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "sessoes_copiloto").length;
          if (chamada === 1) return consultaFalsaFixa({ data: { sessao_id: "sessao-real", transcricao_id: null }, error: null });
          return consultaFalsaFixa({
            data: { participantes: [{ id: null, nome: "Terezinha", entrou_em: "10:00", saiu_em: null, papel: null }] },
            error: null,
          });
        }
        if (tabela === "configuracoes") configSpy();
        throw new Error(`tabela inesperada no leave: ${tabela}`);
      }),
      rpc: vi.fn((nome: string, args: Record<string, unknown>) =>
        Promise.resolve({ data: [{ aplicado: true, participantes: args.p_participantes_novos }], error: null }),
      ),
    } as unknown as SupabaseClient;

    const resultado = await registrarEventoParticipante(admin, {
      botId: "bot_valido",
      tipo: "leave",
      nomeParticipante: "Terezinha",
      idParticipante: null,
      isHost: false,
      quando: "10:05",
    });
    expect(resultado).toEqual({ situacao: "gravado" });
    expect(configSpy).not.toHaveBeenCalled();
  });

  describe("🔴 papéis de fala (15/09/2026) — resolvidos no join quando o interruptor está ligado", () => {
    it("host vira 'advogada' quando o interruptor está ligado (default true)", async () => {
      let capturado: unknown = null;
      const admin = clienteFalso({
        sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
        participantesLookup: { data: { participantes: [] }, error: null },
        // configuracoes ausente → cai no default `true` (papéis de fala nasce ligado).
        briefingLookup: { data: { jornadas: { briefings: [] } }, error: null },
        onRpcParticipantes: (args) => {
          capturado = { participantes: args.p_participantes_novos };
        },
      });

      const resultado = await registrarEventoParticipante(admin, {
        botId: "bot_valido",
        tipo: "join",
        nomeParticipante: "Dra. Elaine",
        idParticipante: "p1",
        isHost: true,
        quando: "10:00",
      });
      expect(resultado).toEqual({ situacao: "gravado" });
      const participantesGravados = (capturado as { participantes: Array<{ papel: string | null }> }).participantes;
      expect(participantesGravados[0]!.papel).toBe("advogada");
    });

    it("interruptor desligado: join grava papel null mesmo sendo host", async () => {
      let capturado: unknown = null;
      const admin = clienteFalso({
        sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
        participantesLookup: { data: { participantes: [] }, error: null },
        configPapeisDeFala: { data: { valor: false }, error: null },
        onRpcParticipantes: (args) => {
          capturado = { participantes: args.p_participantes_novos };
        },
      });

      await registrarEventoParticipante(admin, {
        botId: "bot_valido",
        tipo: "join",
        nomeParticipante: "Dra. Elaine",
        idParticipante: "p1",
        isHost: true,
        quando: "10:00",
      });
      const participantesGravados = (capturado as { participantes: Array<{ papel: string | null }> }).participantes;
      expect(participantesGravados[0]!.papel).toBeNull();
    });

    it("decisor do briefing casa e recebe decisor_N pela ordem do briefing", async () => {
      let capturado: unknown = null;
      const admin = clienteFalso({
        sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
        participantesLookup: { data: { participantes: [] }, error: null },
        briefingLookup: {
          data: { jornadas: { briefings: [{ atual: true, conteudo: { processo_decisorio: { decisores: ["Terezinha", "Cleison"] } } }] } },
          error: null,
        },
        onRpcParticipantes: (args) => {
          capturado = { participantes: args.p_participantes_novos };
        },
      });

      await registrarEventoParticipante(admin, {
        botId: "bot_valido",
        tipo: "join",
        nomeParticipante: "Cleison",
        idParticipante: "p2",
        isHost: false,
        quando: "10:00",
      });
      const participantesGravados = (capturado as { participantes: Array<{ papel: string | null }> }).participantes;
      expect(participantesGravados[0]!.papel).toBe("decisor_2");
    });
  });

  // 🔴 Correção da corrida (auditoria pós-entrega, 15/09/2026): o webhook da
  // Recall entrega join/leave em rajada — dois eventos concorrentes na MESMA
  // sessão não podem mais fazer um sobrescrever o outro. Estes testes provam
  // o CAS (0105): 1ª tentativa PERDE (outro evento escreveu no meio do
  // caminho), a função reaplica o MESMO evento sobre o estado devolvido pela
  // RPC e tenta de novo — nunca perde o evento, nunca lança em corrida normal.
  describe("🔴 CAS (0105) — corrida no registro de participantes", () => {
    it("1ª tentativa perde (aplicado=false, outro evento concorrente escreveu antes): retenta e grava sobre o estado novo", async () => {
      const participantesAposConcorrente = [{ id: "p-outro", nome: "Cleison", entrou_em: "09:59", saiu_em: null, papel: null }];
      let ultimaChamada: unknown = null;
      const admin = clienteFalso({
        sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
        participantesLookup: { data: { participantes: [] }, error: null },
        configPapeisDeFala: { data: { valor: false }, error: null },
        filaCasParticipantes: [
          { aplicado: false, participantes: participantesAposConcorrente }, // 1ª tentativa: CAS perdeu
          { aplicado: true, participantes: null }, // 2ª tentativa: sucesso (participantes real não importa aqui)
        ],
        onRpcParticipantes: (args) => {
          ultimaChamada = args;
        },
      });

      const resultado = await registrarEventoParticipante(admin, {
        botId: "bot_valido",
        tipo: "join",
        nomeParticipante: "Terezinha",
        idParticipante: "p-terezinha",
        isHost: false,
        quando: "10:00:00Z",
      });

      expect(resultado).toEqual({ situacao: "gravado" });
      // A 2ª tentativa reaplicou o evento por CIMA do estado que a RPC devolveu
      // na 1ª — Terezinha (evento novo) E Cleison (já gravado pelo concorrente)
      // sobrevivem os dois no array final, nenhum foi perdido.
      const argsSegundaChamada = ultimaChamada as { p_participantes_esperados: unknown; p_participantes_novos: Array<{ nome: string }> };
      expect(argsSegundaChamada.p_participantes_esperados).toEqual(participantesAposConcorrente);
      expect(argsSegundaChamada.p_participantes_novos.map((p) => p.nome).sort()).toEqual(["Cleison", "Terezinha"]);
    });

    it("CAS perde em TODAS as tentativas: LANÇA, nunca finge sucesso nem descarta o evento em silêncio", async () => {
      const semprePerde = new Array(10).fill({ aplicado: false, participantes: [] });
      const admin = clienteFalso({
        sessaoLookup: { data: { sessao_id: "sessao-real", transcricao_id: null }, error: null },
        participantesLookup: { data: { participantes: [] }, error: null },
        configPapeisDeFala: { data: { valor: false }, error: null },
        filaCasParticipantes: semprePerde,
      });

      await expect(
        registrarEventoParticipante(admin, {
          botId: "bot_valido",
          tipo: "join",
          nomeParticipante: "Terezinha",
          idParticipante: null,
          isHost: false,
          quando: "10:00:00Z",
        }),
      ).rejects.toThrow("falha_ao_persistir_participante_apos_retentativas");
    });
  });
});
