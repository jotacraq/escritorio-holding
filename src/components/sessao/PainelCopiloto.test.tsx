// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { DesfechoCopiloto, EstadoCopiloto, RespostaDesfechoCopiloto, RespostaSegmentos, RespostaSugestaoCopiloto, SugestaoCopiloto } from "@/types/copiloto";
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
  };
});

const { PainelCopiloto } = await import("./PainelCopiloto");

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
  // `useRecurso` resolve numa continuação de microtask; dois turnos bastam
  // (mesmo padrão de AgenteWhatsappAba.test.tsx).
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
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
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
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
