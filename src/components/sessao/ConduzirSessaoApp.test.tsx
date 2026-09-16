// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { Ficha360 } from "@/lib/api";
import type { RoteiroVersao } from "@/types/roteiro";
import type { EstadoSims } from "@/components/sessao/api";
import type { BlocoAtualResolvido, ComparacaoDecisoresPresentes, EstadoCopilotoComPolling } from "@/types/copiloto";
import { ErroSessao } from "@/components/sessao/api";

/**
 * Fase 12, Fatia B ("a tela vira leitura", pedido do Marcio 16/09: "a tela
 * hoje está poluída [...] preciso que essa tela seja intuitiva"). Reescrito
 * do zero sobre a base de B72 — o antigo contrato ("tudo visível na primeira
 * dobra", barra de 12 partes, 4 SIMs, briefing, oferta, perfil de consulta)
 * foi EXATAMENTE o que este pedido reverte. O que este arquivo trava agora:
 *
 *  1. A linha fina do topo (`Agora: <título>`) existe, é a ÚNICA leitura
 *     permanente do roteiro — sem barra de progresso, sem `<nav>` fixa.
 *  2. `origem === "indisponivel"`/`bloco_id === null` NUNCA vira "Parte 0"
 *     — mostra "ainda identificando…" (CLAUDE.md: nada de dado inventado).
 *  3. 🔴 Trava do plano: quando `bloco_atual_resolvido.bloco_id` vem do
 *     servidor, a linha fina usa ESSE título — nunca deriva do índice local/
 *     `sessionStorage` (que não existe mais nesta tela).
 *  4. `· Falta <nome> na sala` só aparece com decisor ausente; some por
 *     completo sem ausência.
 *  5. Erro de sala (`sala_invalida`) do bot aparece na linha fina mesmo com
 *     `PainelBot` fora da vista.
 *  6. `[Corrigir parte]` é um `<select>`, alvo `min-h-11` (44px).
 *  7. `PainelBriefingSessao`/`PainelSims`/`PainelOferta`/`BarraProgresso`/
 *     `AtalhosTeclado`/`PainelVigilanciaAoVivo`/`PainelPerfilConsulta` NÃO
 *     aparecem mais nesta tela (saíram para a Ficha 360, fora do escopo
 *     desta fatia).
 *  8. `PainelCopiloto` continua montado (dublê — tem teste próprio).
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    ficha: null as Ficha360 | null,
    roteiro: null as RoteiroVersao | null,
    sims: null as EstadoSims | null,
    pollingRespostaPadrao: null as EstadoCopilotoComPolling | null,
    pollingChamadas: [] as Array<{ bloco: number; desdeSegmento: number; desdeSugestao: number; fixadoEm?: string }>,
    erroPedirBot: null as Error | null,
  },
}));

vi.mock("@/lib/api", () => ({
  buscarFicha360: () => Promise.resolve(estado.ficha),
}));

vi.mock("@/components/sessao/api", async () => {
  const real = await vi.importActual<typeof import("@/components/sessao/api")>("@/components/sessao/api");
  return {
    ...real,
    buscarRoteiroAtivo: () => Promise.resolve(estado.roteiro),
    buscarSims: () => Promise.resolve(estado.sims),
    listarOfertas: () => Promise.resolve({ itens: [], preco: null }),
    buscarPollingCopiloto: (
      _sessaoId: string,
      parametros: { bloco: number; desdeSegmento: number; desdeSugestao: number; fixadoEm?: string },
    ) => {
      estado.pollingChamadas.push(parametros);
      return Promise.resolve(estado.pollingRespostaPadrao ?? RESPOSTA_POLLING_VAZIA(parametros));
    },
    pedirBotCopiloto: () => (estado.erroPedirBot ? Promise.reject(estado.erroPedirBot) : Promise.resolve({ sessao_id: "s1", bot_id: "bot-1" })),
  };
});

vi.mock("@/components/sessao/PainelCopiloto", () => ({
  PainelCopiloto: () => <div data-testid="stub-copiloto">Copiloto (stub)</div>,
}));

const { ConduzirSessaoApp } = await import("./ConduzirSessaoApp");

const POLLING_PADRAO = { em_foco_ms: 3000, sem_foco_ms: 10000 };

function RESPOSTA_POLLING_VAZIA(parametros: { desdeSegmento: number; desdeSugestao: number }): EstadoCopilotoComPolling {
  return {
    sessao_id: "s1",
    bloco_atual_id: null,
    falta_no_bloco: { campos: [], observar: [] },
    sims_pendentes: [],
    blocos_nao_percorridos: [],
    estado_copiloto: "aguardando",
    segmentos_novos: [],
    proximo_cursor_segmento: parametros.desdeSegmento,
    sugestoes_novas: [],
    proximo_cursor_sugestao: parametros.desdeSugestao,
    ciclo: { avaliado: true, resultado: null, motivo_bloqueio: null },
    polling: POLLING_PADRAO,
    bot: null,
    comparacao_decisores: null,
    bloco_atual_resolvido: { bloco_id: null, indice: null, titulo: null, origem: "indisponivel", confianca: null, decidido_em: null, fixacao_expira_em: null },
  };
}

function respostaComBlocoResolvido(
  overrides: Partial<BlocoAtualResolvido>,
  comparacaoDecisores: ComparacaoDecisoresPresentes | null = null,
): EstadoCopilotoComPolling {
  return {
    ...RESPOSTA_POLLING_VAZIA({ desdeSegmento: 0, desdeSugestao: 0 }),
    comparacao_decisores: comparacaoDecisores,
    bloco_atual_resolvido: {
      bloco_id: "b1",
      indice: 1,
      titulo: "PARTE 01 — Os 4 SIMs",
      origem: "inferido",
      confianca: 0.8,
      decidido_em: "2026-09-16T12:00:00Z",
      fixacao_expira_em: null,
      ...overrides,
    },
  };
}

const ROTEIRO: RoteiroVersao = {
  id: "r1",
  chave: "sessao_viabilidade",
  versao: 4,
  titulo: "Script padrão",
  ativo: true,
  notas: null,
  criado_em: "2026-01-01T00:00:00Z",
  criado_por: null,
  definicao: {
    blocos: [
      { id: "b0", titulo: "PARTE 00 — Abertura", objetivo: null, acao: null, falas: [], campos: [], observar: [], proibido: [] },
      { id: "b1", titulo: "PARTE 01 — Os 4 SIMs", objetivo: null, acao: null, falas: [], campos: [], observar: [], proibido: [] },
    ],
  },
};

const SIMS_VAZIOS: EstadoSims = { roteiro_versao_id: "r1", sims: {}, sigilo_gravacao: null };

const FICHA = {
  jornada: { id: "j1" },
  pessoa: { id: "p1", nome: "Maria Teste" },
  briefingAtual: null,
  sessao: { id: "s1", jornada_id: "j1" },
  agendamentos: [],
} as unknown as Ficha360;

async function abrir() {
  const montado = montar(<ConduzirSessaoApp jornadaId="j1" />);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return montado;
}

/**
 * `usePollingCopiloto` (linha fina do topo) só dispara o 1º ciclo depois de
 * `em_foco_ms` (3000ms reais, ver `POLLING_MS_EM_FOCO_INICIAL` no hook) —
 * sem isto, `waitFor` (timeout padrão ~1s) nunca alcançaria a 1ª resposta.
 * `vi.advanceTimersByTimeAsync` avança o relógio E deixa as microtasks da
 * promise do `fetch` mockado resolverem entre os avanços — `advanceTimersByTime`
 * puro (síncrono) não esperaria o `await buscarPollingCopiloto(...)` dentro
 * do ciclo.
 */
async function avancarPrimeiroCicloDoPolling() {
  await vi.advanceTimersByTimeAsync(3000);
}

beforeEach(() => {
  estado.ficha = FICHA;
  estado.roteiro = ROTEIRO;
  estado.sims = SIMS_VAZIOS;
  estado.pollingRespostaPadrao = null;
  estado.pollingChamadas = [];
  estado.erroPedirBot = null;
  // `shouldAdvanceTime`: os timers REAIS do ambiente (usados por `waitFor`
  // internamente) continuam correndo em paralelo — só o relógio que os
  // efeitos do componente enxergam (`Date.now`, `setTimeout` do próprio
  // `usePollingCopiloto`) é controlado por `vi.advanceTimersByTimeAsync`.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConduzirSessaoApp — linha fina do topo substitui a primeira dobra (Fase 12, Fatia B)", () => {
  it("copiloto continua montado, sem nenhum clique", async () => {
    const { container } = await abrir();
    expect(container.querySelector('[data-testid="stub-copiloto"]')).toBeTruthy();
  });

  it("sem bloco resolvido ainda: mostra 'ainda identificando…', nunca 'Parte 0' (nada de dado inventado)", async () => {
    const { container } = await abrir();
    expect(container.textContent).toContain("Agora:");
    expect(container.textContent).toContain("ainda identificando…");
    expect(container.textContent).not.toContain("Parte 0");
  });

  it("bloco resolvido pelo SERVIDOR: usa o título dele, nunca deriva do índice local", async () => {
    estado.pollingRespostaPadrao = respostaComBlocoResolvido({});
    const { container } = await abrir();
    await avancarPrimeiroCicloDoPolling();
    expect(container.textContent).toContain("PARTE 01 — Os 4 SIMs");
  });

  it("sessionStorage não existe mais nesta tela: reabrir não lê nem grava a chave antiga", async () => {
    const chave = "sic-hf:sessao:s1:parte-atual";
    window.sessionStorage.setItem(chave, "1");
    await abrir();
    // A tela não consulta mais esta chave — o valor gravado antes não muda
    // nada (prova indireta: o `bloco_atual_resolvido` do payload é quem
    // decide, e aqui ele vem `indisponivel` mesmo com a chave antiga em "1").
    const { container } = await abrir();
    expect(container.textContent).toContain("ainda identificando…");
  });

  it("decisor ausente: '· Falta <nome> na sala' aparece; sem ausência, some por completo", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha", "Cleison"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: ["Cleison"],
      ambiguos: [],
    };
    estado.pollingRespostaPadrao = respostaComBlocoResolvido({}, comparacao);
    const { container } = await abrir();
    await avancarPrimeiroCicloDoPolling();
    expect(container.textContent).toContain("Cleison não está na sala");
  });

  it("todos presentes: nenhuma menção a ausência na linha fina", async () => {
    const comparacao: ComparacaoDecisoresPresentes = {
      decisores_esperados: ["Terezinha"],
      participantes_presentes: ["Terezinha"],
      presentes: [{ nome_briefing: "Terezinha", nome_participante: "Terezinha" }],
      ausentes: [],
      ambiguos: [],
    };
    estado.pollingRespostaPadrao = respostaComBlocoResolvido({}, comparacao);
    const { container } = await abrir();
    await avancarPrimeiroCicloDoPolling();
    expect(container.textContent).toContain("PARTE 01");
    expect(container.textContent).not.toContain("não está na sala");
    expect(container.textContent).not.toContain("não estão na sala");
  });

  it("'Corrigir parte' é um <select>, nunca um botão, com alvo de toque de 44px", async () => {
    const { getByLabelText } = await abrir();
    const select = getByLabelText("Corrigir a parte atual do roteiro") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.className).toContain("min-h-11");
  });

  it("escolher 'Corrigir parte' dispara a fixação manual com bloco+fixado_em juntos (nunca bloco sozinho)", async () => {
    const { getByLabelText } = await abrir();
    const select = getByLabelText("Corrigir a parte atual do roteiro") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() => {
      const chamadaComFixacao = estado.pollingChamadas.find((c) => c.fixadoEm);
      expect(chamadaComFixacao).toBeTruthy();
      expect(chamadaComFixacao?.bloco).toBe(1);
    });
  });

  /**
   * Defeito 1 do Fable (16/09) — "dois ponteiros na mesma linha, discordando":
   * o `<select>` refletia `indiceAtual` da TELA, nunca sincronizado com
   * `bloco_atual_resolvido.indice` do servidor. Prova: quando o servidor
   * resolve o bloco 1, o `<select>` mostra a opção 1 selecionada — nunca a 0
   * "de fábrica" enquanto a linha "Agora:" já diz outra coisa.
   */
  it("o <select> segue o índice que o SERVIDOR resolveu — nunca fica preso no índice antigo da tela", async () => {
    estado.pollingRespostaPadrao = respostaComBlocoResolvido({});
    const { getByLabelText, container } = await abrir();
    await avancarPrimeiroCicloDoPolling();
    expect(container.textContent).toContain("PARTE 01 — Os 4 SIMs");
    await waitFor(() => {
      const select = getByLabelText("Corrigir a parte atual do roteiro") as HTMLSelectElement;
      expect(select.value).toBe("1");
    });
  });

  /**
   * Defeito 1(b) do Fable — "é impossível corrigir para a parte 0 numa tela
   * recém-aberta": o `<select>` nascia com `value={0}` e escolher a opção já
   * selecionada não disparava `onChange` (o DOM só dispara `change` quando o
   * VALOR muda). Prova: a tela abre no índice 0 (nenhum bloco resolvido
   * ainda) e escolher explicitamente "00 — Abertura" tem que fixar mesmo
   * assim.
   */
  it("escolher a parte 0 numa tela recém-aberta funciona (antes o índice já preso em 0 matava o onChange)", async () => {
    const { getByLabelText } = await abrir();
    const select = getByLabelText("Corrigir a parte atual do roteiro") as HTMLSelectElement;
    expect(select.value).toBe("0");
    fireEvent.change(select, { target: { value: "0" } });
    await waitFor(() => {
      const chamadaComFixacao = estado.pollingChamadas.find((c) => c.fixadoEm);
      expect(chamadaComFixacao).toBeTruthy();
      expect(chamadaComFixacao?.bloco).toBe(0);
    });
  });

  /**
   * Defeito 2 do Fable — "'Fixado até' mente depois que expira": o estado
   * local (`fixadoAte`) era gravado no clique e nunca zerado; passados os
   * 300s o servidor volta a `origem !== "fixado_manualmente"`, mas a frase
   * continuava mostrando um horário do PASSADO, para sempre. Prova: com
   * fixação ativa a frase aparece; assim que o próximo ciclo do servidor
   * traz `origem: "inferido"` (fixação expirada), a frase some por completo.
   */
  it("'Fixado por você até' aparece com a fixação ativa e some quando o servidor expira a fixação", async () => {
    estado.pollingRespostaPadrao = respostaComBlocoResolvido({
      origem: "fixado_manualmente",
      fixacao_expira_em: "2026-09-16T12:05:00Z",
    });
    const { container } = await abrir();
    await avancarPrimeiroCicloDoPolling();
    expect(container.textContent).toContain("Fixado por você até");

    estado.pollingRespostaPadrao = respostaComBlocoResolvido({ origem: "inferido", fixacao_expira_em: null });
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(container.textContent).not.toContain("Fixado por você até"));
  });

  /**
   * Defeito 3 do Fable — "polling dobrou, e um dos dois nunca para":
   * `LinhaFinaRoteiro` instanciava a própria cópia de `usePollingCopiloto`
   * (`sessaoEncerrada` fixo em `false`) e `PainelCopiloto` instanciava outra
   * — 2 requisições a cada tick, e a da linha fina nunca parava depois de
   * "Encerrar copiloto". Prova: um único ciclo do relógio produz UMA única
   * chamada de polling (não duas), porque as duas partes da tela agora leem
   * o MESMO `usePollingCopiloto` elevado a `ConduzirSessaoApp`.
   */
  it("um único poller: um ciclo do relógio dispara UMA chamada de polling, não duas", async () => {
    await abrir();
    const chamadasAntes = estado.pollingChamadas.length;
    await avancarPrimeiroCicloDoPolling();
    expect(estado.pollingChamadas.length - chamadasAntes).toBe(1);
  });

  it("erro de sala (meeting_not_found) aparece na linha fina mesmo com PainelBot fora da vista", async () => {
    estado.erroPedirBot = new ErroSessao("Não foi possível entrar na sala.", 409, "sala_invalida", {
      codigo: "fatal",
      sub_codigo: "meeting_not_found",
    });
    const { getByRole, container } = await abrir();
    // `PainelBot` está oculto (`display:none`), mas o botão continua no DOM
    // — é assim que o efeito roda sem ocupar pixel.
    const botao = getByRole("button", { name: /pedir bot na sala/i });
    fireEvent.click(botao);
    await waitFor(() => expect(container.textContent).toContain("Não entrou na sala"));
  });

  it("componentes removidos desta tela (Fase 12, Fatia B) não aparecem mais: sem barra de progresso, sem 4 SIMs, sem briefing, sem nav fixa", async () => {
    const { container, queryByRole } = await abrir();
    expect(container.querySelector('nav[aria-label="Navegar entre partes"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="Partes da Sessão de Viabilidade"]')).toBeNull();
    expect(container.textContent).not.toContain("Anotação da parte atual");
    expect(container.textContent).not.toContain("Briefing Estratégico");
    expect(queryByRole("progressbar")).toBeNull();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir();
    await semViolacoes(container);
  });
});
