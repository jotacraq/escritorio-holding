// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { EstadoCopiloto, RespostaSegmentos } from "@/types/copiloto";
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
