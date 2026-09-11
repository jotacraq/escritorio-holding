// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type {
  ComparacaoDecisoresPresentes,
  DesfechoCopiloto,
  EstadoCopiloto,
  EstadoCopilotoComPolling,
  RespostaDesfechoCopiloto,
  RespostaEncerrarCopiloto,
  RespostaSegmentos,
  RespostaSugestaoCopiloto,
  SugestaoCopiloto,
} from "@/types/copiloto";
import { ErroSessao } from "@/components/sessao/api";

/**
 * Fatia 1 do copiloto (docs/ARQUITETURA-FASE-10.md §8): modo determinístico
 * puro, zero IA. Este arquivo trava exatamente as garantias da entrega:
 *
 *  1. "O que falta no bloco" é derivado do payload do servidor — nunca
 *     inventado, nunca "0 de 0" quando o bloco não existe.
 *  2. SIMs pendentes e blocos não percorridos refletem fielmente a resposta.
 *  3. Erro de rede/HTTP na leitura tem tratamento visível (nunca tela muda).
 *  4. O campo de digitar/colar registra o trecho e ele aparece na lista —
 *     é a prova de que "vira segmento" não é conversa fiada.
 *  5. Kill-switch (`copiloto_sessao.ativo=false`, HTTP 409 com
 *     `erro: "copiloto_desligado"`): é ESTADO, não FALHA — cai em
 *     `EstadoVazio`, nunca em `EstadoErro` com "tentar de novo" (repetir não
 *     muda nada enquanto a chave continuar `false`). Detectado só pelo
 *     `codigo` de `ErroSessao`, nunca por `status` isolado nem pela string
 *     da mensagem (achado do Fable: o 409 é usado para outras coisas na
 *     casa, e mensagem muda).
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    copiloto: null as EstadoCopiloto | null,
    erroCopiloto: null as Error | null,
    segmentos: { itens: [], proximo_cursor: 0 } as RespostaSegmentos,
    erroSegmentos: null as Error | null,
    registrarChamadas: [] as string[],
    erroRegistrar: null as Error | null,
    // Fatia 2 — "Me ajuda agora"
    sugestaoResposta: null as RespostaSugestaoCopiloto | null,
    erroSugestao: null as Error | null,
    pedirSugestaoChamadas: 0,
    // Fatia 2 — desfecho (§5): "Ir para lá"/"Ignorar" gravam telemetria.
    desfechoChamadas: [] as Array<{ sessaoId: string; sugestaoId: string; desfecho: DesfechoCopiloto }>,
    erroDesfecho: null as Error | null,
    // Fatia 3 — polling coalescido (`GET .../copiloto` com cursores) e encerrar.
    pollingChamadas: [] as Array<{ bloco: number; desdeSegmento: number; desdeSugestao: number }>,
    pollingRespostas: [] as Array<EstadoCopilotoComPolling | (() => EstadoCopilotoComPolling)>,
    pollingRespostaPadrao: null as EstadoCopilotoComPolling | null,
    erroPolling: null as Error | null,
    /** Fila de comportamento POR CHAMADA (achado do Fable: falha persistente
     * do polling) — `null` = sucesso normal (segue o fluxo de
     * `pollingRespostas`/`pollingRespostaPadrao`), erro = rejeita com aquele
     * erro. Consumida ANTES de `erroPolling` (que continua servindo os
     * testes antigos, "toda chamada falha igual"). Vazia = ignorada. */
    pollingSequencia: [] as Array<Error | null>,
    encerrarChamadas: [] as string[],
    encerrarResposta: null as RespostaEncerrarCopiloto | null,
    erroEncerrar: null as Error | null,
    // Fatia 4 — POST .../copiloto/bot.
    pedirBotChamadas: 0,
    pedirBotResposta: null as { sessao_id: string; bot_id: string } | null,
    erroPedirBot: null as Error | null,
  },
}));

vi.mock("@/components/sessao/api", async () => {
  const real = await vi.importActual<typeof import("@/components/sessao/api")>("@/components/sessao/api");
  return {
    ...real,
    buscarEstadoCopiloto: () => (estado.erroCopiloto ? Promise.reject(estado.erroCopiloto) : Promise.resolve(estado.copiloto)),
    listarSegmentosCopiloto: () => (estado.erroSegmentos ? Promise.reject(estado.erroSegmentos) : Promise.resolve(estado.segmentos)),
    registrarSegmentoManual: (_sessaoId: string, texto: string) => {
      estado.registrarChamadas.push(texto);
      if (estado.erroRegistrar) return Promise.reject(estado.erroRegistrar);
      const novo = {
        id: `seg-${estado.registrarChamadas.length}`,
        sessao_id: "s1",
        ordem: estado.segmentos.itens.length + 1,
        falante: null,
        falante_confianca: null,
        texto,
        iniciado_ms: null,
        origem: "manual" as const,
        criado_em: new Date().toISOString(),
      };
      estado.segmentos = { itens: [...estado.segmentos.itens, novo], proximo_cursor: novo.ordem };
      return Promise.resolve(novo);
    },
    pedirSugestaoCopiloto: () => {
      estado.pedirSugestaoChamadas += 1;
      if (estado.erroSugestao) return Promise.reject(estado.erroSugestao);
      return Promise.resolve(estado.sugestaoResposta);
    },
    registrarDesfechoSugestaoCopiloto: (sessaoId: string, sugestaoId: string, desfecho: DesfechoCopiloto) => {
      estado.desfechoChamadas.push({ sessaoId, sugestaoId, desfecho });
      if (estado.erroDesfecho) return Promise.reject(estado.erroDesfecho);
      const resposta: RespostaDesfechoCopiloto = { sugestao_id: sugestaoId, desfecho, desfecho_em: new Date().toISOString() };
      return Promise.resolve(resposta);
    },
    buscarPollingCopiloto: (
      _sessaoId: string,
      parametros: { bloco: number; desdeSegmento: number; desdeSugestao: number },
    ) => {
      estado.pollingChamadas.push(parametros);
      if (estado.pollingSequencia.length > 0) {
        const proximoComportamento = estado.pollingSequencia.shift()!;
        if (proximoComportamento) return Promise.reject(proximoComportamento);
        // `null` na sequência: sucesso — segue o fluxo normal abaixo.
      } else if (estado.erroPolling) {
        return Promise.reject(estado.erroPolling);
      }
      const proxima = estado.pollingRespostas.shift();
      const base = proxima
        ? typeof proxima === "function"
          ? proxima()
          : proxima
        : (estado.pollingRespostaPadrao ?? RESPOSTA_POLLING_VAZIA(parametros));
      return Promise.resolve(base);
    },
    encerrarCopiloto: (sessaoId: string) => {
      estado.encerrarChamadas.push(sessaoId);
      if (estado.erroEncerrar) return Promise.reject(estado.erroEncerrar);
      return Promise.resolve(
        estado.encerrarResposta ?? {
          sessao_id: sessaoId,
          estado: "encerrado" as const,
          encerrado_em: new Date().toISOString(),
          transcricao_id: null,
          ja_existia_transcricao: false,
          sugestoes_expiradas: 0,
        },
      );
    },
    pedirBotCopiloto: (sessaoId: string) => {
      estado.pedirBotChamadas += 1;
      if (estado.erroPedirBot) return Promise.reject(estado.erroPedirBot);
      return Promise.resolve(estado.pedirBotResposta ?? { sessao_id: sessaoId, bot_id: "bot-1" });
    },
  };
});

/** `resposta.polling` default do mock — mesmos valores default que o
 * servidor grava na 0091 (`em_foco_ms: 3000`, `sem_foco_ms: 10000`). Os
 * testes que provam o reajuste de intervalo (§ aceite: "o intervalo vem do
 * servidor, não da constante") sobrescrevem isto explicitamente. */
const POLLING_PADRAO = { em_foco_ms: 3000, sem_foco_ms: 10000 };

/** Resposta de polling "silêncio normal": ciclo avaliado, nada novo — é o
 * caso mais comum (§4.1: "a maioria vem vazia"). Cursor devolvido é o mesmo
 * recebido, para o teste de cursor incremental poder provar que ele não
 * regride nem reinicia sozinho. */
function RESPOSTA_POLLING_VAZIA(parametros: { desdeSegmento: number; desdeSugestao: number }): EstadoCopilotoComPolling {
  return {
    ...ESTADO_BASE,
    segmentos_novos: [],
    proximo_cursor_segmento: parametros.desdeSegmento,
    sugestoes_novas: [],
    proximo_cursor_sugestao: parametros.desdeSugestao,
    ciclo: { avaliado: true, resultado: null, motivo_bloqueio: null },
    polling: POLLING_PADRAO,
    // Fatia 4 (§5): sem bot pedido nem decisores suficientes para comparar
    // neste cenário-base — `null`, nunca objeto vazio (regra da casa).
    bot: null,
    comparacao_decisores: null,
  };
}

/** Monta uma `EstadoCopilotoComPolling` completa a partir só do que o teste
 * precisa variar — `polling` sempre entra com o default a menos que o
 * `overrides` o troque. Único ponto que conhece a forma inteira do
 * contrato: um campo novo no tipo (como aconteceu com `polling`) quebra
 * aqui, no typecheck, e não em 10 literais espalhados pelo arquivo. */
function respostaPolling(overrides: Partial<EstadoCopilotoComPolling> = {}): EstadoCopilotoComPolling {
  return {
    ...ESTADO_BASE,
    segmentos_novos: [],
    proximo_cursor_segmento: 0,
    sugestoes_novas: [],
    proximo_cursor_sugestao: 0,
    ciclo: { avaliado: true, resultado: null, motivo_bloqueio: null },
    polling: POLLING_PADRAO,
    bot: null,
    comparacao_decisores: null,
    ...overrides,
  };
}

const { PainelCopiloto, ApresentacaoComparacaoDecisores } = await import("./PainelCopiloto");

const ESTADO_BASE: EstadoCopiloto = {
  sessao_id: "s1",
  bloco_atual_id: "bloco-1",
  falta_no_bloco: {
    campos: [{ id: "c1", rotulo: "Objeção principal", tipo: "texto" }],
    observar: ["Hesitação ao falar do imóvel da praia"],
  },
  sims_pendentes: [
    { sim: "decisores", rotulo: "Decisores presentes" },
    { sim: "proximo_passo", rotulo: "Próximo passo" },
  ],
  blocos_nao_percorridos: [
    { id: "b2", titulo: "PARTE 03 — Radiografia", indice: 2 },
    { id: "b3", titulo: "PARTE 04 — Objeções", indice: 3 },
  ],
  estado_copiloto: "aguardando",
};

async function abrir() {
  const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} />);
  // Achado do Fable (teste instável, 5 rodadas): esperar um número FIXO de
  // microtasks/`setTimeout(0)` é uma SUPOSIÇÃO sobre quando o `useRecurso`
  // termina — sob contenção de CPU essa suposição quebra (o efeito ainda
  // não rodou), e as asserções síncronas logo depois de `abrir()` leem o
  // DOM do estado "carregando". `waitFor` espera a CONDIÇÃO real (o
  // `role=status` de carregamento sumir), não um número de ticks — correto
  // tanto numa máquina rápida quanto sob carga. `{ timeout: false }` não é
  // usado: o timeout padrão do `waitFor` (1000ms) já é folga suficiente e
  // continua falhando alto se o carregamento nunca terminar de verdade.
  await waitFor(() => {
    expect(montado.queryByText("Carregando o copiloto…")).toBeNull();
  });
  return montado;
}

beforeEach(() => {
  estado.copiloto = { ...ESTADO_BASE };
  estado.erroCopiloto = null;
  estado.segmentos = { itens: [], proximo_cursor: 0 };
  estado.erroSegmentos = null;
  estado.registrarChamadas = [];
  estado.erroRegistrar = null;
  estado.sugestaoResposta = null;
  estado.erroSugestao = null;
  estado.pedirSugestaoChamadas = 0;
  estado.desfechoChamadas = [];
  estado.erroDesfecho = null;
  estado.pollingChamadas = [];
  estado.pollingRespostas = [];
  estado.pollingRespostaPadrao = null;
  estado.erroPolling = null;
  estado.pollingSequencia = [];
  estado.encerrarChamadas = [];
  estado.encerrarResposta = null;
  estado.erroEncerrar = null;
  estado.pedirBotChamadas = 0;
  estado.pedirBotResposta = null;
  estado.erroPedirBot = null;
});

describe("PainelCopiloto", () => {
  it("mostra o que falta no bloco, sem inventar nada além do payload", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("Objeção principal");
    expect(container.textContent).toContain("Hesitação ao falar do imóvel da praia");
  });

  it("mostra os SIMs pendentes com a contagem certa", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("Decisores presentes");
    expect(container.textContent).toContain("Próximo passo");
    expect(container.textContent).toContain("2 de 4");
  });

  it("mostra os blocos ainda não percorridos", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("PARTE 03 — Radiografia");
    expect(container.textContent).toContain("PARTE 04 — Objeções");
  });

  it("sem bloco atual: estado vazio explícito, nunca listas fantasmas", async () => {
    estado.copiloto = { ...ESTADO_BASE, bloco_atual_id: null, falta_no_bloco: { campos: [], observar: [] } };
    const { container } = await abrir();
    expect(container.textContent).toContain("Sem roteiro ativo");
  });

  it("todos os SIMs registrados: diz isso, não uma lista vazia muda", async () => {
    estado.copiloto = { ...ESTADO_BASE, sims_pendentes: [] };
    const { container } = await abrir();
    expect(container.textContent).toContain("Os 4 SIMs já foram registrados");
    expect(container.textContent).toContain("4 de 4");
  });

  it("erro HTTP ao carregar o estado: tratamento visível, com tentar de novo", async () => {
    // EstadoErro (DS) só lê mensagem específica de `ApiError` (lib/api/nucleo.ts);
    // `ErroSessao` (esta área) cai no fallback genérico — mesmo comportamento já
    // em uso por `ConduzirSessaoApp.tsx:198`. O que se trava aqui é que a FALHA
    // aparece (role=alert + botão de retentar), nunca uma tela muda.
    estado.erroCopiloto = new ErroSessao("Sessão de Viabilidade não encontrada.", 404, "nao_encontrado");
    const { container, getByRole } = await abrir();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("Não foi possível carregar o copiloto");
    expect(getByRole("button", { name: /tentar de novo/i })).toBeTruthy();
  });

  it("registra um trecho digitado e ele aparece na lista de transcrição", async () => {
    const { container, getByRole } = await abrir();
    const campo = getByRole("textbox", { name: /trecho da fala/i }) as HTMLTextAreaElement;
    const botao = getByRole("button", { name: /registrar trecho/i });

    fireEvent.change(campo, { target: { value: "meu filho não conseguiu entrar hoje" } });
    fireEvent.click(botao);

    await waitFor(() => expect(estado.registrarChamadas).toEqual(["meu filho não conseguiu entrar hoje"]));
    await waitFor(() => expect(container.textContent).toContain("meu filho não conseguiu entrar hoje"));
  });

  it("erro ao registrar o trecho: mensagem visível, texto digitado não se perde no vazio", async () => {
    estado.erroRegistrar = new ErroSessao("Não deu para registrar.", 500);
    const { getByRole } = await abrir();
    const campo = getByRole("textbox", { name: /trecho da fala/i }) as HTMLTextAreaElement;
    const botao = getByRole("button", { name: /registrar trecho/i });

    fireEvent.change(campo, { target: { value: "trecho qualquer" } });
    fireEvent.click(botao);

    await waitFor(() => {
      const alerta = document.querySelector('[role="alert"]');
      expect(alerta?.textContent).toContain("Não deu para registrar.");
    });
    expect(campo.value).toBe("trecho qualquer");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir();
    await semViolacoes(container);
  });
});

describe("PainelCopiloto — kill-switch (copiloto_sessao.ativo=false)", () => {
  it("copiloto_desligado: mostra o estado desligado, NUNCA o estado de erro", async () => {
    estado.erroCopiloto = new ErroSessao(
      "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      409,
      "copiloto_desligado",
    );
    const { container, queryByRole } = await abrir();

    // Nunca cai no caminho de EstadoErro: sem botão "tentar de novo" —
    // repetir a chamada não muda nada enquanto a chave continuar false.
    expect(queryByRole("button", { name: /tentar de novo/i })).toBeNull();
    expect(container.textContent).toContain("Copiloto desligado");
    expect(container.textContent).not.toContain("Não foi possível carregar o copiloto");
  });

  it("copiloto_desligado: distingue por codigo, não por status 409 isolado nem pela mensagem", async () => {
    // Um 409 QUALQUER, sem o código específico, continua caindo no erro
    // genérico — é o oposto do achado do Fable (não confundir "409 de outra
    // coisa" com "copiloto desligado").
    estado.erroCopiloto = new ErroSessao("Conflito de versão do roteiro.", 409, "roteiro_conflito");
    const { container, getByRole } = await abrir();
    expect(container.textContent).not.toContain("Copiloto desligado");
    expect(getByRole("button", { name: /tentar de novo/i })).toBeTruthy();
  });

  it("copiloto_desligado ao registrar um trecho: mensagem de estado, não de falha genérica", async () => {
    estado.erroRegistrar = new ErroSessao(
      "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      409,
      "copiloto_desligado",
    );
    const { getByRole } = await abrir();
    const campo = getByRole("textbox", { name: /trecho da fala/i }) as HTMLTextAreaElement;
    const botao = getByRole("button", { name: /registrar trecho/i });

    fireEvent.change(campo, { target: { value: "trecho qualquer" } });
    fireEvent.click(botao);

    await waitFor(() => {
      const alerta = document.querySelector('[role="alert"]');
      expect(alerta?.textContent).toContain("desligado por configuração");
    });
  });

  it("não tem violação de acessibilidade no estado desligado", async () => {
    estado.erroCopiloto = new ErroSessao(
      "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      409,
      "copiloto_desligado",
    );
    const { container } = await abrir();
    await semViolacoes(container);
  });
});

/**
 * Fatia 2 do copiloto (docs/ARQUITETURA-FASE-10.md §8): o botão "Me ajuda
 * agora" e a apresentação da sugestão por IA sob demanda. Este bloco trava
 * exatamente o que o aceite pede:
 *
 *  1. `visivel:false` NÃO renderiza a sugestão — é sucesso, não erro.
 *  2. Cada código de recusa rende SUA PRÓPRIA mensagem, não o erro genérico.
 *  3. `tipo` e `confianca` aparecem junto da observação, sempre.
 *  4. `desvio_sugerido` nunca navega sozinho — só no clique, e chama `irPara`.
 *  5. Campos nulos somem sem placeholder.
 *  6. axe limpo em todos os estados novos.
 */
const SUGESTAO_COMPLETA: SugestaoCopiloto = {
  proxima_pergunta: {
    texto: "Quem mais participa das decisões financeiras da família?",
    motivo: "O 3º SIM ainda não foi confirmado.",
    evidencia: "meu filho não conseguiu entrar hoje, ele viaja amanhã",
  },
  falta_no_bloco: [{ item: "Confirmar decisores presentes", evidencia: "só a Terezinha está na sala" }],
  observacao: {
    tipo: "inferencia",
    texto: "A cliente pode estar adiando a decisão até o filho poder participar.",
    evidencia: "vamos esperar ele voltar da viagem",
    confianca: 0.68,
  },
  desvio_sugerido: {
    bloco_id: "b2",
    motivo: "A radiografia patrimonial não depende do decisor ausente.",
    confianca: 0.72,
  },
  confianca_geral: 0.7,
  campos_evidencia_nao_conferida: [],
};

const BLOCOS_ROTEIRO = [{ id: "b1" }, { id: "b2" }, { id: "b3" }];

async function abrirComRoteiro(irPara?: (i: number) => void) {
  const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} blocosRoteiro={BLOCOS_ROTEIRO} irPara={irPara} />);
  // Mesma correção de `abrir()` (achado do Fable, teste instável): espera
  // a CONDIÇÃO real (carregamento terminado), não um número fixo de ticks.
  await waitFor(() => {
    expect(montado.queryByText("Carregando o copiloto…")).toBeNull();
  });
  return montado;
}

describe("PainelCopiloto — Fatia 2, botão Me ajuda agora", () => {
  it("botão existe e pede a sugestão ao ser clicado", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole } = await abrirComRoteiro();
    const botao = getByRole("button", { name: /me ajuda agora/i });
    fireEvent.click(botao);
    await waitFor(() => expect(estado.pedirSugestaoChamadas).toBe(1));
  });

  it("visivel:false NÃO renderiza a sugestão — é sucesso, mostra aviso sóbrio", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.3, visivel: false, sugestao: null };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Sem sugestão confiável agora"));
    // nunca renderiza qualquer parte de uma sugestão, mesmo que o campo exista
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Próxima pergunta");
  });

  it("mesmo com visivel:false E sugestao preenchida no payload, a tela NUNCA mostra a sugestão", async () => {
    // Defesa em profundidade: o contrato diz que `sugestao` fica null quando
    // `visivel:false`, mas a tela não deve confiar apenas nisso.
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.3, visivel: false, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Sem sugestão confiável agora"));
    expect(container.textContent).not.toContain("Quem mais participa das decisões financeiras");
  });

  describe("cada código de recusa rende sua própria mensagem", () => {
    const casos: Array<{ codigo: string; trechoEsperado: string; temBotaoTentarDeNovo: boolean }> = [
      { codigo: "copiloto_ia_nao_ativada", trechoEsperado: "ainda não ativado", temBotaoTentarDeNovo: false },
      { codigo: "teto_ia_copiloto_atingido", trechoEsperado: "Limite de sugestões", temBotaoTentarDeNovo: false },
      { codigo: "timeout_copiloto", trechoEsperado: "não chegou a tempo", temBotaoTentarDeNovo: true },
      { codigo: "copiloto_ao_vivo_bloqueado", trechoEsperado: "bloqueado", temBotaoTentarDeNovo: false },
      { codigo: "recusa_ia", trechoEsperado: "recusou responder", temBotaoTentarDeNovo: true },
      { codigo: "saida_invalida", trechoEsperado: "não pôde ser validada", temBotaoTentarDeNovo: true },
      { codigo: "conteudo_proibido", trechoEsperado: "foi descartada", temBotaoTentarDeNovo: false },
    ];

    for (const caso of casos) {
      it(`${caso.codigo}: mostra "${caso.trechoEsperado}", não o erro genérico`, async () => {
        estado.erroSugestao = new ErroSessao("mensagem qualquer do servidor", 409, caso.codigo);
        const { getByRole, container, queryByRole } = await abrirComRoteiro();
        fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

        await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
        expect(container.textContent).toContain(caso.trechoEsperado);
        expect(container.textContent).not.toContain("Não foi possível pedir a sugestão");

        const botaoTentar = queryByRole("button", { name: /tentar de novo/i });
        if (caso.temBotaoTentarDeNovo) expect(botaoTentar).toBeTruthy();
        else expect(botaoTentar).toBeNull();
      });
    }

    it("código desconhecido cai no erro genérico, não trava a tela", async () => {
      estado.erroSugestao = new ErroSessao("algo estranho", 500, "codigo_nao_mapeado");
      const { getByRole, container } = await abrirComRoteiro();
      fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
      await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
      expect(container.textContent).toContain("Não foi possível pedir a sugestão");
    });
  });

  it("tipo e confianca aparecem junto da observação", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Inferência"));
    expect(container.textContent).toContain("confiança 68%");
    expect(container.textContent).toContain("A cliente pode estar adiando a decisão");
  });

  it("evidencia aparece como citação, distinta da conclusão", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.querySelector("blockquote")).toBeTruthy());
    const citacoes = Array.from(container.querySelectorAll("blockquote")).map((b) => b.textContent);
    expect(citacoes.some((c) => c?.includes("meu filho não conseguiu entrar hoje"))).toBe(true);
  });

  it("desvio_sugerido nunca navega sozinho: só ao clicar em 'Ir para lá', chamando irPara com o índice certo", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));
    // Antes do clique: nenhuma navegação ocorreu.
    expect(irParaMock).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: /ir para lá/i }));
    // bloco_id "b2" está no índice 1 de BLOCOS_ROTEIRO
    expect(irParaMock).toHaveBeenCalledTimes(1);
    expect(irParaMock).toHaveBeenCalledWith(1);
  });

  it("desvio_sugerido tem botão Ignorar ao lado, que some a sugestão sem navegar", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));
    fireEvent.click(getByRole("button", { name: /ignorar/i }));

    expect(irParaMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Sugestão de desvio");
  });

  it("sem irPara (prop ausente): desvio_sugerido aparece só como informação, sem botão de navegar", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container, queryByRole } = await abrirComRoteiro(undefined);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));
    expect(queryByRole("button", { name: /ir para lá/i })).toBeNull();
  });

  it("'Ir para lá' grava desfecho='aceita' e navega — os dois acontecem", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-42", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));

    fireEvent.click(getByRole("button", { name: /ir para lá/i }));

    expect(irParaMock).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(estado.desfechoChamadas).toEqual([{ sessaoId: "s1", sugestaoId: "sug-42", desfecho: "aceita" }]),
    );
  });

  it("'Ignorar' grava desfecho='ignorada' e dispensa — os dois acontecem", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-43", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));

    fireEvent.click(getByRole("button", { name: /ignorar/i }));

    expect(container.textContent).not.toContain("Sugestão de desvio");
    expect(irParaMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(estado.desfechoChamadas).toEqual([{ sessaoId: "s1", sugestaoId: "sug-43", desfecho: "ignorada" }]),
    );
  });

  it("falha ao gravar o desfecho NÃO impede a navegação de 'Ir para lá'", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-44", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    estado.erroDesfecho = new ErroSessao("indisponível", 500);
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));

    fireEvent.click(getByRole("button", { name: /ir para lá/i }));

    // Navegação e dispensa da sugestão aconteceram de qualquer jeito.
    expect(irParaMock).toHaveBeenCalledWith(1);
    expect(container.textContent).not.toContain("Sugestão de desvio");
    // Nenhum alerta visível por causa da telemetria que falhou.
    await waitFor(() => expect(estado.desfechoChamadas.length).toBe(1));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("falha ao gravar o desfecho NÃO impede a dispensa de 'Ignorar', nem mostra erro", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-45", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    estado.erroDesfecho = new ErroSessao("indisponível", 500);
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));

    fireEvent.click(getByRole("button", { name: /ignorar/i }));

    expect(container.textContent).not.toContain("Sugestão de desvio");
    await waitFor(() => expect(estado.desfechoChamadas.length).toBe(1));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("desfecho_ja_registrado (409, duplo-clique) não vira erro na tela — silêncio, caso normal", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-46", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    estado.erroDesfecho = new ErroSessao("Esta sugestão já tem desfecho registrado.", 409, "desfecho_ja_registrado");
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));

    fireEvent.click(getByRole("button", { name: /ir para lá/i }));

    expect(irParaMock).toHaveBeenCalledWith(1);
    await waitFor(() => expect(estado.desfechoChamadas.length).toBe(1));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("desfecho");
  });

  it("axe limpo depois de 'Ir para lá' com falha silenciosa na telemetria", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-47", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    estado.erroDesfecho = new ErroSessao("indisponível", 500);
    const irParaMock = vi.fn();
    const { getByRole, container } = await abrirComRoteiro(irParaMock);
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));
    fireEvent.click(getByRole("button", { name: /ir para lá/i }));
    await waitFor(() => expect(estado.desfechoChamadas.length).toBe(1));
    await semViolacoes(container);
  });

  it("campos nulos somem sem placeholder: sugestão com só a observação preenchida não mostra os outros blocos", async () => {
    const sugestaoParcial: SugestaoCopiloto = {
      proxima_pergunta: null,
      falta_no_bloco: [],
      observacao: { tipo: "fato", texto: "A cliente confirmou dois imóveis.", evidencia: "tenho o apartamento e a casa de praia", confianca: 0.9 },
      desvio_sugerido: null,
      confianca_geral: 0.9,
      campos_evidencia_nao_conferida: [],
    };
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.9, visivel: true, sugestao: sugestaoParcial };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("A cliente confirmou dois imóveis"));
    expect(container.textContent).not.toContain("Próxima pergunta");
    expect(container.textContent).not.toContain("A IA notou que falta");
    expect(container.textContent).not.toContain("Sugestão de desvio");
    // nenhum "null" ou "undefined" vazando para o texto
    expect(container.textContent).not.toMatch(/\bnull\b|\bundefined\b/i);
  });

  it("todos os campos nulos: mensagem sóbria dizendo que não há nada específico, não uma tela vazia muda", async () => {
    const sugestaoVazia: SugestaoCopiloto = {
      proxima_pergunta: null,
      falta_no_bloco: [],
      observacao: null,
      desvio_sugerido: null,
      confianca_geral: 0.65,
      campos_evidencia_nao_conferida: [],
    };
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.65, visivel: true, sugestao: sugestaoVazia };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("não teve nada específico a apontar"));
  });

  it("botão não pode ser clicado duas vezes enquanto a IA responde", async () => {
    let resolver!: (v: RespostaSugestaoCopiloto) => void;
    const pendente = new Promise<RespostaSugestaoCopiloto>((r) => {
      resolver = r;
    });
    // Sobrescreve o mock só para este teste: a chamada fica pendente até
    // resolvermos manualmente, simulando a espera de até 8s.
    const apiModulo = await import("@/components/sessao/api");
    const spy = vi.spyOn(apiModulo, "pedirSugestaoCopiloto").mockImplementation(() => pendente);

    const { getByRole } = await abrirComRoteiro();
    const botao = getByRole("button", { name: /me ajuda agora/i }) as HTMLButtonElement;
    fireEvent.click(botao);
    await waitFor(() => expect(botao.disabled).toBe(true));
    fireEvent.click(botao); // segundo clique, deve ser ignorado

    resolver({ sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA });
    await waitFor(() => expect(botao.disabled).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("axe limpo: sugestão completa visível", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sugestão de desvio"));
    await semViolacoes(container);
  });

  it("axe limpo: visivel:false", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.3, visivel: false, sugestao: null };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Sem sugestão confiável agora"));
    await semViolacoes(container);
  });

  it("axe limpo: estado de recusa (teto atingido)", async () => {
    estado.erroSugestao = new ErroSessao("mensagem", 409, "teto_ia_copiloto_atingido");
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    await semViolacoes(container);
  });

  it("axe limpo: estado carregando (Pensando...)", async () => {
    let resolver!: (v: RespostaSugestaoCopiloto) => void;
    const pendente = new Promise<RespostaSugestaoCopiloto>((r) => {
      resolver = r;
    });
    const apiModulo = await import("@/components/sessao/api");
    const spy = vi.spyOn(apiModulo, "pedirSugestaoCopiloto").mockImplementation(() => pendente);

    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Pensando"));
    await semViolacoes(container);

    resolver({ sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: null });
    spy.mockRestore();
  });
});

/**
 * Fatia 3 (docs/ARQUITETURA-FASE-10.md §4.1, §4.3, §6.1, §8, B71): o ciclo
 * automático roda sozinho e a tela busca novidade por polling. Este bloco
 * trava exatamente o aceite pedido:
 *
 *  1. Cursor incremental: o próximo `GET` manda o último cursor recebido,
 *     nunca refaz a lista desde o início.
 *  2. Intervalo sobe para 10s quando `document.visibilityState` é "hidden".
 *  3. O polling PARA de vez ao encerrar a sessão (nenhuma chamada depois).
 *  4. `bloqueado_pelo_gate` rende aviso explícito — distinto de silêncio.
 *  5. Sugestão nova NUNCA abre sozinha — só o aviso discreto; abrir é clique.
 *  6. `sessao_ja_encerrada` (409) não vira erro visível.
 *  7. Timer é limpo no unmount (nenhuma chamada depois de desmontar).
 *  8. axe limpo nos estados novos (aviso de gate, aviso de sugestão nova,
 *     card aberto, tela pós-encerramento).
 */
describe("PainelCopiloto — Fatia 3, ciclo automático e polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

/** Mesmo padrão de `abrir()`, mas avançando timers falsos em vez de esperar
   * timers reais — a Fatia 1/2 resolvem por microtask (funcionam igual com
   * fake timers). O polling só dispara o PRIMEIRO ciclo aos 3s (§4.1: o
   * primeiro request não é imediato, é o mesmo intervalo dos seguintes) —
   * por isso avança 3000ms aqui: depois de `abrirComPolling`, já houve
   * exatamente 1 chamada de polling, ponto de partida estável para os
   * testes que avançam mais tempo a partir daí. */
  async function abrirComPolling(props: { blocosRoteiro?: { id: string }[]; irPara?: (i: number) => void } = {}) {
    const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} {...props} />);
    // Resolve a Fatia 1 (`useRecurso`, microtask) antes do polling: o
    // polling só começa a valer depois que `estado` existir (`podePollar`).
    // Duas voltas de microtask (mesmo padrão de `abrir()`: `.then/.finally`
    // encadeados precisam de mais de uma volta do loop de microtasks).
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);
    return montado;
  }

  it("manda o cursor da resposta anterior na próxima chamada — nunca refaz a lista desde o início", async () => {
    const sugestaoPolling = {
      sugestao_id: "sug-auto-1",
      ordem_evento: 5,
      gatilho: "intervalo" as const,
      confianca_geral: 0.8,
      visivel: true,
      sugestao: SUGESTAO_COMPLETA,
      desfecho: null,
      criado_em: new Date().toISOString(),
    };
    estado.pollingRespostas = [
      respostaPolling({
        proximo_cursor_segmento: 12,
        sugestoes_novas: [sugestaoPolling],
        proximo_cursor_sugestao: 5,
        ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null },
      }),
    ];
    await abrirComPolling();

    // Primeira chamada: cursores no zero (início).
    expect(estado.pollingChamadas[0]).toEqual({ bloco: 1, desdeSegmento: 0, desdeSugestao: 0 });

    // Avança um ciclo de polling (3s em foco).
    await vi.advanceTimersByTimeAsync(3000);

    // Segunda chamada: cursores são os devolvidos na primeira resposta —
    // nunca 0 de novo (que refaria a lista inteira).
    expect(estado.pollingChamadas[1]).toEqual({ bloco: 1, desdeSegmento: 12, desdeSugestao: 5 });
  });

  it("intervalo sobe para 10s quando a aba perde o foco (document.visibilityState)", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      await abrirComPolling();
      const chamadasAntes = estado.pollingChamadas.length;

      // Aos 3s (intervalo em foco) ainda NÃO deveria ter rodado de novo.
      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes);

      // Aos 10s (intervalo sem foco) já rodou.
      await vi.advanceTimersByTimeAsync(7000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes + 1);
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
  });

  it("encerrar a sessão PARA o polling de vez — nenhuma chamada depois", async () => {
    const { getByRole } = await abrirComPolling();
    const chamadasAntesDeEncerrar = estado.pollingChamadas.length;

    fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(estado.encerrarChamadas).toEqual(["s1"]));

    const chamadasLogoApósEncerrar = estado.pollingChamadas.length;
    // Avança bastante tempo — se o polling não tivesse parado, teria disparado várias vezes.
    await vi.advanceTimersByTimeAsync(30000);
    expect(estado.pollingChamadas.length).toBe(chamadasLogoApósEncerrar);
    expect(chamadasLogoApósEncerrar).toBeGreaterThanOrEqual(chamadasAntesDeEncerrar);
  });

  it("bloqueado_pelo_gate: aviso EXPLÍCITO, distinto de silêncio normal", async () => {
    estado.pollingRespostas = [
      respostaPolling({
        ciclo: { avaliado: true, resultado: "bloqueado_pelo_gate", motivo_bloqueio: "sem_consentimento_titular" },
      }),
    ];
    const { container } = await abrirComPolling();

    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("Copiloto de IA parado nesta sessão");
    expect(container.textContent).toContain("consentimento do titular");
  });

  it("silêncio normal (resultado=null) NÃO mostra nenhum aviso de bloqueio", async () => {
    estado.pollingRespostaPadrao = RESPOSTA_POLLING_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 });
    const { container } = await abrirComPolling();
    expect(container.textContent).not.toContain("Copiloto de IA parado");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("sugestão nova do ciclo automático NÃO abre sozinha — só o aviso discreto aparece", async () => {
    estado.pollingRespostas = [
      respostaPolling({
        sugestoes_novas: [
          {
            sugestao_id: "sug-auto-2",
            ordem_evento: 1,
            gatilho: "intervalo",
            confianca_geral: 0.8,
            visivel: true,
            sugestao: SUGESTAO_COMPLETA,
            desfecho: null,
            criado_em: new Date().toISOString(),
          },
        ],
        proximo_cursor_sugestao: 1,
        ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null },
      }),
    ];
    const { container, getByRole, queryByRole } = await abrirComPolling();

    expect(container.textContent).toContain("1 sugestão nova");
    // O conteúdo da sugestão (texto da próxima pergunta) NÃO está na tela —
    // só o aviso fechado, nunca o card aberto sozinho.
    expect(container.textContent).not.toContain("Quem mais participa das decisões financeiras");
    expect(queryByRole("blockquote" as never)).toBeNull();

    // Só abre no clique explícito.
    fireEvent.click(getByRole("button", { name: /ver sugestão/i }));
    expect(container.textContent).toContain("Quem mais participa das decisões financeiras");
  });

  it("chegar uma 2ª sugestão não fecha nem mexe na 1ª já aberta", async () => {
    const sugestao1 = {
      sugestao_id: "sug-a",
      ordem_evento: 1,
      gatilho: "intervalo" as const,
      confianca_geral: 0.8,
      visivel: true,
      sugestao: SUGESTAO_COMPLETA,
      desfecho: null,
      criado_em: new Date().toISOString(),
    };
    const sugestaoParcial: SugestaoCopiloto = {
      proxima_pergunta: null,
      falta_no_bloco: [],
      observacao: { tipo: "fato", texto: "Segunda observação distinta.", evidencia: null, confianca: 0.9 },
      desvio_sugerido: null,
      confianca_geral: 0.9,
      campos_evidencia_nao_conferida: [],
    };
    const sugestao2 = { ...sugestao1, sugestao_id: "sug-b", ordem_evento: 2, sugestao: sugestaoParcial };

    estado.pollingRespostas = [
      respostaPolling({ sugestoes_novas: [sugestao1], proximo_cursor_sugestao: 1, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } }),
    ];
    const { container, getByRole } = await abrirComPolling();

    fireEvent.click(getByRole("button", { name: /ver sugestão/i }));
    expect(container.textContent).toContain("Quem mais participa das decisões financeiras");

    // 2ª sugestão chega no próximo ciclo, fechada — a 1ª continua aberta como estava.
    estado.pollingRespostaPadrao = respostaPolling({ sugestoes_novas: [sugestao2], proximo_cursor_sugestao: 2, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } });
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);

    expect(container.textContent).toContain("Quem mais participa das decisões financeiras"); // 1ª segue aberta
    expect(container.textContent).toContain("2 sugestões novas");
    expect(container.textContent).not.toContain("Segunda observação distinta."); // 2ª chegou fechada
  });

  it("sessao_ja_encerrada (clique duplo em Encerrar) não vira erro visível — trata como sucesso", async () => {
    estado.erroEncerrar = new ErroSessao("Esta sessão do copiloto já está encerrada.", 409, "sessao_ja_encerrada");
    const { container, getByRole } = await abrirComPolling();

    fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(container.textContent).toContain("O copiloto foi encerrado para esta sessão"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("timer é limpo no unmount — nenhuma chamada de polling depois de desmontar", async () => {
    const { unmount } = await abrirComPolling();
    const chamadasAntes = estado.pollingChamadas.length;
    unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(estado.pollingChamadas.length).toBe(chamadasAntes);
  });

  it("axe limpo: aviso de bloqueio pelo gate", async () => {
    estado.pollingRespostas = [
      respostaPolling({ ciclo: { avaliado: true, resultado: "bloqueado_pelo_gate", motivo_bloqueio: "sem_decisao_juridica" } }),
    ];
    const { container } = await abrirComPolling();
    // `axe-core` roda sua própria fila de promises/timeouts internos — com
    // fake timers ativos ele nunca resolve. A montagem e o avanço do
    // polling já terminaram; volta para timers reais só para a auditoria.
    vi.useRealTimers();
    await semViolacoes(container);
  });

  it("axe limpo: aviso discreto de sugestão nova (fechado)", async () => {
    estado.pollingRespostas = [
      respostaPolling({
        sugestoes_novas: [
          { sugestao_id: "sug-x", ordem_evento: 1, gatilho: "virada_bloco", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA, desfecho: null, criado_em: new Date().toISOString() },
        ],
        proximo_cursor_sugestao: 1,
        ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null },
      }),
    ];
    const { container } = await abrirComPolling();
    vi.useRealTimers();
    await semViolacoes(container);
  });

  it("axe limpo: card de sugestão do ciclo aberto", async () => {
    estado.pollingRespostas = [
      respostaPolling({
        sugestoes_novas: [
          { sugestao_id: "sug-y", ordem_evento: 1, gatilho: "intervalo", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA, desfecho: null, criado_em: new Date().toISOString() },
        ],
        proximo_cursor_sugestao: 1,
        ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null },
      }),
    ];
    const { container, getByRole } = await abrirComPolling();
    fireEvent.click(getByRole("button", { name: /ver sugestão/i }));
    vi.useRealTimers();
    await semViolacoes(container);
  });

  it("axe limpo: tela pós-encerramento", async () => {
    const { container, getByRole } = await abrirComPolling();
    fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(container.textContent).toContain("O copiloto foi encerrado para esta sessão"));
    vi.useRealTimers();
    await semViolacoes(container);
  });

  /**
   * Contrato novo (coordenador, correção da divergência apontada nesta
   * entrega): `resposta.polling` (`ConfigPollingCopiloto`) manda o intervalo
   * — não mais uma constante do front. Este bloco trava exatamente o
   * aceite adicional pedido:
   *
   *  1. O intervalo usado pelo timer é o que veio na resposta, não a
   *     constante local.
   *  2. Mudar o valor entre duas respostas reajusta o PRÓXIMO tick, sem
   *     recriar o ciclo (mesmos cursores, nenhuma chamada extra) nem perder
   *     cursor.
   *  3. `sessao_encerrada_por_duracao_maxima` é estado EXPLÍCITO — distinto
   *     do encerramento manual — e PARA o polling, como o manual já parava.
   *  4. axe limpo no estado novo.
   */
  describe("intervalo mandado pelo servidor + encerramento por duração máxima", () => {
    it("usa o em_foco_ms da resposta do servidor, não a constante do front", async () => {
      estado.pollingRespostaPadrao = respostaPolling({ polling: { em_foco_ms: 5000, sem_foco_ms: 20000 } });
      await abrirComPolling();
      const chamadasAntes = estado.pollingChamadas.length;

      // Aos 3s (constante antiga) ainda NÃO deveria ter disparado — o
      // servidor mandou 5000ms.
      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes);

      // Completando os 5000ms mandados pelo servidor, dispara.
      await vi.advanceTimersByTimeAsync(2000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes + 1);
    });

    it("mudança de em_foco_ms entre respostas reajusta o timer no tick seguinte, sem recriar o ciclo nem perder cursor", async () => {
      // 1ª resposta: intervalo padrão (3000ms) e cursores avançam.
      estado.pollingRespostas = [
        respostaPolling({ proximo_cursor_segmento: 7, proximo_cursor_sugestao: 3, polling: { em_foco_ms: 3000, sem_foco_ms: 10000 } }),
      ];
      // A partir da 2ª: servidor passa a mandar um intervalo maior (alguém
      // ajustou em Admin no meio da sessão).
      estado.pollingRespostaPadrao = respostaPolling({ proximo_cursor_segmento: 7, proximo_cursor_sugestao: 3, polling: { em_foco_ms: 9000, sem_foco_ms: 30000 } });

      await abrirComPolling(); // já consome a 1ª resposta (3000ms iniciais)
      expect(estado.pollingChamadas).toHaveLength(1);
      expect(estado.pollingChamadas[0]).toEqual({ bloco: 1, desdeSegmento: 0, desdeSugestao: 0 });

      // Ainda usando o intervalo ANTIGO para agendar o 2º tick (decidido
      // pela 1ª resposta, que mandou 3000): dispara aos 3s.
      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas).toHaveLength(2);
      // Cursor da chamada nº2 é o que a 1ª resposta devolveu — nunca 0 de novo.
      expect(estado.pollingChamadas[1]).toEqual({ bloco: 1, desdeSegmento: 7, desdeSugestao: 3 });

      // Agora o timer passa a respeitar os 9000ms que a 2ª resposta mandou:
      // aos +3000ms (total 6s desde o 2º tick) ainda NÃO dispara de novo.
      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas).toHaveLength(2);
      // Só aos +9000ms desde o 2º tick.
      await vi.advanceTimersByTimeAsync(6000);
      expect(estado.pollingChamadas).toHaveLength(3);
      expect(estado.pollingChamadas[2]).toEqual({ bloco: 1, desdeSegmento: 7, desdeSugestao: 3 });
    });

    it("sessao_encerrada_por_duracao_maxima: estado EXPLÍCITO, distinto do encerramento manual", async () => {
      estado.pollingRespostas = [
        respostaPolling({ ciclo: { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling();

      expect(container.textContent).toContain("automaticamente por ter passado do tempo máximo configurado");
      expect(container.textContent).toContain("não é falha");
      // A mensagem de encerramento MANUAL não aparece — são estados distintos.
      expect(container.textContent).not.toContain("O copiloto foi encerrado para esta sessão.");
      // Não é tratado como falha — sem role=alert de erro.
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it("sessao_encerrada_por_duracao_maxima PARA o polling — nenhuma chamada depois", async () => {
      estado.pollingRespostas = [
        respostaPolling({ ciclo: { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null } }),
      ];
      await abrirComPolling();
      const chamadasLogoApósEncerrar = estado.pollingChamadas.length;

      await vi.advanceTimersByTimeAsync(30000);
      expect(estado.pollingChamadas.length).toBe(chamadasLogoApósEncerrar);
    });

    it("sessao_encerrada_por_duracao_maxima: o botão 'Encerrar copiloto desta sessão' some (já está encerrado)", async () => {
      estado.pollingRespostas = [
        respostaPolling({ ciclo: { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null } }),
      ];
      const { queryByRole } = await abrirComPolling();
      expect(queryByRole("button", { name: /encerrar copiloto desta sessão/i })).toBeNull();
    });

    it("axe limpo: estado de sessão encerrada por duração máxima", async () => {
      estado.pollingRespostas = [
        respostaPolling({ ciclo: { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling();
      vi.useRealTimers();
      await semViolacoes(container);
    });
  });

  /**
   * Achado do Fable na revisão desta fatia: `usePollingCopiloto` gravava
   * `erro` no estado e NENHUM lugar do componente o consumia — rede caída,
   * sessão de auth expirada ou kill-switch virado no meio da sessão faziam
   * o hook re-tentar para sempre em SILÊNCIO, e a tela ficava idêntica a
   * "sala calma". Este bloco trava as quatro partes da correção:
   *
   *  (i)   falha PERSISTENTE (3+ seguidas) vira aviso visível, com "desde
   *        HH:MM" e a garantia explícita de que a sessão segue pelo roteiro;
   *  (ii)  `copiloto_desligado` no polling PARA o polling e cai no mesmo
   *        `CopilotoDesligado` da Fatia 1 — nunca um loop de 409 a cada 3s;
   *  (iii) 1-2 falhas seguidas continuam MUDAS (B71: soluço de rede não é
   *        alarme durante uma conversa sobre herança);
   *  (iv)  axe limpo nos estados novos.
   */
  describe("achado do Fable: falha do polling não pode ser invisível", () => {
    /** Avança exatamente UM tick de polling (3s em foco) e dá ao React a
     * continuação necessária para aplicar o `setEstado` no DOM — mesmo
     * padrão de `abrirComPolling`, que já faz isto para o 1º tick. */
    async function avancarUmTick() {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(0);
    }

    it("(iii) 1 falha isolada continua MUDA — nenhum aviso aparece", async () => {
      // abrirComPolling já consome a 1ª chamada com sucesso (silêncio normal).
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("falha de rede", 0, "rede")];
      await avancarUmTick(); // 2ª chamada: falha (1ª falha consecutiva)

      expect(container.textContent).not.toContain("sem conexão");
      expect(container.querySelector('[role="status"]')?.textContent ?? "").not.toContain("sem conexão");
    });

    it("(iii) 2 falhas seguidas continuam MUDAS — o limiar é 3, não 1", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("falha 1", 0, "rede"), new ErroSessao("falha 2", 0, "rede")];
      await avancarUmTick(); // 2ª chamada: 1ª falha
      await avancarUmTick(); // 3ª chamada: 2ª falha

      expect(container.textContent).not.toContain("sem conexão");
    });

    it("(i) 3 falhas seguidas: aviso PERSISTENTE aparece, com 'desde HH:MM' e a garantia de que a sessão segue", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [
        new ErroSessao("falha 1", 0, "rede"),
        new ErroSessao("falha 2", 0, "rede"),
        new ErroSessao("falha 3", 0, "rede"),
      ];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick(); // 3ª falha consecutiva — cruza o limiar

      expect(container.textContent).toContain("Copiloto sem conexão desde");
      // O segundo período — "não perdeu a sessão, só o assistente".
      expect(container.textContent).toContain("A sessão segue normalmente pelo roteiro");
      // É aviso, não alarme jurídico: `role=status`, nunca `role=alert`.
      const aviso = Array.from(container.querySelectorAll('[role="status"]')).find((el) => el.textContent?.includes("sem conexão"));
      expect(aviso).toBeTruthy();
    });

    it("(i) o aviso SOME sozinho no próximo sucesso — sem exigir ação da advogada", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [
        new ErroSessao("falha 1", 0, "rede"),
        new ErroSessao("falha 2", 0, "rede"),
        new ErroSessao("falha 3", 0, "rede"),
      ];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick();
      expect(container.textContent).toContain("Copiloto sem conexão desde");

      // Próximo tick: sucesso (silêncio normal) — a fila de sequência está
      // vazia, então cai no `pollingRespostaPadrao`/vazio de sempre.
      await avancarUmTick();
      expect(container.textContent).not.toContain("Copiloto sem conexão");
    });

    it("(i) uma NOVA sequência de falhas depois de um sucesso recomeça do zero (não soma com a anterior)", async () => {
      const { container } = await abrirComPolling();
      // 3 falhas → aviso aparece.
      estado.pollingSequencia = [new ErroSessao("f1", 0, "rede"), new ErroSessao("f2", 0, "rede"), new ErroSessao("f3", 0, "rede")];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick();
      expect(container.textContent).toContain("Copiloto sem conexão desde");

      // 1 sucesso → aviso some.
      await avancarUmTick();
      expect(container.textContent).not.toContain("Copiloto sem conexão");

      // 1 nova falha isolada → NÃO deveria reaparecer (a contagem zerou).
      estado.pollingSequencia = [new ErroSessao("f4", 0, "rede")];
      await avancarUmTick();
      expect(container.textContent).not.toContain("Copiloto sem conexão");
    });

    it("(ii) copiloto_desligado no polling PARA o polling — nenhuma chamada depois", async () => {
      const { container } = await abrirComPolling();
      const chamadasAntes = estado.pollingChamadas.length;
      estado.pollingSequencia = [new ErroSessao("desligado em admin", 409, "copiloto_desligado")];
      await avancarUmTick();

      expect(container.textContent).toContain("Copiloto desligado");

      // Nenhuma chamada nova, mesmo avançando bastante tempo — o hook não
      // reagenda depois de detectar o kill-switch.
      await vi.advanceTimersByTimeAsync(30000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes + 1);
    });

    it("(ii) copiloto_desligado no polling cai no MESMO CopilotoDesligado da Fatia 1 — não inventa um segundo texto", async () => {
      const { container, queryByRole } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("desligado em admin", 409, "copiloto_desligado")];
      await avancarUmTick();

      expect(container.textContent).toContain("Copiloto desligado");
      expect(container.textContent).toContain("copiloto_sessao.ativo = false em Admin");
      // Todo o resto da tela (SIMs, blocos, registro manual) some — é o
      // MESMO comportamento de quando a leitura inicial já vem desligada.
      expect(queryByRole("button", { name: /registrar trecho/i })).toBeNull();
      expect(queryByRole("button", { name: /encerrar copiloto desta sessão/i })).toBeNull();
    });

    it("(ii) copiloto_desligado no polling NÃO conta como falha transiente — não mistura com o aviso de 'sem conexão'", async () => {
      const { container } = await abrirComPolling();
      // 2 falhas transientes, depois o kill-switch — o kill-switch tem
      // tratamento PRÓPRIO, não deveria virar "3ª falha" que soma ao aviso.
      estado.pollingSequencia = [
        new ErroSessao("f1", 0, "rede"),
        new ErroSessao("f2", 0, "rede"),
        new ErroSessao("desligado em admin", 409, "copiloto_desligado"),
      ];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick();

      expect(container.textContent).toContain("Copiloto desligado");
      expect(container.textContent).not.toContain("sem conexão");
    });

    it("axe limpo: aviso de falha persistente do polling (3+ falhas)", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [
        new ErroSessao("falha 1", 0, "rede"),
        new ErroSessao("falha 2", 0, "rede"),
        new ErroSessao("falha 3", 0, "rede"),
      ];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick();
      expect(container.textContent).toContain("Copiloto sem conexão desde");

      vi.useRealTimers();
      await semViolacoes(container);
    });

    it("axe limpo: copiloto_desligado detectado pelo polling", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("desligado em admin", 409, "copiloto_desligado")];
      await avancarUmTick();
      expect(container.textContent).toContain("Copiloto desligado");

      vi.useRealTimers();
      await semViolacoes(container);
    });
  });
});

/**
 * Fatia 4 do copiloto (docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2,
 * §5, §8): o bot na sala (Recall.ai) e a comparação de participantes x
 * decisores. Este bloco trava exatamente o aceite pedido:
 *
 *  1. `sala_invalida` com `sub_codigo === "meeting_not_found"` mostra
 *     mensagem ESPECÍFICA citando o link — nunca "erro ao iniciar".
 *  2. `sub_codigo` DESCONHECIDO é mostrado CRU, não engolido.
 *  3. `bot_ja_pedido` é ESTADO (idempotência), não erro — sem alarme.
 *  4. Bot não configurado (`audio_ao_vivo_desligado`/
 *     `provedor_audio_nao_configurado`) é ESTADO EXPLÍCITO, mesmo padrão
 *     de `CopilotoDesligado`.
 *  5. `ambiguos` ≠ `ausentes`: fato afirmado só para `ausentes`;
 *     `ambiguos` sempre "não foi possível confirmar", nunca "ausente".
 *  6. axe limpo nos estados novos.
 */
describe("PainelCopiloto — Fatia 4, bot na sala", () => {
  it("botão 'Pedir bot na sala' existe e pede o bot ao ser clicado", async () => {
    const { getByRole } = await abrir();
    const botao = getByRole("button", { name: /pedir bot na sala/i });
    fireEvent.click(botao);
    await waitFor(() => expect(estado.pedirBotChamadas).toBe(1));
  });

  it("sucesso: mostra que o bot foi pedido, visível para o cliente", async () => {
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Bot pedido"));
    expect(container.textContent).toContain("visível para o cliente");
  });

  it("sala_invalida com sub_codigo=meeting_not_found: mensagem ESPECÍFICA citando o link, nunca 'erro ao iniciar'", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Não encontrei uma reunião nesse link");
    expect(container.textContent).toContain("Confira o link da sala na Ficha");
    expect(container.textContent).not.toContain("erro ao iniciar");
    expect(container.textContent).not.toContain("Não foi possível pedir o bot");
  });

  it("sala_invalida com sub_codigo DESCONHECIDO: mostrado CRU, não engolido", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "bot_removed_by_admin",
    });
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    // O código cru aparece na tela — nunca escondido atrás de um genérico.
    expect(container.textContent).toContain("bot_removed_by_admin");
  });

  it("sala_invalida SEM detalhes (defesa): mensagem genérica de sala, ainda assim específica sobre o link", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Confira o link da sala");
  });

  it("bot_ja_pedido: ESTADO (idempotência), não erro — sem role=alert, sem botão de tentar de novo", async () => {
    estado.erroPedirBot = new ErroSessao("Já existe um bot pedido para esta sessão.", 409, "bot_ja_pedido");
    const { getByRole, container, queryByRole } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.textContent).toContain("Já existe um bot pedido"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(queryByRole("button", { name: /tentar de novo/i })).toBeNull();
  });

  it("audio_ao_vivo_desligado: bot não configurado é ESTADO EXPLÍCITO, mesmo padrão do CopilotoDesligado (sóbrio, sem alarme)", async () => {
    estado.erroPedirBot = new ErroSessao("Desligado.", 409, "audio_ao_vivo_desligado");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.textContent).toContain("Bot na sala ainda não configurado"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("estado normal hoje");
  });

  it("provedor_audio_nao_configurado: mesmo estado explícito de 'não configurado'", async () => {
    estado.erroPedirBot = new ErroSessao("Sem provedor.", 409, "provedor_audio_nao_configurado");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.textContent).toContain("Bot na sala ainda não configurado"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("copiloto_ao_vivo_bloqueado: erro de verdade, role=alert, mensagem própria", async () => {
    estado.erroPedirBot = new ErroSessao("Bloqueado.", 409, "copiloto_ao_vivo_bloqueado");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("Copiloto ao vivo bloqueado");
  });

  it("retencao_infinita_detectada: mensagem própria, nunca confundida com sala inválida", async () => {
    estado.erroPedirBot = new ErroSessao("Retenção infinita.", 409, "retencao_infinita_detectada");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toContain("encerrado por segurança");
  });

  it("botão não pode ser clicado duas vezes enquanto o bot é pedido", async () => {
    let resolver!: (v: { sessao_id: string; bot_id: string }) => void;
    const pendente = new Promise<{ sessao_id: string; bot_id: string }>((r) => {
      resolver = r;
    });
    const apiModulo = await import("@/components/sessao/api");
    const spy = vi.spyOn(apiModulo, "pedirBotCopiloto").mockImplementation(() => pendente);

    const { getByRole } = await abrir();
    const botao = getByRole("button", { name: /pedir bot na sala/i }) as HTMLButtonElement;
    fireEvent.click(botao);
    await waitFor(() => expect(botao.disabled).toBe(true));
    fireEvent.click(botao);

    resolver({ sessao_id: "s1", bot_id: "bot-1" });
    await waitFor(() => expect(botao.disabled).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("axe limpo: sucesso ao pedir o bot", async () => {
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Bot pedido"));
    await semViolacoes(container);
  });

  it("axe limpo: sala_invalida com sub_codigo conhecido", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    await semViolacoes(container);
  });

  it("axe limpo: bot_ja_pedido", async () => {
    estado.erroPedirBot = new ErroSessao("Já existe um bot pedido para esta sessão.", 409, "bot_ja_pedido");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Já existe um bot pedido"));
    await semViolacoes(container);
  });

  it("axe limpo: bot não configurado (estado explícito)", async () => {
    estado.erroPedirBot = new ErroSessao("Desligado.", 409, "audio_ao_vivo_desligado");
    const { getByRole, container } = await abrir();
    fireEvent.click(getByRole("button", { name: /pedir bot na sala/i }));
    await waitFor(() => expect(container.textContent).toContain("Bot na sala ainda não configurado"));
    await semViolacoes(container);
  });
});

/**
 * `ApresentacaoComparacaoDecisores` — componente PURO (Fatia 4, camada 1 do
 * §5, ZERO IA). Exportado e testado isoladamente porque, nesta entrega,
 * nenhuma rota de leitura ainda devolve `ComparacaoDecisoresPresentes` (só
 * `POST .../copiloto/bot` existe) — o componente fica pronto para o
 * chamador real assim que essa rota existir.
 */
describe("ApresentacaoComparacaoDecisores — fato participantes x decisores, sem IA", () => {
  it("apresenta como FATO, com as duas fontes visíveis (briefing x sala)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("O briefing esperava 2 decisores: Terezinha, Cleison");
    expect(container.textContent).toContain("Na sala: Terezinha");
  });

  it("ausentes: FATO afirmado diretamente — 'não entrou na sala'", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    expect(container.textContent).toContain("Não entrou na sala");
    expect(container.textContent).toContain("Cleison");
  });

  it("ambiguos: NUNCA 'ausente' — sempre 'não foi possível confirmar'", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Cleison"],
      participantes_presentes: ["Cleison Roberto"],
      presentes: [],
      ausentes: [],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("Não foi possível confirmar");
    expect(container.textContent).toContain("Cleison");
    // A palavra "ausente"/"Não entrou" NUNCA aparece para um nome ambíguo —
    // é a garantia central do achado: falso "decisor ausente" faz a
    // advogada agir errado com a família na frente dela.
    expect(container.textContent).not.toContain("Não entrou na sala");
    expect(container.textContent).not.toMatch(/ausente/i);
  });

  it("ausentes e ambiguos ao mesmo tempo: cada um com seu próprio tratamento, nunca misturados", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison", "Maria"],
      participantes_presentes: ["Terezinha", "Cleison Roberto"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Maria"],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    expect(container.textContent).toContain("Não entrou na sala");
    expect(container.textContent).toContain("Maria");
    expect(container.textContent).toContain("Não foi possível confirmar");
    expect(container.textContent).toContain("Cleison");
    // "Maria" nunca aparece na frase de ambíguo, "Cleison" nunca na de ausente.
    const blocoAusente = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.includes("Não entrou na sala"))?.parentElement;
    expect(blocoAusente?.textContent).not.toContain("Cleison");
  });

  it("sem decisores esperados: não renderiza nada (nunca um card vazio confuso)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: [],
      participantes_presentes: [],
      presentes: [],
      ausentes: [],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    expect(container.textContent).toBe("");
  });

  it("nome de participante é texto puro — nunca interpretado como HTML (defesa contra XSS via nome)", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ['<img src=x onerror="window.__pwned=true">'],
      participantes_presentes: [],
      presentes: [],
      ausentes: ['<img src=x onerror="window.__pwned=true">'],
      ambiguos: [],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);

    // O nome aparece como TEXTO — nenhum elemento <img> foi criado a partir dele.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("axe limpo: fato com ausentes e ambiguos", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison", "Maria"],
      participantes_presentes: ["Terezinha", "Cleison Roberto"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Maria"],
      ambiguos: ["Cleison"],
    };
    const { container } = montar(<ApresentacaoComparacaoDecisores comparacao={comparacao} />);
    await semViolacoes(container);
  });
});
