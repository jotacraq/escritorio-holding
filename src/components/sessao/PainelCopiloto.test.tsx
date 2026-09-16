// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type {
  DesfechoCopiloto,
  EstadoCopiloto,
  EstadoCopilotoComPolling,
  RespostaDesfechoCopiloto,
  RespostaEncerrarCopiloto,
  RespostaSegmentos,
  RespostaSugestaoCopiloto,
  SugestaoCopiloto,
  SugestaoCopilotoPolling,
} from "@/types/copiloto";
import { ErroSessao } from "@/components/sessao/api";

/**
 * Fase 12, Fatia B ("a tela vira leitura") — reescrito sobre a base da
 * Fatia 1 do copiloto. `PainelCopiloto` deixou de ser um mosaico de 7
 * quadros numerados e virou 2 blocos permanentes ("Fale agora", "O cliente
 * disse") + 1 condicional ("Cuidado", funde SIMs pendentes + falta no bloco
 * + desvio sugerido — só existe no DOM com risco real).
 *
 * O que MIGROU para arquivo próprio (mesma trava, testes movidos, nenhum
 * apagado): `PainelBot`/`MensagemRecusaBot` → `copiloto/PainelBot.test.tsx`;
 * `ApresentacaoComparacaoDecisores`/`resumoAusentesLinhaFina` →
 * `copiloto/ApresentacaoComparacaoDecisores.test.tsx`; `RegistroManual`
 * (unidade por prop) → `copiloto/RegistroManual.test.tsx` — a integração com
 * o clique real em "Encerrar copiloto desta sessão" continua aqui, porque
 * `EncerrarCopiloto` é quem dispara `sessaoEncerrada`.
 *
 * Este arquivo trava exatamente as garantias que sobrevivem na tela ao vivo:
 *
 *  1. "Fale agora" é o ÚNICO elemento com peso — a pergunta do ciclo
 *     automático ou da IA sob demanda, nunca inventado além do payload.
 *  2. "Cuidado" é CONDICIONAL: sem risco (sem SIM pendente, sem falta no
 *     bloco, sem desvio sugerido, sem observação crítica), NÃO EXISTE NO
 *     DOM — provado por `offsetParent`, nunca por `e.hidden`.
 *  3. Erro de rede/HTTP na leitura tem tratamento visível (nunca tela muda).
 *  4. "O cliente disse" registra o trecho e ele aparece na lista.
 *  5. Kill-switch (`copiloto_sessao.ativo=false`, HTTP 409
 *     `copiloto_desligado`) é ESTADO, não FALHA — `EstadoVazio`, nunca
 *     `EstadoErro` com "tentar de novo". Detectado só pelo `codigo`.
 *  6. Avançar bloco NÃO é possível pela tela (a barra/nav manual saiu de
 *     `ConduzirSessaoApp.tsx`; aqui a prova é que `PainelCopiloto` nunca
 *     desenha um controle de navegação próprio).
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
  };
});

/** `resposta.polling` default do mock — mesmos valores default que o
 * servidor grava na 0091 (`em_foco_ms: 3000`, `sem_foco_ms: 10000`). */
const POLLING_PADRAO = { em_foco_ms: 3000, sem_foco_ms: 10000 };

/** Resposta de polling "silêncio normal": ciclo avaliado, nada novo — é o
 * caso mais comum (§4.1: "a maioria vem vazia"). */
function RESPOSTA_POLLING_VAZIA(parametros: { desdeSegmento: number; desdeSugestao: number }): EstadoCopilotoComPolling {
  return {
    ...ESTADO_BASE,
    segmentos_novos: [],
    proximo_cursor_segmento: parametros.desdeSegmento,
    sugestoes_novas: [],
    proximo_cursor_sugestao: parametros.desdeSugestao,
    ciclo: { avaliado: true, resultado: null, motivo_bloqueio: null },
    polling: POLLING_PADRAO,
    bot: null,
    comparacao_decisores: null,
  };
}

/** Monta uma `EstadoCopilotoComPolling` completa a partir só do que o teste
 * precisa variar. */
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

const { PainelCopiloto, ultimoNaoNulo } = await import("./PainelCopiloto");

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

const BLOCOS_ROTEIRO = [
  { id: "b1", titulo: "PARTE 01 — Abertura" },
  { id: "b2", titulo: "PARTE 02 — Diagnóstico" },
  { id: "b3", titulo: "PARTE 03 — Radiografia" },
];

async function abrir() {
  const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} />);
  // Achado do Fable (teste instável): `waitFor` espera a CONDIÇÃO real (o
  // `role=status` de carregamento sumir), não um número de ticks.
  await waitFor(() => {
    expect(montado.queryByText("Carregando o copiloto…")).toBeNull();
  });
  return montado;
}

async function abrirComRoteiro(irPara?: (i: number) => void) {
  const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} blocosRoteiro={BLOCOS_ROTEIRO} irPara={irPara} />);
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
});

describe("PainelCopiloto", () => {
  it("Fale agora mostra a pergunta pedida, sem inventar nada além do payload", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));
    await waitFor(() => expect(container.textContent).toContain("Quem mais participa das decisões financeiras"));
    expect(container.textContent).toContain("Fale agora");
  });

  it("Cuidado mostra as pendências por extenso (tradução de 'SIMs pendentes')", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("Cuidado");
    expect(container.textContent).toContain("Falta: Decisores presentes");
    expect(container.textContent).toContain("Falta: Próximo passo");
  });

  it("Cuidado mostra 'Ainda não perguntou:' (tradução de 'falta no bloco'), nunca o jargão antigo", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("Ainda não perguntou:");
    expect(container.textContent).toContain("Objeção principal");
    expect(container.textContent).not.toContain("Falta neste bloco");
    expect(container.textContent).not.toContain("O que aconteceu");
  });

  it("sem risco nenhum: o bloco Cuidado NÃO EXISTE NO DOM (offsetParent, nunca e.hidden)", async () => {
    estado.copiloto = {
      ...ESTADO_BASE,
      falta_no_bloco: { campos: [], observar: [] },
      sims_pendentes: [],
    };
    estado.pollingRespostaPadrao = respostaPolling({ comparacao_decisores: null });
    const { container, queryByText } = await abrir();

    // Nem o texto "Cuidado" aparece — o bloco não existe, não está só
    // escondido por CSS. `offsetParent` é a prova real: um `e.hidden` ou
    // `display:none` no PAI daria falso verde num filho "visível".
    const rotuloCuidado = queryByText("Cuidado");
    expect(rotuloCuidado === null || (rotuloCuidado as HTMLElement).offsetParent === null || !container.contains(rotuloCuidado)).toBe(true);
    expect(container.textContent).not.toContain("Cuidado");
  });

  it("sem bloco atual: estado vazio explícito no bloco Cuidado, nunca listas fantasmas", async () => {
    estado.copiloto = { ...ESTADO_BASE, bloco_atual_id: null, falta_no_bloco: { campos: [], observar: [] } };
    const { container } = await abrir();
    // SIMs pendentes continuam presentes no payload — o bloco existe por
    // causa deles; a ausência de bloco atual não é mais um card próprio
    // (o antigo "Sem roteiro ativo" migrou para a linha fina do topo, em
    // `ConduzirSessaoApp.tsx`, que lê `bloco_atual_resolvido`).
    expect(container.textContent).toContain("Cuidado");
  });

  it("todos os SIMs registrados e sem falta no bloco: Cuidado não existe no DOM", async () => {
    estado.copiloto = { ...ESTADO_BASE, sims_pendentes: [], falta_no_bloco: { campos: [], observar: [] } };
    estado.pollingRespostaPadrao = respostaPolling({ comparacao_decisores: null });
    const { container } = await abrir();
    expect(container.textContent).not.toContain("Cuidado");
  });

  it("erro HTTP ao carregar o estado: tratamento visível, com tentar de novo", async () => {
    // EstadoErro (DS) só lê mensagem específica de `ApiError` (lib/api/nucleo.ts);
    // `ErroSessao` (esta área) cai no fallback genérico — mesmo comportamento já
    // em uso por `ConduzirSessaoApp.tsx`. O que se trava aqui é que a FALHA
    // aparece (role=alert + botão de retentar), nunca uma tela muda.
    estado.erroCopiloto = new ErroSessao("Sessão de Viabilidade não encontrada.", 404, "nao_encontrado");
    const { container, getByRole } = await abrir();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("Não foi possível carregar o copiloto");
    expect(getByRole("button", { name: /tentar de novo/i })).toBeTruthy();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir();
    await semViolacoes(container);
  });

  it("avançar bloco não é possível pela tela — PainelCopiloto nunca desenha controle de navegação próprio", async () => {
    // A barra de progresso/nav manual saiu de `ConduzirSessaoApp.tsx`
    // (Fase 12, Fatia B) — aqui a prova é que este componente, sozinho,
    // nunca oferece "Próxima"/"Anterior"/número de parte clicável. O único
    // botão que navega é o de um DESVIO SUGERIDO explícito, que exige
    // `irPara` e é sempre uma sugestão, nunca navegação livre.
    const { queryByRole } = await abrir();
    expect(queryByRole("button", { name: /próxima/i })).toBeNull();
    expect(queryByRole("button", { name: /anterior/i })).toBeNull();
    expect(queryByRole("navigation", { name: /partes da sessão/i })).toBeNull();
  });
});

describe("PainelCopiloto — kill-switch (copiloto_sessao.ativo=false)", () => {
  it("copiloto_desligado: mostra o estado desligado, NUNCA o estado de erro", async () => {
    estado.erroCopiloto = new ErroSessao("Desligado em Admin.", 409, "copiloto_desligado");
    const { container } = await abrir();
    expect(container.textContent).toContain("Copiloto desligado");
    expect(container.textContent).toContain("Desligado por configuração em Admin");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("copiloto_desligado: distingue por codigo, não por status 409 isolado nem pela mensagem", async () => {
    // Mesmo status (409) e mensagem parecida, código DIFERENTE — não pode
    // cair no estado desligado.
    estado.erroCopiloto = new ErroSessao("Sessão do copiloto já foi encerrada.", 409, "sessao_ja_encerrada");
    const { container, getByRole } = await abrir();
    expect(container.textContent).not.toContain("Copiloto desligado");
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(getByRole("button", { name: /tentar de novo/i })).toBeTruthy();
  });

  it("copiloto_desligado ao registrar um trecho: mensagem de estado, não de falha genérica", async () => {
    estado.erroRegistrar = new ErroSessao("Desligado em Admin.", 409, "copiloto_desligado");
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
    estado.erroCopiloto = new ErroSessao("Desligado em Admin.", 409, "copiloto_desligado");
    const { container } = await abrir();
    await semViolacoes(container);
  });
});

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

    await waitFor(() => expect(container.textContent).toContain("Confiança abaixo do mínimo"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Próxima pergunta");
  });

  it("mesmo com visivel:false E sugestao preenchida no payload, a tela NUNCA mostra a sugestão", async () => {
    estado.sugestaoResposta = { sugestao_id: "sug-1", gatilho: "sob_demanda", confianca_geral: 0.3, visivel: false, sugestao: SUGESTAO_COMPLETA };
    const { getByRole, container } = await abrirComRoteiro();
    fireEvent.click(getByRole("button", { name: /me ajuda agora/i }));

    await waitFor(() => expect(container.textContent).toContain("Confiança abaixo do mínimo"));
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
    expect(irParaMock).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: /ir para lá/i }));
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

    expect(irParaMock).toHaveBeenCalledWith(1);
    expect(container.textContent).not.toContain("Sugestão de desvio");
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
    const apiModulo = await import("@/components/sessao/api");
    const spy = vi.spyOn(apiModulo, "pedirSugestaoCopiloto").mockImplementation(() => pendente);

    const { getByRole } = await abrirComRoteiro();
    const botao = getByRole("button", { name: /me ajuda agora/i }) as HTMLButtonElement;
    fireEvent.click(botao);
    await waitFor(() => expect(botao.disabled).toBe(true));
    fireEvent.click(botao);

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
    await waitFor(() => expect(container.textContent).toContain("Confiança abaixo do mínimo"));
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
 * automático roda sozinho e a tela busca novidade por polling.
 */
describe("PainelCopiloto — Fatia 3, ciclo automático e polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function abrirComPolling(props: { blocosRoteiro?: { id: string }[]; irPara?: (i: number) => void } = {}) {
    const montado = montar(<PainelCopiloto sessaoId="s1" indiceAtual={1} {...props} />);
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

    expect(estado.pollingChamadas[0]).toEqual({ bloco: 1, desdeSegmento: 0, desdeSugestao: 0 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(estado.pollingChamadas[1]).toEqual({ bloco: 1, desdeSegmento: 12, desdeSugestao: 5 });
  });

  it("intervalo sobe para 10s quando a aba perde o foco (document.visibilityState)", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      await abrirComPolling();
      const chamadasAntes = estado.pollingChamadas.length;

      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes);

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
    expect(container.textContent).toContain("bloqueado por configuração no servidor");
  });

  it("silêncio normal (resultado=null) NÃO mostra nenhum aviso de bloqueio", async () => {
    estado.pollingRespostaPadrao = RESPOSTA_POLLING_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 });
    const { container } = await abrirComPolling();
    expect(container.textContent).not.toContain("Copiloto de IA parado");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("sugestão nova do ciclo automático aparece ABERTA, sem nenhum clique (correção do Marcio, 14/09)", async () => {
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
    const { container, queryByRole } = await abrirComPolling();

    expect(container.textContent).toContain("Quem mais participa das decisões financeiras");
    expect(queryByRole("button", { name: /ver sugestão/i })).toBeNull();
  });

  it("sugestão mais recente substitui a anterior NO MESMO LUGAR; a anterior vai para o histórico recolhido", async () => {
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
    const { container, getByText } = await abrirComPolling();

    expect(container.textContent).toContain("Quem mais participa das decisões financeiras");

    estado.pollingRespostaPadrao = respostaPolling({ sugestoes_novas: [sugestao2], proximo_cursor_sugestao: 2, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } });
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);

    expect(container.textContent).toContain("Segunda observação distinta.");

    const historico = container.querySelector("details");
    expect(historico).toBeTruthy();
    expect(historico?.hasAttribute("open")).toBe(false);
    expect(historico?.textContent).toContain("Quem mais participa das decisões financeiras");
    expect(container.textContent).toContain("1 sugestão anterior");

    fireEvent.click(getByText("1 sugestão anterior"));
    expect(historico?.hasAttribute("open")).toBe(true);
  });

  /**
   * Achado de 15/09 (obrigatório, memória viva do bug): os campos do bloco
   * "Cuidado" liam sempre `sugestoesCiclo[length - 1]` — se a sugestão nova
   * não trazia aquele campo, o valor que já estava na tela era apagado
   * sozinho no meio da reunião. `ultimoNaoNulo` corrige isso.
   */
  describe("achado de 15/09: sugestão nova sem campo não apaga o valor anterior (persistência)", () => {
    it("sugestão nova sem observação crítica NÃO apaga a observação anterior (tipo='inferencia')", async () => {
      const comInsight = {
        sugestao_id: "sug-insight-1",
        ordem_evento: 1,
        gatilho: "intervalo" as const,
        confianca_geral: 0.8,
        visivel: true,
        sugestao: SUGESTAO_COMPLETA, // observacao.tipo === "inferencia"
        desfecho: null,
        criado_em: new Date().toISOString(),
      };
      estado.pollingRespostas = [
        respostaPolling({ sugestoes_novas: [comInsight], proximo_cursor_sugestao: 1, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling();
      expect(container.textContent).toContain("A cliente pode estar adiando a decisão");

      const sugestaoFato: SugestaoCopiloto = {
        proxima_pergunta: null,
        falta_no_bloco: [],
        observacao: { tipo: "fato", texto: "Texto de fato, não é crítico.", evidencia: null, confianca: 0.9 },
        desvio_sugerido: null,
        confianca_geral: 0.9,
        campos_evidencia_nao_conferida: [],
      };
      const semInsight = { ...comInsight, sugestao_id: "sug-insight-2", ordem_evento: 2, sugestao: sugestaoFato };
      estado.pollingRespostaPadrao = respostaPolling({ sugestoes_novas: [semInsight], proximo_cursor_sugestao: 2, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } });
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(0);

      // A observação crítica da 1ª sugestão continua na tela (dentro do
      // bloco "Cuidado") — não foi apagada pela 2ª, que era só um fato.
      expect(container.textContent).toContain("A cliente pode estar adiando a decisão");
      expect(container.textContent).toContain("Cuidado");
    });

    it("espelho para desvio_sugerido: sugestão nova sem desvio NÃO apaga o desvio anterior", async () => {
      const comDesvio = {
        sugestao_id: "sug-desvio-1",
        ordem_evento: 1,
        gatilho: "intervalo" as const,
        confianca_geral: 0.8,
        visivel: true,
        sugestao: SUGESTAO_COMPLETA, // tem desvio_sugerido para bloco b2
        desfecho: null,
        criado_em: new Date().toISOString(),
      };
      estado.pollingRespostas = [
        respostaPolling({ sugestoes_novas: [comDesvio], proximo_cursor_sugestao: 1, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling({ blocosRoteiro: BLOCOS_ROTEIRO });
      expect(container.textContent).toContain("A radiografia patrimonial não depende do decisor ausente.");

      const sugestaoSemDesvio: SugestaoCopiloto = {
        proxima_pergunta: null,
        falta_no_bloco: [],
        observacao: null,
        desvio_sugerido: null,
        confianca_geral: 0.5,
        campos_evidencia_nao_conferida: [],
      };
      const semDesvio = { ...comDesvio, sugestao_id: "sug-desvio-2", ordem_evento: 2, sugestao: sugestaoSemDesvio };
      estado.pollingRespostaPadrao = respostaPolling({ sugestoes_novas: [semDesvio], proximo_cursor_sugestao: 2, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } });
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(0);

      // O desvio continua visível no bloco Cuidado.
      expect(container.textContent).toContain("A radiografia patrimonial não depende do decisor ausente.");
    });

    it("carimbo de hora aparece quando o valor exibido vem de uma sugestão que não é a mais recente", async () => {
      const comInsight = {
        sugestao_id: "sug-carimbo-1",
        ordem_evento: 1,
        gatilho: "intervalo" as const,
        confianca_geral: 0.8,
        visivel: true,
        sugestao: SUGESTAO_COMPLETA,
        desfecho: null,
        criado_em: "2026-09-15T10:00:00.000Z",
      };
      estado.pollingRespostas = [
        respostaPolling({ sugestoes_novas: [comInsight], proximo_cursor_sugestao: 1, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling();
      expect(container.textContent).not.toContain("Registrado às");

      const sugestaoFato: SugestaoCopiloto = {
        proxima_pergunta: null,
        falta_no_bloco: [],
        observacao: { tipo: "fato", texto: "Segunda sugestão, sem observação crítica.", evidencia: null, confianca: 0.9 },
        desvio_sugerido: null,
        confianca_geral: 0.9,
        campos_evidencia_nao_conferida: [],
      };
      const semInsight = { ...comInsight, sugestao_id: "sug-carimbo-2", ordem_evento: 2, sugestao: sugestaoFato, criado_em: "2026-09-15T10:05:00.000Z" };
      estado.pollingRespostaPadrao = respostaPolling({ sugestoes_novas: [semInsight], proximo_cursor_sugestao: 2, ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null } });
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(0);

      expect(container.textContent).toContain("Registrado às");
    });
  });

  it("sessao_ja_encerrada (clique duplo em Encerrar) não vira erro visível — trata como sucesso", async () => {
    estado.erroEncerrar = new ErroSessao("Esta sessão do copiloto já está encerrada.", 409, "sessao_ja_encerrada");
    const { container, getByRole } = await abrirComPolling();
    fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(container.textContent).toContain("Copiloto encerrado"));
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
    vi.useRealTimers();
    await semViolacoes(container);
  });

  it("axe limpo: sugestão nova do ciclo, gatilho virada_bloco", async () => {
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

  it("axe limpo: card de sugestão do ciclo, visível sem clique", async () => {
    estado.pollingRespostas = [
      respostaPolling({
        sugestoes_novas: [
          { sugestao_id: "sug-y", ordem_evento: 1, gatilho: "intervalo", confianca_geral: 0.7, visivel: true, sugestao: SUGESTAO_COMPLETA, desfecho: null, criado_em: new Date().toISOString() },
        ],
        proximo_cursor_sugestao: 1,
        ciclo: { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null },
      }),
    ];
    const { container } = await abrirComPolling();
    vi.useRealTimers();
    await semViolacoes(container);
  });

  it("axe limpo: tela pós-encerramento", async () => {
    const { container, getByRole } = await abrirComPolling();
    fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(container.textContent).toContain("Copiloto encerrado"));
    vi.useRealTimers();
    await semViolacoes(container);
  });

  describe("intervalo mandado pelo servidor + encerramento por duração máxima", () => {
    it("usa o em_foco_ms da resposta do servidor, não a constante do front", async () => {
      estado.pollingRespostaPadrao = respostaPolling({ polling: { em_foco_ms: 5000, sem_foco_ms: 20000 } });
      await abrirComPolling();
      const chamadasAntes = estado.pollingChamadas.length;

      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes);

      await vi.advanceTimersByTimeAsync(2000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes + 1);
    });

    it("mudança de em_foco_ms entre respostas reajusta o timer no tick seguinte, sem recriar o ciclo nem perder cursor", async () => {
      estado.pollingRespostas = [
        respostaPolling({ proximo_cursor_segmento: 7, proximo_cursor_sugestao: 3, polling: { em_foco_ms: 3000, sem_foco_ms: 10000 } }),
      ];
      estado.pollingRespostaPadrao = respostaPolling({ proximo_cursor_segmento: 7, proximo_cursor_sugestao: 3, polling: { em_foco_ms: 9000, sem_foco_ms: 30000 } });

      await abrirComPolling();
      expect(estado.pollingChamadas).toHaveLength(1);
      expect(estado.pollingChamadas[0]).toEqual({ bloco: 1, desdeSegmento: 0, desdeSugestao: 0 });

      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas).toHaveLength(2);
      expect(estado.pollingChamadas[1]).toEqual({ bloco: 1, desdeSegmento: 7, desdeSugestao: 3 });

      await vi.advanceTimersByTimeAsync(3000);
      expect(estado.pollingChamadas).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(6000);
      expect(estado.pollingChamadas).toHaveLength(3);
      expect(estado.pollingChamadas[2]).toEqual({ bloco: 1, desdeSegmento: 7, desdeSugestao: 3 });
    });

    it("sessao_encerrada_por_duracao_maxima: estado EXPLÍCITO, distinto do encerramento manual", async () => {
      estado.pollingRespostas = [
        respostaPolling({ ciclo: { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null } }),
      ];
      const { container } = await abrirComPolling();

      expect(container.textContent).toContain("Copiloto encerrado por tempo máximo");
      expect(container.textContent).not.toContain("Copiloto encerrado — transcrição consolidada, sem novas sugestões.");
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

  describe("achado do Fable: falha do polling não pode ser invisível", () => {
    async function avancarUmTick() {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(0);
    }

    it("(iii) 1 falha isolada continua MUDA — nenhum aviso aparece", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("falha de rede", 0, "rede")];
      await avancarUmTick();

      expect(container.textContent).not.toContain("sem conexão");
      expect(container.querySelector('[role="status"]')?.textContent ?? "").not.toContain("sem conexão");
    });

    it("(iii) 2 falhas seguidas continuam MUDAS — o limiar é 3, não 1", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("falha 1", 0, "rede"), new ErroSessao("falha 2", 0, "rede")];
      await avancarUmTick();
      await avancarUmTick();

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
      await avancarUmTick();

      expect(container.textContent).toContain("Copiloto sem conexão desde");
      expect(container.textContent).toContain("A sessão segue pelo roteiro");
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

      await avancarUmTick();
      expect(container.textContent).not.toContain("Copiloto sem conexão");
    });

    it("(i) uma NOVA sequência de falhas depois de um sucesso recomeça do zero (não soma com a anterior)", async () => {
      const { container } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("f1", 0, "rede"), new ErroSessao("f2", 0, "rede"), new ErroSessao("f3", 0, "rede")];
      await avancarUmTick();
      await avancarUmTick();
      await avancarUmTick();
      expect(container.textContent).toContain("Copiloto sem conexão desde");

      await avancarUmTick();
      expect(container.textContent).not.toContain("Copiloto sem conexão");

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

      await vi.advanceTimersByTimeAsync(30000);
      expect(estado.pollingChamadas.length).toBe(chamadasAntes + 1);
    });

    it("(ii) copiloto_desligado no polling cai no MESMO CopilotoDesligado da Fatia 1 — não inventa um segundo texto", async () => {
      const { container, queryByRole } = await abrirComPolling();
      estado.pollingSequencia = [new ErroSessao("desligado em admin", 409, "copiloto_desligado")];
      await avancarUmTick();

      expect(container.textContent).toContain("Copiloto desligado");
      expect(container.textContent).toContain("Desligado por configuração em Admin");
      expect(queryByRole("button", { name: /registrar trecho/i })).toBeNull();
      expect(queryByRole("button", { name: /encerrar copiloto desta sessão/i })).toBeNull();
    });

    it("(ii) copiloto_desligado no polling NÃO conta como falha transiente — não mistura com o aviso de 'sem conexão'", async () => {
      const { container } = await abrirComPolling();
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

  /**
   * Achado do Fable (Fatia 5): `RegistroManual` (bloco "O cliente disse")
   * era renderizado INCONDICIONALMENTE, mesmo depois de a sessão encerrar.
   * A INTEGRAÇÃO com o clique real em "Encerrar" continua aqui — a unidade
   * por prop está em `copiloto/RegistroManual.test.tsx`.
   */
  describe("achado do Fable: 'O cliente disse' não pode continuar aberto depois do encerramento", () => {
    it("encerramento MANUAL (sessaoEncerrada local): esconde o formulário, mostra mensagem explícita", async () => {
      const { container, getByRole, queryByRole } = await abrirComPolling();

      fireEvent.click(getByRole("button", { name: /encerrar copiloto desta sessão/i }));
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(getByRole("button", { name: /^encerrar$/i }));
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(container.textContent).toContain("Copiloto encerrado"));

      expect(queryByRole("button", { name: /registrar trecho/i })).toBeNull();
      expect(queryByRole("textbox", { name: /trecho da fala/i })).toBeNull();
      expect(container.textContent).toContain("Sessão encerrada — transcrição consolidada, sem novos trechos.");
    });

    it("estado_copiloto='encerrado' DO SERVIDOR (sobrevive a F5): esconde o formulário mesmo numa abertura fresca da tela", async () => {
      estado.copiloto = { ...ESTADO_BASE, estado_copiloto: "encerrado" };
      const { container, queryByRole } = await abrirComPolling();

      expect(queryByRole("button", { name: /registrar trecho/i })).toBeNull();
      expect(queryByRole("textbox", { name: /trecho da fala/i })).toBeNull();
      expect(container.textContent).toContain("Sessão encerrada — transcrição consolidada");
    });

    it("sessão em andamento (estado_copiloto='ativo', sem sessaoEncerrada local): formulário continua disponível", async () => {
      estado.copiloto = { ...ESTADO_BASE, estado_copiloto: "ativo" };
      const { getByRole } = await abrirComPolling();

      expect(getByRole("button", { name: /registrar trecho/i })).toBeTruthy();
      expect(getByRole("textbox", { name: /trecho da fala/i })).toBeTruthy();
    });

    it("axe limpo: campo de registro manual bloqueado por sessão encerrada (estado do servidor)", async () => {
      estado.copiloto = { ...ESTADO_BASE, estado_copiloto: "encerrado" };
      const { container } = await abrirComPolling();
      vi.useRealTimers();
      await semViolacoes(container);
    });
  });
});

/**
 * `ultimoNaoNulo` — função pura (achado de 15/09, obrigatória para o bloco
 * "Cuidado" não apagar dado sozinho). Testes puros movidos para
 * `copiloto/ultimoNaoNulo.test.ts` junto com a extração da função; este
 * describe fica só como ponte de reexportação (o teste consome direto
 * deste arquivo, prova que `export { ultimoNaoNulo }` funciona).
 */
describe("ultimoNaoNulo — reexportado por PainelCopiloto.tsx", () => {
  it("continua acessível via import direto de PainelCopiloto.tsx (compat de quem já importava daqui)", () => {
    const sugestoes: SugestaoCopilotoPolling[] = [
      { ordem_evento: 0, gatilho: "intervalo", confianca_geral: 0.8, sugestao: null, desfecho: null, criado_em: new Date().toISOString(), sugestao_id: "a", visivel: true },
    ];
    expect(ultimoNaoNulo(sugestoes, () => "x")).toEqual({ valor: "x", sugestaoId: "a", criadoEm: sugestoes[0].criado_em });
  });
});
