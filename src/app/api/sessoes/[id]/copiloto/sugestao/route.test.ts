import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Teste do HANDLER (Supabase mockado) exigido pelo `fable-orchestrator` na
 * correção do achado de Segurança: a rota mandava a fala do cliente para a
 * Anthropic ANTES de conferir decisão jurídica/consentimento — a checagem só
 * acontecia depois, no INSERT em `copiloto_sugestoes` (trigger de 0093).
 *
 * CRITÉRIO REFORÇADO PELO ARQUITETO (errata, commit f5920c4): um 409 sozinho
 * NÃO distingue "barrou antes" de "barrou depois" — a versão com o bug
 * também devolvia 409, só que depois de vazar a fala e pagar a execução.
 * Por isso cada teste de recusa prova DUAS coisas:
 *   (a) status 409 `copiloto_ao_vivo_bloqueado`;
 *   (b) ZERO INSERT em `execucoes_ia` — é o registro que só existiria se
 *       `executarComAuditoria` (server/ia/executar.ts) tivesse rodado de
 *       verdade e chamado o provedor. `insertEmExecucoesIa` é um spy
 *       dedicado, separado do mock de `@/server/ia/executar`, para a prova
 *       não depender de "confiar" que o módulo mockado nunca seria chamado
 *       por engano — ela conta a ESCRITA na tabela que a auditoria de IA usa.
 *
 * O QUE ESTE ARQUIVO PROVA, mockando `@/server/ia/executar`
 * (`executarComAuditoria` é o ÚNICO lugar desta base que faz a chamada HTTP
 * real ao provedor — ver `server/ia/executar.ts` e `provedor/openrouter.ts`):
 *
 *   1. SEM decisão jurídica ativa → 409 + zero chamada + zero INSERT em execucoes_ia.
 *   2. COM decisão mas SEM consentimento do titular → mesmo resultado.
 *   3. COM as duas condições → o fluxo segue até `executarComAuditoria` SER
 *      chamado — prova de que o gate não é um `false` disfarçado de
 *      sempre-off (os dois testes acima não passariam "à toa").
 */

const exigirVePatrimonioMock = vi.fn();
vi.mock("@/server/auth", () => ({ exigirVePatrimonio: (...args: unknown[]) => exigirVePatrimonioMock(...args) }));

const supabaseServidorMock = { from: vi.fn() };
const supabaseAdminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ criarClienteServidor: async () => supabaseServidorMock }));
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => supabaseAdminMock }));

const executarComAuditoriaMock = vi.fn();
vi.mock("@/server/ia/executar", () => ({
  executarComAuditoria: (...args: unknown[]) => executarComAuditoriaMock(...args),
}));

const { POST } = await import("./route");

interface Cenario {
  copilotoAtivo: boolean;
  decisaoAtiva: boolean;
  consentimentoConcedido: boolean;
}

/**
 * Builder de consulta encadeável genérico: qualquer sequência de
 * `.select().eq().eq().order().limit().maybeSingle()` (ou variações) resolve
 * para o `resultado` fornecido — cada método devolve o próprio objeto, exceto
 * o terminal (`maybeSingle`/`single`/`then`), que resolve a promise. Evita
 * reescrever uma cadeia de mock distinta por combinação de método usada em
 * cada tabela (`server/copiloto/{contexto,orcamento,gate}.ts` usam cadeias
 * diferentes entre si).
 */
function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, {
    select: encadeavel,
    eq: encadeavel,
    is: encadeavel,
    not: encadeavel, // `resolverBlocoAtual` (Fase 12, Fatia 1) usa `.not("conteudo->bloco_inferido", "is", null)`
    gte: encadeavel,
    order: encadeavel,
    limit: encadeavel,
    in: encadeavel,
    returns: encadeavel,
    maybeSingle: terminal,
    single: terminal,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  });
  return builder;
}

/** Spy dedicado: conta quantas vezes algo tentou `.insert()` na tabela
 * `execucoes_ia` — é a prova de "zero token gasto" que não depende de
 * confiar no mock de `executarComAuditoria` (o teste conta a ESCRITA real
 * que só a auditoria de IA faria). `select`/`in`/`gte` (leitura, usada por
 * `conferirOrcamentoCopiloto`) continuam liberados — só `insert` é espiado. */
function tabelaExecucoesIaComSpy(insertSpy: ReturnType<typeof vi.fn>) {
  const leitura = consultaEncadeavel({ count: 0, error: null });
  return {
    ...leitura,
    insert: (...args: unknown[]) => {
      insertSpy(...args);
      return consultaEncadeavel({ data: null, error: new Error("insert em execucoes_ia não deveria acontecer neste teste") });
    },
  };
}

function montarCenario(c: Cenario, insertExecucoesIaSpy: ReturnType<typeof vi.fn>) {
  supabaseServidorMock.from.mockImplementation((tabela: string) => {
    if (tabela === "configuracoes") {
      // copilotoEstaAtivo() e lerConfiguracaoJson (confiança mínima) passam
      // por aqui — o valor de confiança mínima não importa neste teste.
      // `resolverBlocoAtual` (Fase 12, Fatia 1) também lê esta tabela para
      // `copiloto_sessao.inferencia_bloco_ativa`/`janela_fixacao_manual_segundos`
      // — o mock genérico devolve `c.copilotoAtivo` para QUALQUER chave, o
      // que por coincidência não muda o resultado destes testes (o default
      // de `inferencia_bloco_ativa` já é `true`, e nenhum teste aqui verifica
      // `bloco_atual_resolvido`).
      return consultaEncadeavel({ data: { valor: c.copilotoAtivo }, error: null });
    }
    if (tabela === "sessoes_viabilidade") {
      return consultaEncadeavel({
        data: {
          id: "sessao-1",
          jornada_id: "jornada-1",
          roteiro_versao_id: null,
          sims: {},
          criado_em: "2026-09-11T10:00:00.000Z",
          sessoes_copiloto: { iniciado_em: "2026-09-11T10:05:00.000Z", criado_em: "2026-09-11T10:00:00.000Z", participantes: [], resumo_acumulado: {} },
          jornadas: { pessoa_id: "pessoa-1" },
          roteiros_versoes: null,
        },
        error: null,
      });
    }
    if (tabela === "briefings") {
      return consultaEncadeavel({ data: null, error: null });
    }
    if (tabela === "sessoes_copiloto_segmentos") {
      return consultaEncadeavel({ data: [], error: null });
    }
    if (tabela === "roteiros_versoes") {
      // Fallback de roteiro ATIVO (0099/coordenador, 14/09/2026): este
      // fixture tem `roteiro_versao_id: null` — `montarContextoCopiloto`
      // busca a versão ativa da chave 'sessao_viabilidade'. Sem versão
      // ativa aqui: `bloco_atual` continua null, igual ao comportamento
      // anterior a esta correção (o teste não depende do conteúdo do roteiro).
      return consultaEncadeavel({ data: null, error: null });
    }
    if (tabela === "copiloto_sugestoes") {
      // Fase 12, Fatia 1 (achado do Fable, defeito 1): a rota agora chama
      // `montarEstadoCopiloto` ANTES de montar contexto, para usar o bloco
      // RESOLVIDO PELO SERVIDOR em vez do índice cru do corpo da requisição
      // — `resolverBlocoAtual` lê esta tabela quando não há fixação manual.
      // Vazio aqui = "sem inferência ainda", o teste não depende do índice.
      return consultaEncadeavel({ data: null, error: null });
    }
    if (tabela === "consentimentos") {
      // `montarEstadoCopiloto` também calcula `sims_pendentes`
      // (`calcularSimsPendentes`), que lê o consentimento de gravação —
      // este teste não verifica esse campo do estado, só que a IA foi
      // alcançada; vazio = "sem consentimento de gravação encontrado" (não
      // confundir com o consentimento do GATE JURÍDICO, mockado no cliente
      // ADMIN abaixo, tabela homônima — são leituras diferentes).
      return consultaEncadeavel({ data: null, error: null });
    }
    throw new Error(`tabela não mockada em supabaseServidorMock: ${tabela}`);
  });

  supabaseAdminMock.from.mockImplementation((tabela: string) => {
    if (tabela === "decisoes_juridicas") {
      return consultaEncadeavel({ data: c.decisaoAtiva ? { id: "decisao-1" } : null, error: null });
    }
    if (tabela === "consentimentos") {
      return consultaEncadeavel({
        data: c.consentimentoConcedido ? { concedido: true, revogado_em: null } : null,
        error: null,
      });
    }
    if (tabela === "prompts_versoes") {
      return consultaEncadeavel({ data: [{ id: "prompt-1" }], error: null });
    }
    if (tabela === "execucoes_ia") {
      return tabelaExecucoesIaComSpy(insertExecucoesIaSpy);
    }
    if (tabela === "configuracoes") {
      // lerConfiguracaoInt (tetos do orçamento) lê via o cliente ADMIN aqui
      // (conferirOrcamentoCopiloto recebe `admin`, não `supabase`) — chave
      // ausente cai no padrão do código, que é o suficiente para este teste.
      return consultaEncadeavel({ data: null, error: null });
    }
    throw new Error(`tabela não mockada em supabaseAdminMock: ${tabela}`);
  });
}

function requisicao() {
  return new Request("http://localhost/api/sessoes/11111111-1111-4111-8111-111111111111/copiloto/sugestao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Fase 12, Fatia 1 (achado do Fable, defeito 1): `bloco` NÃO é mais lido
    // do corpo — mantido aqui só para provar que um corpo antigo (tela ainda
    // não atualizada, ou request replay) é descartado sem quebrar a rota
    // (`CorpoSchema` faz `.passthrough().transform(() => ({}))`).
    body: JSON.stringify({ bloco: 0 }),
  }) as never; // NextRequest é um superset de Request; o handler só usa .json()/.url
}

const PARAMS = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

afterEach(() => {
  exigirVePatrimonioMock.mockReset();
  supabaseServidorMock.from.mockReset();
  supabaseAdminMock.from.mockReset();
  executarComAuditoriaMock.mockReset();
});

describe("POST /api/sessoes/[id]/copiloto/sugestao — gate ANTES da IA (achado do Fable)", () => {
  it("SEM decisão jurídica ativa: 409 + ZERO chamada de IA + ZERO INSERT em execucoes_ia", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    const insertExecucoesIaSpy = vi.fn();
    montarCenario({ copilotoAtivo: true, decisaoAtiva: false, consentimentoConcedido: true }, insertExecucoesIaSpy);

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_ao_vivo_bloqueado");
    expect(executarComAuditoriaMock).not.toHaveBeenCalled();
    expect(insertExecucoesIaSpy).not.toHaveBeenCalled();
  });

  it("COM decisão ativa mas SEM consentimento do titular: 409 + ZERO chamada de IA + ZERO INSERT em execucoes_ia", async () => {
    exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
    const insertExecucoesIaSpy = vi.fn();
    montarCenario({ copilotoAtivo: true, decisaoAtiva: true, consentimentoConcedido: false }, insertExecucoesIaSpy);

    const resposta = await POST(requisicao(), PARAMS);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(409);
    expect(corpo.erro).toBe("copiloto_ao_vivo_bloqueado");
    expect(executarComAuditoriaMock).not.toHaveBeenCalled();
    expect(insertExecucoesIaSpy).not.toHaveBeenCalled();
  });

  it("COM decisão ativa E consentimento concedido: o gate libera e a IA É chamada (prova positiva)", async () => {
    vi.useFakeTimers();
    try {
      exigirVePatrimonioMock.mockResolvedValue({ papel: "advogada" });
      const insertExecucoesIaSpy = vi.fn();
      montarCenario({ copilotoAtivo: true, decisaoAtiva: true, consentimentoConcedido: true }, insertExecucoesIaSpy);
      // Nunca resolve de verdade — o teste só precisa provar que a chamada
      // foi ALCANÇADA, não o que ela devolve. executarIaCopiloto (real, não
      // mockado) corre isto contra o timeout de 8s (Promise.race); os fake
      // timers evitam que o teste espere 8s de relógio real.
      executarComAuditoriaMock.mockReturnValue(new Promise(() => {}));

      const promessa = POST(requisicao(), PARAMS);
      // A chamada acontece de forma síncrona-o-bastante (só microtasks) para
      // já ter sido feita antes do timer de 8s vencer — não precisamos
      // avançar o relógio para PROVAR a chamada, só para não travar o teste
      // caso o timeout dispare antes da asserção.
      await vi.advanceTimersByTimeAsync(0);

      expect(executarComAuditoriaMock).toHaveBeenCalledTimes(1);

      // Libera o timer para o teste não vazar uma promise pendurada.
      await vi.advanceTimersByTimeAsync(9_000);
      await promessa.catch(() => {});
    } finally {
      vi.useRealTimers();
    }
  });
});
