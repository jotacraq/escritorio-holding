// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { PrazosDoDia, haPrazoUrgente } from "./PrazosDoDia";
import { ComprasTravadas } from "./ComprasTravadas";
import { TudoCerto } from "./TudoCerto";
import { ResumoDoDia } from "./ResumoDoDia";
import type { PrazoAberto, CompraDoProcesso } from "./dadosDeUrgencia";

const AGORA = new Date(2026, 8, 7); // 07/09/2026, meia-noite local

function prazo(parcial: Partial<PrazoAberto> & { id: string }): PrazoAberto {
  return { jornada_id: "j1", tipo: null, titulo: "Cobrar boleto", descricao: null, vence_em: null, origem: "sistema", nome: "Família Andrade", ...parcial };
}

describe("haPrazoUrgente", () => {
  it("vencido e vencendo hoje são urgentes", () => {
    expect(haPrazoUrgente([prazo({ id: "a", vence_em: "2026-09-06" })], AGORA)).toBe(true);
    expect(haPrazoUrgente([prazo({ id: "b", vence_em: "2026-09-07" })], AGORA)).toBe(true);
  });

  it("amanhã ainda não é hoje", () => {
    expect(haPrazoUrgente([prazo({ id: "c", vence_em: "2026-09-08" })], AGORA)).toBe(false);
  });

  it("sem prazo não é urgente — mas também não é 'em dia'", () => {
    expect(haPrazoUrgente([prazo({ id: "d", vence_em: null })], AGORA)).toBe(false);
  });
});

describe("PrazosDoDia", () => {
  it("mostra a data-limite como data LOCAL — `2026-09-07` não pode virar 06/09", () => {
    const { container } = montar(
      <PrazosDoDia estado={{ situacao: "ok", itens: [prazo({ id: "a", vence_em: "2026-09-07" })] }} agora={AGORA} aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("Vence hoje");
    expect(container.textContent).toContain("07/09");
    expect(container.textContent).not.toContain("06/09");
  });

  it("vencido vem antes de no prazo", () => {
    const { container } = montar(
      <PrazosDoDia
        estado={{
          situacao: "ok",
          itens: [prazo({ id: "futuro", titulo: "Depois", vence_em: "2026-10-01" }), prazo({ id: "velho", titulo: "Atrasada", vence_em: "2026-09-01" })],
        }}
        agora={AGORA}
        aoTentarDeNovo={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto.indexOf("Atrasada")).toBeLessThan(texto.indexOf("Depois"));
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <PrazosDoDia estado={{ situacao: "ok", itens: [prazo({ id: "a", vence_em: "2026-09-07" })] }} agora={AGORA} aoTentarDeNovo={() => {}} />,
    );
    await semViolacoes(container);
  });
});

function compra(parcial: Partial<CompraDoProcesso> & { status: string }): CompraDoProcesso {
  return {
    jornada_id: "j1",
    produto_tipo: "croqui_estrutural",
    produto_nome: "Croqui Estrutural",
    evento_hotmart: "REFUNDED",
    evento_em: "2026-09-06T12:00:00Z",
    revertido: false,
    aguardando_dinheiro: false,
    nome: "Família Andrade",
    ...parcial,
  };
}

describe("ComprasTravadas", () => {
  it("usa o rótulo do catálogo, não um texto próprio", () => {
    const { container } = montar(
      <ComprasTravadas estado={{ situacao: "ok", itens: [compra({ status: "reembolsado", revertido: true })] }} aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("Reembolsado");
    expect(container.textContent).toContain("Decidir o desfecho");
  });

  it("boleto que não entrou pede COBRAR, não decisão de desfecho", () => {
    const { container } = montar(
      <ComprasTravadas estado={{ situacao: "ok", itens: [compra({ status: "expirado", aguardando_dinheiro: true })] }} aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("Boleto vencido");
    expect(container.textContent).toContain("Cobrar");
  });

  it("sem o nome carregado, diz que não tem o nome — nunca inventa um", () => {
    const { container } = montar(
      <ComprasTravadas estado={{ situacao: "ok", itens: [compra({ status: "estornado", revertido: true, nome: null })] }} aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("sem nome carregado");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <ComprasTravadas estado={{ situacao: "ok", itens: [compra({ status: "reembolsado", revertido: true })] }} aoTentarDeNovo={() => {}} />,
    );
    await semViolacoes(container);
  });
});

describe("TudoCerto", () => {
  it("não desenha nada quando não há bloco tranquilo", () => {
    const { container } = montar(<TudoCerto blocos={[]} />);
    expect(container.textContent).toBe("");
  });

  it("junta os nomes numa linha só", () => {
    const { container } = montar(<TudoCerto blocos={[{ id: "a", titulo: "Sessões de hoje" }, { id: "b", titulo: "Preparo pendente" }]} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("Sem pendência");
  });
});

describe("ResumoDoDia", () => {
  it("valor nulo vira travessão com o motivo — nunca zero", () => {
    const { container } = montar(<ResumoDoDia itens={[{ id: "x", rotulo: "Compra travada", valor: null, motivoVazio: "não carregou", href: "#x" }]} />);
    expect(container.textContent).toContain("—");
    expect(container.querySelector("a")?.getAttribute("title")).toBe("não carregou");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <ResumoDoDia
        itens={[
          { id: "a", rotulo: "Pagou, sem contato", valor: 2, href: "#a", urgente: true },
          { id: "b", rotulo: "Sessões em 48 h", valor: 1, unidade: "de 3", href: "#b" },
        ]}
      />,
    );
    await semViolacoes(container);
  });
});
