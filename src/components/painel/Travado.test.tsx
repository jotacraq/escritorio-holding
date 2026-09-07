// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { Travado, pendenciasVisiveis } from "./Travado";
import type { PendenciaSistema } from "@/types/painel-ui";

/**
 * Os dois tipos que a 0089 acrescenta (Fase 9) chegam **sem `jornada_id`** —
 * o número desconhecido não tem processo, e o telefone torto é da pessoa. Sem
 * tratamento, o bloco os mostrava como "escreveu e não é do cadastro" em
 * `snake_case` e com "Sem cliente ligado" no lugar da ação: a pendência
 * aparecia e não tinha para onde ir. Este teste é a trava disso.
 *
 * Vale também para o próximo tipo que nascer: um tipo desconhecido continua
 * renderizando legível, sem derrubar o bloco.
 */

function pendencia(parcial: Partial<PendenciaSistema>): PendenciaSistema {
  return {
    id: "p1",
    tipo: "numero_desconhecido",
    titulo: "Número desconhecido escreveu no WhatsApp",
    descricao: 'O número +5511988887777 mandou: "oi, é da holding?"',
    jornada_id: null,
    pessoa_nome: null,
    ocorrido_em: "2026-09-07T12:00:00.000Z",
    ...parcial,
  };
}

const OK = (itens: PendenciaSistema[]) => ({ situacao: "ok" as const, itens });

describe("Travado — pendências do agente de WhatsApp (0089)", () => {
  it("número desconhecido: rótulo de negócio e ação que abre a fila de recebidas", () => {
    const { container } = montar(<Travado estado={OK([pendencia({})])} papel="admin" aoTentarDeNovo={() => {}} />);
    expect(container.textContent).toContain("Escreveu e não é do cadastro");
    expect(container.textContent).not.toContain("numero_desconhecido");
    const acao = container.querySelector<HTMLAnchorElement>('a[href="/mensagens#recebidas"]');
    // O verbo do botão diz o que acontece no clique — "Resolver" não diz nada aqui.
    expect(acao?.textContent).toContain("Ver a mensagem");
    expect(container.textContent).not.toContain("Sem cliente ligado");
  });

  it("telefone fora do padrão: cai na PESSOA em Clientes, não na lista de todo mundo", () => {
    const { container } = montar(
      <Travado estado={OK([pendencia({ id: "p2", tipo: "telefone_fora_do_padrao", pessoa_nome: "Maria Silva", titulo: "Telefone fora do padrão internacional" })])} papel="admin" aoTentarDeNovo={() => {}} />,
    );
    expect(container.textContent).toContain("Telefone fora do padrão");
    expect(container.textContent).toContain("Maria Silva");
    const acao = container.querySelector<HTMLAnchorElement>('a[href="/clientes?busca=Maria%20Silva"]');
    expect(acao?.textContent).toContain("Corrigir o telefone");
  });

  it("telefone fora do padrão sem nome: vai para Clientes sem inventar busca", () => {
    const { container } = montar(
      <Travado estado={OK([pendencia({ id: "p3", tipo: "telefone_fora_do_padrao", pessoa_nome: null })])} papel="admin" aoTentarDeNovo={() => {}} />,
    );
    expect(container.querySelector<HTMLAnchorElement>('a[href="/clientes"]')?.textContent).toContain("Corrigir o telefone");
  });

  it("a explicação longa fica no title, nunca no fluxo (lei de texto §2.2)", () => {
    const { container } = montar(<Travado estado={OK([pendencia({})])} papel="admin" aoTentarDeNovo={() => {}} />);
    const comTitle = Array.from(container.querySelectorAll("[title]")).map((n) => n.getAttribute("title") ?? "");
    expect(comTitle.some((t) => t.includes("silêncio é a única resposta"))).toBe(true);
    expect(container.textContent).not.toContain("silêncio é a única resposta");
  });

  it("tipo que a tela não conhece continua legível — nunca derruba o bloco", () => {
    const { container } = montar(<Travado estado={OK([pendencia({ tipo: "tipo_que_nao_existe_ainda" })])} papel="admin" aoTentarDeNovo={() => {}} />);
    expect(container.textContent).toContain("tipo que nao existe ainda");
  });

  it("os dois tipos novos são de ATENDIMENTO: admin, advogada e relacionamento veem; assistente não", () => {
    // `pendenciaVisivelPara` mora em `src/lib/blocosPorPapel.ts`, que TAMBÉM é
    // filtro de autorização em `GET /api/painel` — quem alargou foi o servidor
    // (`PENDENCIAS_DE_ATENDIMENTO`), não a tela. O assistente fica de fora
    // porque não atende conversa: para ele a linha seria aviso sem ação.
    for (const tipo of ["numero_desconhecido", "telefone_fora_do_padrao"]) {
      expect(pendenciasVisiveis([pendencia({ tipo })], "admin")).toHaveLength(1);
      expect(pendenciasVisiveis([pendencia({ tipo })], "advogada")).toHaveLength(1);
      expect(pendenciasVisiveis([pendencia({ tipo })], "relacionamento")).toHaveLength(1);
      expect(pendenciasVisiveis([pendencia({ tipo })], "assistente")).toHaveLength(0);
    }
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <Travado
        estado={OK([pendencia({}), pendencia({ id: "p2", tipo: "telefone_fora_do_padrao", pessoa_nome: "Maria Silva" })])}
        papel="admin"
        aoTentarDeNovo={() => {}}
      />,
    );
    await semViolacoes(container);
  });
});
