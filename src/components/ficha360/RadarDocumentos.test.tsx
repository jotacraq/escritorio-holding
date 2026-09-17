// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { RespostaRadar } from "@/types/jornada-automacoes";

/**
 * Fable, achado defeito 1 (16/09/2026): "Anexar documento" era um
 * `<Link href="#documentos">` — morto, porque `next/link` intercepta o
 * clique e troca o hash por `history.pushState`, que por especificação NÃO
 * dispara `hashchange`, e não existe `id="documentos"` no DOM para um
 * scroll nativo pegar. O teste que teria pego isso: montar o Radar
 * RECOLHIDO e provar que o clique em "Anexar documento" chama
 * `aoAbrirGaveta("documentos")` — nunca `window.location.hash`.
 */

const { resposta } = vi.hoisted(() => ({
  resposta: {
    itens: [
      {
        chave: "coleta:imposto_renda:-",
        tipo: "imposto_renda",
        rotulo: "IRPF",
        item_ref: null,
        lado: "coleta",
        estado: "a_pedir",
        pedido_em: null,
        recebido_em: null,
        obrigatorio: true,
        trava: [],
      },
    ],
    modelo: null,
    pedidos_disponiveis: true,
  } as RespostaRadar,
}));

vi.mock("./api-fase5", () => ({
  buscarRadar: () => Promise.resolve({ estado: "ok", dados: resposta }),
  pedirDocumentos: vi.fn(),
}));
vi.mock("@/hooks/useUsuarioAtual", () => ({
  useUsuarioAtual: () => ({ usuario: { email: "a@b.c", nome: "Quem quer que seja", papel: "admin" }, carregando: false }),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: () => {} }) }));

const { RadarDocumentos } = await import("./RadarDocumentos");

describe("RadarDocumentos recolhido — verbo 'Anexar documento'", () => {
  it("renderiza o verbo e o clique chama aoAbrirGaveta('documentos'), nunca navegação por hash", async () => {
    const aoAbrirGaveta = vi.fn();
    const hashAntes = window.location.hash;

    const { getByRole } = montar(<RadarDocumentos jornadaId="j1" recolhivel aoAbrirGaveta={aoAbrirGaveta} />);

    const botao = await waitFor(() => getByRole("button", { name: "Anexar documento" }));
    expect(botao.tagName).toBe("BUTTON");
    expect(botao.getAttribute("href")).toBeNull();

    botao.click();

    expect(aoAbrirGaveta).toHaveBeenCalledWith("documentos");
    expect(aoAbrirGaveta).toHaveBeenCalledTimes(1);
    // A prova negativa do defeito 1: nada mexeu no hash da URL.
    expect(window.location.hash).toBe(hashAntes);
  });

  it("sem aoAbrirGaveta (uso fora da Ficha) não renderiza o verbo — nunca um link morto", async () => {
    const { queryByRole, findAllByText } = montar(<RadarDocumentos jornadaId="j1" recolhivel />);
    await findAllByText(/prontos/);
    expect(queryByRole("button", { name: "Anexar documento" })).toBeNull();
  });

  it("não tem violação de acessibilidade", async () => {
    const { container, findByRole } = montar(<RadarDocumentos jornadaId="j1" recolhivel aoAbrirGaveta={() => {}} />);
    await findByRole("button", { name: "Anexar documento" });
    await semViolacoes(container);
  });
});
