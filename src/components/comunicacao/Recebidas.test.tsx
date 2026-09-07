// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { RespostaMensagensRecebidas } from "./api-comunicacao";

/**
 * A regressão que este arquivo tranca: **"quem respondeu" não pode custar um
 * clique nem uma requisição por linha.**
 *
 * A primeira versão desta tela reconstruía a ligação mensagem × resposta por
 * `conversa_externa_id` + relógio, e só depois de abrir um `<details>` que
 * buscava o agente daquele processo. Duas mensagens no mesmo minuto trocavam
 * de resposta, e a informação mais importante da fila ficava escondida. Agora
 * `item.agente` vem do próprio `GET /api/mensagens/recebidas`, casado no
 * servidor pelo `unique (mensagem_recebida_id)`.
 *
 * `fetch` fica proibido de propósito: se alguém reintroduzir a busca por
 * processo, o teste quebra com o motivo escrito.
 */

vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: () => {} }) }));
vi.stubGlobal("fetch", () => {
  throw new Error("A fila de Recebidas não pode buscar nada por linha — `item.agente` já vem com a lista.");
});

const { Recebidas } = await import("./Recebidas");

const DADOS: RespostaMensagensRecebidas = {
  disponivel: true,
  itens: [
    {
      id: "m1",
      canal: "whatsapp",
      provedor: "chatwoot",
      conversa_externa_id: "901",
      mensagem_externa_id: "x1",
      telefone: "+5511988887777",
      pessoa_id: "p1",
      jornada_id: "j1",
      pessoa_nome: "Antônio Ribeiro",
      corpo: "O que ainda falta?",
      anexos: [],
      recebida_em: "2026-09-07T12:00:00.000Z",
      vinculada_por: null,
      vinculada_em: null,
      criado_em: "2026-09-07T12:00:00.000Z",
      agente: { intencao: "o_que_falta", confianca: 0.94, enviada_em: "2026-09-07T12:00:04.000Z", custo_usd: null, prompt_versao: null, texto: "Faltam a certidão e a matrícula." },
    },
    {
      id: "m2",
      canal: "whatsapp",
      provedor: "chatwoot",
      conversa_externa_id: "901",
      mensagem_externa_id: "x2",
      telefone: "+5511988887777",
      pessoa_id: "p1",
      jornada_id: "j1",
      pessoa_nome: "Antônio Ribeiro",
      corpo: "E o ITCMD?",
      anexos: [],
      recebida_em: "2026-09-07T12:01:00.000Z",
      vinculada_por: null,
      vinculada_em: null,
      criado_em: "2026-09-07T12:01:00.000Z",
      agente: { intencao: "duvida_juridica", confianca: 0.88, enviada_em: null, custo_usd: 0.0004, prompt_versao: 1, texto: "Essa é uma pergunta para a Dra. Elaine." },
    },
    {
      id: "m3",
      canal: "whatsapp",
      provedor: "chatwoot",
      conversa_externa_id: "903",
      mensagem_externa_id: "x3",
      telefone: "+5541996558812",
      pessoa_id: null,
      jornada_id: null,
      pessoa_nome: null,
      corpo: "Oi, queria saber sobre holding",
      anexos: [],
      recebida_em: "2026-09-07T12:02:00.000Z",
      vinculada_por: null,
      vinculada_em: null,
      criado_em: "2026-09-07T12:02:00.000Z",
      agente: null,
    },
  ],
};

function abrir(dados: RespostaMensagensRecebidas = DADOS) {
  return montar(<Recebidas dados={dados} carregando={false} erro={null} recarregar={() => {}} />);
}

describe("Comunicação → Recebidas", () => {
  it("o selo do agente nasce na lista, sem clique e sem `<details>` para expandir", () => {
    const { container } = abrir();
    const selos = container.textContent?.match(/Respondido pelo agente/g) ?? [];
    expect(selos).toHaveLength(2);
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).toContain("Faltam a certidão e a matrícula.");
  });

  it("distingue a que saiu da que a central recusou — o par que uma lista mal feita colapsa", () => {
    const { container } = abrir();
    expect(container.textContent).toContain("Enviada");
    expect(container.textContent).toContain("Não enviado");
    const paraTarefa = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href="/jornadas/j1"]')).filter((a) => a.textContent === "Abrir a tarefa");
    expect(paraTarefa).toHaveLength(1);
  });

  it("mensagem sem resposta do agente não ganha linha nenhuma — cem 'não respondeu' seriam ruído", () => {
    const { container } = abrir();
    expect(container.textContent).not.toContain("O agente não respondeu");
  });

  it("número desconhecido: as duas saídas, vincular e responder à mão", () => {
    const { container } = abrir();
    expect(container.textContent).toContain("Sem correspondência");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Vincular a uma pessoa"))).toBe(true);
    const wa = container.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/"]');
    expect(wa?.textContent).toContain("Responder à mão");
    expect(wa?.rel).toContain("noopener");
  });

  it("versão do prompt é auditoria: fica no title, nunca no fluxo", () => {
    const { container } = abrir();
    const titles = Array.from(container.querySelectorAll("[title]")).map((n) => n.getAttribute("title") ?? "");
    expect(titles.some((t) => t.includes("Versão do prompt: v1."))).toBe(true);
    expect(container.textContent).not.toContain("Versão do prompt");
  });

  it("não tem violação de acessibilidade", async () => {
    await semViolacoes(abrir().container);
  });
});
