import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER de `POST /api/sessoes/[id]/copiloto/bot` — Fase 10,
 * Fatia 4 (docs/ARQUITETURA-FASE-10.md §4.2, §6.2.2, §8). Achado do
 * coordenador: `pedirBot()` existia e ninguém o chamava — este arquivo
 * prova a ORDEM das travas, com o mesmo critério do teste de
 * `.../sugestao/route.test.ts`: um 409 sozinho não distingue "barrou antes"
 * de "barrou depois" — por isso cada teste de recusa prova também
 * `pedirBotMock` NUNCA chamado (nenhum fetch ao Recall).
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...args: unknown[]) => exigirVePatrimonioMock(...args) }));

const supabaseServidorMock = { from: vi.fn() };
const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const upsertSessoesCopilotoSpy = vi.fn();
const pedirBotMock = vi.fn();
const montarWebhookUrlComSegredoMock = vi.fn();
const copilotoWebhookConfiguradoMock = vi.fn();
const recallConfiguradoMock = vi.fn();
const encerrarBotComRetentativaMock = vi.fn();
vi.mock("@/server/copiloto/recall", () => ({
  pedirBot: (...a: unknown[]) => pedirBotMock(...a),
  montarWebhookUrlComSegredo: (...a: unknown[]) => montarWebhookUrlComSegredoMock(...a),
  copilotoWebhookConfigurado: (...a: unknown[]) => copilotoWebhookConfiguradoMock(...a),
  recallConfigurado: (...a: unknown[]) => recallConfiguradoMock(...a),
  encerrarBotComRetentativa: (...a: unknown[]) => encerrarBotComRetentativaMock(...a),
}));

const { POST } = await import("./route");

interface Cenario {
  copilotoAtivo: boolean;
  decisaoAtiva: boolean;
  consentimentoConcedido: boolean;
  audioAoVivo: boolean;
  provedorAudio: string;
  linkSala: string | null;
  gravacaoExternaIdExistente: string | null;
  estadoSessaoCopiloto: string | null;
  upsertFalha: boolean;
}

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    is: encadeavel,
    gte: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    in: encadeavel,
    upsert: encadeavel,
    returns: encadeavel,
    maybeSingle: terminal,
    single: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

const CENARIO_LIBERADO: Cenario = {
  copilotoAtivo: true,
  decisaoAtiva: true,
  consentimentoConcedido: true,
  audioAoVivo: true,
  provedorAudio: "recall",
  linkSala: "https://zoom.us/j/123",
  gravacaoExternaIdExistente: null,
  estadoSessaoCopiloto: "ativo",
  upsertFalha: false,
};

function montarCenario(c: Partial<Cenario> = {}) {
  const cenario = { ...CENARIO_LIBERADO, ...c };

  supabaseServidorMock.from.mockImplementation((tabela: string) => {
    if (tabela === "configuracoes") {
      // copilotoEstaAtivo/audioAoVivoEstaAtivo/provedorAudioConfigurado e a
      // leitura de retencao_dias_segmentos passam todos por aqui — cada um
      // lê `valor` isoladamente via `.eq('chave', ...)`, mas este mock
      // genérico não distingue a chave: devolve sempre o MESMO valor. Como
      // os booleanos e o provedor vêm de campos DIFERENTES deste objeto,
      // isolamos por teste trocando o mock quando o cenário precisa
      // combinações diferentes (ver `mockConfiguracoesPorChave` abaixo).
      return consultaEncadeavel({ data: { valor: cenario.copilotoAtivo }, error: null });
    }
    if (tabela === "sessoes_viabilidade") {
      return consultaEncadeavel({
        data: {
          id: "sessao-1",
          jornada_id: "jornada-1",
          link_sala: cenario.linkSala,
          jornadas: { pessoa_id: "pessoa-1" },
          sessoes_copiloto: cenario.estadoSessaoCopiloto
            ? { estado: cenario.estadoSessaoCopiloto, gravacao_externa_id: cenario.gravacaoExternaIdExistente }
            : null,
        },
        error: null,
      });
    }
    throw new Error(`tabela não mockada em supabaseServidorMock: ${tabela}`);
  });

  supabaseAdminMock.from.mockImplementation((tabela: string) => {
    if (tabela === "decisoes_juridicas") {
      return consultaEncadeavel({ data: cenario.decisaoAtiva ? { id: "decisao-1" } : null, error: null });
    }
    if (tabela === "consentimentos") {
      return consultaEncadeavel({
        data: cenario.consentimentoConcedido ? { concedido: true, revogado_em: null } : null,
        error: null,
      });
    }
    if (tabela === "sessoes_copiloto") {
      const resultado = cenario.upsertFalha
        ? { data: null, error: { code: "23503", message: "erro simulado no upsert" } }
        : { data: { sessao_id: "sessao-1" }, error: null };
      // Espiona TODO `.upsert()` feito em sessoes_copiloto — usado pelos
      // testes que provam `gravacao_externa_id` presente nos upserts de
      // pendência (achado do Fable: "os dois upserts de erro gravam a
      // pendência SEM gravacao_externa_id").
      const builder = consultaEncadeavel(resultado) as Record<string, unknown>;
      const upsertOriginal = builder.upsert as (...a: unknown[]) => unknown;
      builder.upsert = (payload: unknown, ...resto: unknown[]) => {
        upsertSessoesCopilotoSpy(payload);
        return upsertOriginal(payload, ...resto);
      };
      return builder;
    }
    throw new Error(`tabela não mockada em supabaseAdminMock: ${tabela}`);
  });

  // `audioAoVivoEstaAtivo`/`provedorAudioConfigurado` chamam `lerConfiguracaoBool`/
  // `lerConfiguracaoJson` sobre `supabase` (não `admin`) — mockamos essas
  // funções diretamente para não depender de qual chave cada `.eq()` recebeu
  // (o builder genérico acima não distingue chave).
}

vi.mock("@/server/ia/configuracao", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/server/ia/configuracao")>();
  return { ...original, lerConfiguracaoInt: vi.fn(async (_s: unknown, _chave: string, padrao: number) => padrao) };
});

const copilotoEstaAtivoMock = vi.fn();
const audioAoVivoEstaAtivoMock = vi.fn();
const provedorAudioConfiguradoMock = vi.fn();
vi.mock("@/server/copiloto/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/server/copiloto/config")>();
  return {
    ...original,
    copilotoEstaAtivo: (...a: unknown[]) => copilotoEstaAtivoMock(...a),
    audioAoVivoEstaAtivo: (...a: unknown[]) => audioAoVivoEstaAtivoMock(...a),
    provedorAudioConfigurado: (...a: unknown[]) => provedorAudioConfiguradoMock(...a),
  };
});

function requisicao() {
  return new Request("http://localhost/api/sessoes/11111111-1111-4111-8111-111111111111/copiloto/bot", {
    method: "POST",
  }) as never;
}

const PARAMS = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  supabaseAdminMock.from.mockReset();
  upsertSessoesCopilotoSpy.mockReset();
  pedirBotMock.mockReset();
  montarWebhookUrlComSegredoMock.mockReset();
  copilotoWebhookConfiguradoMock.mockReset();
  recallConfiguradoMock.mockReset();
  encerrarBotComRetentativaMock.mockReset();
  copilotoEstaAtivoMock.mockReset();
  audioAoVivoEstaAtivoMock.mockReset();
  provedorAudioConfiguradoMock.mockReset();
});

function configurarMocksDeConfig(c: Partial<Cenario> = {}) {
  const cenario = { ...CENARIO_LIBERADO, ...c };
  copilotoEstaAtivoMock.mockResolvedValue(cenario.copilotoAtivo);
  audioAoVivoEstaAtivoMock.mockResolvedValue(cenario.audioAoVivo);
  provedorAudioConfiguradoMock.mockResolvedValue(cenario.provedorAudio);
  recallConfiguradoMock.mockReturnValue(true);
  copilotoWebhookConfiguradoMock.mockReturnValue(true);
  montarWebhookUrlComSegredoMock.mockReturnValue("https://exemplo.com/api/webhooks/copiloto/transcricao?k=segredo");
}

describe("POST /api/sessoes/[id]/copiloto/bot — kill-switches, ANTES de qualquer fetch ao Recall", () => {
  it("copiloto_sessao.ativo=false: 409 copiloto_desligado, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ copilotoAtivo: false });
    configurarMocksDeConfig({ copilotoAtivo: false });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_desligado");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("SEM decisão jurídica ativa: 409 copiloto_ao_vivo_bloqueado, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ decisaoAtiva: false });
    configurarMocksDeConfig();

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_ao_vivo_bloqueado");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("SEM consentimento do titular: 409 copiloto_ao_vivo_bloqueado, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ consentimentoConcedido: false });
    configurarMocksDeConfig();

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_ao_vivo_bloqueado");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("copiloto_sessao.audio_ao_vivo=false (default): 409 audio_ao_vivo_desligado, ZERO chamada ao Recall — MESMO com gate liberado", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ audioAoVivo: false });
    configurarMocksDeConfig({ audioAoVivo: false });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("audio_ao_vivo_desligado");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("copiloto_sessao.provedor_audio='nenhum' (default, B75): 409 provedor_audio_nao_configurado, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ provedorAudio: "nenhum" });
    configurarMocksDeConfig({ provedorAudio: "nenhum" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("provedor_audio_nao_configurado");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("RECALL_API_KEY/COPILOTO_WEBHOOK_SECRET ausentes: 503 servico_indisponivel, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario();
    configurarMocksDeConfig();
    recallConfiguradoMock.mockReturnValue(false);

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(503);
    expect(corpo.erro).toBe("servico_indisponivel");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("sem link_sala cadastrado: 409 sem_link_sala, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ linkSala: null });
    configurarMocksDeConfig();

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("sem_link_sala");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  it("sessão já tem bot pedido: 409 bot_ja_pedido, idempotente, ZERO chamada ao Recall", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ gravacaoExternaIdExistente: "bot_ja_existe" });
    configurarMocksDeConfig();

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("bot_ja_pedido");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });

  // 🔴 Item menor do Fable (revisão de Solidificação): sessão encerrada/erro
  // não pode pedir bot.
  it.each(["encerrado", "erro"])("sessoes_copiloto.estado='%s': 409 sessao_ja_encerrada, ZERO chamada ao Recall", async (estado) => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ estadoSessaoCopiloto: estado });
    configurarMocksDeConfig();

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("sessao_ja_encerrada");
    expect(pedirBotMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessoes/[id]/copiloto/bot — sucesso e sala inexistente", () => {
  it("tudo liberado: chama pedirBot com retention explícito, grava gravacao_externa_id, 201", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario();
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "criado", botId: "bot_novo", statusChanges: [], recordings: [] });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(201);
    expect(corpo.bot_id).toBe("bot_novo");
    expect(pedirBotMock).toHaveBeenCalledTimes(1);
    const chamada = pedirBotMock.mock.calls[0][0];
    expect(chamada.retention).toBeDefined();
    expect(chamada.retention.type).toBe("days");
  });

  // 🔴 Aceite do §8 — o sub_code TEM de chegar ao corpo da resposta.
  it("meeting_not_found: 409 sala_invalida com sub_codigo no corpo, não erro genérico", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario();
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "sala_invalida", subCodigo: "meeting_not_found", codigo: "fatal" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("sala_invalida");
    expect(corpo.detalhes.sub_codigo).toBe("meeting_not_found");
    expect(corpo.detalhes.codigo).toBe("fatal");
  });

  it("retencao_infinita_detectada COM encerramento confirmado: 409, mensagem diz 'foi encerrado'", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario();
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "retencao_infinita_detectada", botId: "bot_forever", encerramentoConfirmado: true });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("retencao_infinita_detectada");
    expect(corpo.mensagem).toContain("encerrado");
    // Encerramento já confirmado por pedirBot() — não grava pendência nova.
    expect(supabaseAdminMock.from).not.toHaveBeenCalledWith("sessoes_copiloto");
  });

  // 🔴 Achado 4 do Fable (B76): mensagem CONDICIONAL ao resultado REAL —
  // "não foi possível encerrar" nunca pode virar "foi encerrado".
  it("retencao_infinita_detectada SEM encerramento confirmado: 409 com mensagem HONESTA + pendência gravada (não só stdout)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario();
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "retencao_infinita_detectada", botId: "bot_preso", encerramentoConfirmado: false });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("retencao_infinita_detectada");
    // NUNCA pode afirmar que foi encerrado quando não foi.
    expect(corpo.mensagem).not.toMatch(/o bot foi encerrado/i);
    expect(corpo.mensagem).toMatch(/não foi possível encerrar|não conseguiu encerrar/i);
    // Pendência gravada em sessoes_copiloto (0097/vw_pendencias_sistema) —
    // não só um registrarErro que ninguém vê por padrão.
    expect(supabaseAdminMock.from).toHaveBeenCalledWith("sessoes_copiloto");

    // 🔴 EDIÇÃO (a) DO ACHADO FINAL: o upsert de pendência grava
    // `gravacao_externa_id` JUNTO — sem isto, `tentarNovamenteEncerrarBotPendente`
    // nunca acharia o bot para tentar de novo, e a sessão ficava BRICADA.
    const upsertComPendencia = upsertSessoesCopilotoSpy.mock.calls.find(
      (args) => args[0] && typeof args[0] === "object" && "pendencia_encerramento_bot" in args[0],
    );
    expect(upsertComPendencia).toBeDefined();
    expect(upsertComPendencia?.[0].gravacao_externa_id).toBe("bot_preso");
    expect(upsertComPendencia?.[0].estado).toBe("erro");
  });
});

describe("POST /api/sessoes/[id]/copiloto/bot — achado 3 do Fable: upsert cego (bot invisível cobrando)", () => {
  it("upsert de gravacao_externa_id FALHA: NUNCA devolve 201 — encerra o bot e devolve erro real", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ upsertFalha: true });
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "criado", botId: "bot_orfao_em_potencial", statusChanges: [], recordings: [] });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    // 🔴 O ponto central do achado: NUNCA 201 quando o vínculo não persistiu.
    expect(resposta.status).not.toBe(201);
    expect(corpo.erro).toBe("falha_ao_persistir_vinculo_bot");
    // O bot que já está na sala real É encerrado — nunca fica órfão gravando.
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_orfao_em_potencial");
  });

  it("upsert FALHA e o encerramento TAMBÉM falha: pendência visível é gravada (pior caso, bot órfão gravando)", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ upsertFalha: true });
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "criado", botId: "bot_pior_caso", statusChanges: [], recordings: [] });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).not.toBe(201);
    expect(corpo.erro).toBe("falha_ao_persistir_vinculo_bot");
    expect(encerrarBotComRetentativaMock).toHaveBeenCalledWith("bot_pior_caso");

    // 🔴 EDIÇÃO (a), 2º nascedouro: o upsert do PIOR CASO (upsert de
    // gravacao_externa_id falhou E o encerramento também falhou) também
    // grava `gravacao_externa_id` — é a PRIMEIRA vez que o vínculo é
    // persistido de verdade (o upsert original, este que falhou, nunca chegou
    // a gravar nada).
    const upsertComPendencia = upsertSessoesCopilotoSpy.mock.calls.find(
      (args) => args[0] && typeof args[0] === "object" && "pendencia_encerramento_bot" in args[0],
    );
    expect(upsertComPendencia).toBeDefined();
    expect(upsertComPendencia?.[0].gravacao_externa_id).toBe("bot_pior_caso");
    expect(upsertComPendencia?.[0].estado).toBe("erro");
  });

  // 🔴 Item menor do Fable: mensagem CONDICIONAL ao resultado real do
  // encerramento — nunca "o bot foi encerrado por segurança" quando não foi.
  it("item menor: mensagem NUNCA afirma 'o bot foi encerrado por segurança' quando o encerramento FALHOU", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ upsertFalha: true });
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "criado", botId: "bot_msg_falsa", statusChanges: [], recordings: [] });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: false, detalhe: "recall_500" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.mensagem).not.toMatch(/o bot foi encerrado por segurança/i);
    expect(corpo.mensagem).toMatch(/não conseguiu encerrar/i);
  });

  it("item menor: mensagem AFIRMA 'encerrado por segurança' quando o encerramento TEVE sucesso", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    montarCenario({ upsertFalha: true });
    configurarMocksDeConfig();
    pedirBotMock.mockResolvedValue({ situacao: "criado", botId: "bot_msg_certa", statusChanges: [], recordings: [] });
    encerrarBotComRetentativaMock.mockResolvedValue({ sucesso: true, situacao: "encerrado" });

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(corpo.mensagem).toMatch(/o bot foi encerrado por segurança/i);
  });
});
