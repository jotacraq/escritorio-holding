// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { RespostaSegmentos } from "@/types/copiloto";
import { ErroSessao } from "@/components/sessao/api";
import { RegistroManual } from "./RegistroManual";

/**
 * Movido/adaptado de `PainelCopiloto.test.tsx` na Fase 12, Fatia B (tela
 * vira leitura) — `RegistroManual` (bloco 3 "O cliente disse") foi extraído
 * para arquivo próprio. Testes de UNIDADE do componente por prop
 * (`sessaoEncerrada`); a INTEGRAÇÃO com o clique real em "Encerrar copiloto
 * desta sessão" (que ainda mora em `PainelCopiloto.tsx`, dono do
 * `EncerrarCopiloto`) continua provada em `PainelCopiloto.test.tsx` — a
 * trava vale nos dois lugares, sem duplicar a mesma asserção duas vezes.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
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

beforeEach(() => {
  estado.segmentos = { itens: [], proximo_cursor: 0 };
  estado.erroSegmentos = null;
  estado.registrarChamadas = [];
  estado.erroRegistrar = null;
});

describe("RegistroManual — bloco 'O cliente disse'", () => {
  it("registra um trecho digitado e ele aparece na lista de transcrição", async () => {
    const { container, getByRole } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={false} />);
    const campo = getByRole("textbox", { name: /trecho da fala/i }) as HTMLTextAreaElement;
    const botao = getByRole("button", { name: /registrar trecho/i });

    fireEvent.change(campo, { target: { value: "meu filho não conseguiu entrar hoje" } });
    fireEvent.click(botao);

    await waitFor(() => expect(estado.registrarChamadas).toEqual(["meu filho não conseguiu entrar hoje"]));
    await waitFor(() => expect(container.textContent).toContain("meu filho não conseguiu entrar hoje"));
  });

  it("erro ao registrar o trecho: mensagem visível, texto digitado não se perde no vazio", async () => {
    estado.erroRegistrar = new ErroSessao("Não deu para registrar.", 500);
    const { getByRole } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={false} />);
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

  it("sessaoEncerrada=true: esconde o formulário, mostra mensagem explícita — nunca sumiço mudo", async () => {
    const { container, queryByRole } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={true} />);
    await waitFor(() => expect(container.textContent).toContain("Sessão encerrada"));
    expect(queryByRole("button", { name: /registrar trecho/i })).toBeNull();
    expect(queryByRole("textbox", { name: /trecho da fala/i })).toBeNull();
  });

  it("copiloto_desligado ao carregar: mensagem de estado, não de falha genérica", async () => {
    estado.erroSegmentos = new ErroSessao("Desligado.", 409, "copiloto_desligado");
    const { container } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={false} />);
    await waitFor(() => expect(container.textContent).toContain("desligado por configuração"));
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={false} />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeFalsy());
    await semViolacoes(container);
  });

  it("axe limpo: sessão encerrada", async () => {
    const { container } = montar(<RegistroManual sessaoId="s1" sessaoEncerrada={true} />);
    await waitFor(() => expect(container.textContent).toContain("Sessão encerrada"));
    await semViolacoes(container);
  });
});
