// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { AgenteJornada } from "@/types/agente";
import type { PapelEquipe } from "@/lib/api";

/**
 * O bloco da Ficha responde a pergunta que antes só existia no banco: **por
 * que o robô está calado nesta conversa?**. Os casos abaixo são os que a
 * captura de tela de um banco saudável nunca mostra — agente desligado,
 * conversa assumida, resposta que a central recusou.
 *
 * O que ele NÃO pode fazer, e por isso está testado: oferecer "Assumir
 * conversa" a quem o servidor recusaria (`exigirPapel("admin","advogada",
 * "relacionamento")` no POST). Botão que existe e dá 403 é pior do que botão
 * que não existe.
 */

const { estado } = vi.hoisted(() => ({
  estado: { agente: null as AgenteJornada | null, papel: "admin" as PapelEquipe | null, acoes: [] as string[] },
}));

vi.mock("@/lib/api/agente", () => ({
  lerAgenteDaJornada: () => Promise.resolve(estado.agente),
  definirAgenteDaJornada: (_id: string, acao: string) => {
    estado.acoes.push(acao);
    return Promise.resolve({ pausado: acao === "assumir", pausado_ate: null });
  },
}));
vi.mock("@/hooks/useUsuarioAtual", () => ({
  useUsuarioAtual: () => ({ usuario: { email: "a@b.c", nome: "Quem quer que seja", papel: estado.papel }, carregando: false }),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: () => {} }) }));

const { RecebidasFicha } = await import("./RecebidasFicha");

const BASE: AgenteJornada = {
  jornada_id: "j1",
  agente_ativo: true,
  passo_ultimo: "documentos",
  ultima_intencao: "o_que_falta",
  esquivas_seguidas: 0,
  humano_respondeu_em: null,
  pausado_ate: null,
  pausado_por: null,
  pausado_por_nome: null,
  pausado: false,
  custo_usd_hoje: 0,
  ultimas_respostas: [],
  impedimentos: [],
};

const RESPOSTA = {
  id: "r1",
  mensagem_recebida_id: "m1",
  jornada_id: "j1",
  conversa_externa_id: "c1",
  intencao: "o_que_falta" as const,
  confianca: 0.9,
  acao: "nenhuma" as const,
  texto: "Falta a certidão. O link é este: …",
  custo_usd: null,
  enviada_em: "2026-09-07T12:00:05.000Z",
  erro: null,
  criado_em: "2026-09-07T12:00:00.000Z",
};

async function abrir(agente: Partial<AgenteJornada>, papel: PapelEquipe | null = "admin") {
  estado.agente = { ...BASE, ...agente };
  estado.papel = papel;
  const montado = montar(<RecebidasFicha jornadaId="j1" />);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return montado;
}

describe("Ficha → conversa no WhatsApp", () => {
  beforeEach(() => {
    estado.acoes = [];
  });

  it("nada acontecendo e quem olha não é admin: o bloco não chega ao DOM", async () => {
    const { container } = await abrir({ agente_ativo: false, ultimas_respostas: [] }, "relacionamento");
    expect(container.textContent).toBe("");
  });

  it("agente ligado: uma linha que diz o que há dentro, e nasce fechada", async () => {
    const { container } = await abrir({ ultimas_respostas: [RESPOSTA] });
    expect(container.textContent).toContain("Conversa no WhatsApp");
    expect(container.textContent).toContain("1 resposta do agente");
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("conversa assumida: o resumo diz QUEM assumiu e até quando, sem precisar abrir", async () => {
    const { container } = await abrir({ pausado: true, pausado_ate: "2026-09-07T15:30:00.000Z", pausado_por_nome: "Kelly Andrade" });
    expect(container.textContent).toContain("Assumida por Kelly Andrade até");
    expect(container.textContent).toContain("Equipe no comando");
  });

  it("assumida por quem saiu da equipe: 'alguém da equipe', nunca um id de perfil na tela", async () => {
    const { container } = await abrir({ pausado: true, pausado_ate: "2026-09-07T15:30:00.000Z", pausado_por: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", pausado_por_nome: null });
    expect(container.textContent).toContain("Assumida por alguém da equipe até");
    expect(container.textContent).not.toContain("0f1e2d3c");
  });

  it("impedimentos: a tela diz POR QUE ele está calado, em texto de gente", async () => {
    const { container } = await abrir({ agente_ativo: false, impedimentos: ["O agente está desligado em Admin."] });
    expect(container.textContent).toContain("Por que o agente está calado");
    expect(container.textContent).toContain("O agente está desligado em Admin.");
  });

  it("pausado oferece devolver; não pausado oferece assumir — um botão, nunca os dois", async () => {
    const pausado = await abrir({ pausado: true, pausado_ate: "2026-09-07T15:30:00.000Z" });
    const rotulosPausado = Array.from(pausado.container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(rotulosPausado.some((r) => r.includes("Devolver ao agente"))).toBe(true);
    expect(rotulosPausado.some((r) => r.includes("Assumir conversa"))).toBe(false);

    const solto = await abrir({});
    const rotulosSolto = Array.from(solto.container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(rotulosSolto.some((r) => r.includes("Assumir conversa"))).toBe(true);
    expect(rotulosSolto.some((r) => r.includes("Devolver ao agente"))).toBe(false);
  });

  it("assistente não vê os botões: o servidor recusaria a ação dela", async () => {
    const { container } = await abrir({ ultimas_respostas: [RESPOSTA] }, "assistente");
    const rotulos = Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(rotulos.some((r) => r.includes("Assumir conversa"))).toBe(false);
    // Mas ela continua vendo o que o agente disse — a leitura é de toda a equipe.
    expect(container.textContent).toContain("Falta a certidão");
  });

  it("resposta que a central recusou aparece como não enviada, não como enviada", async () => {
    const { container } = await abrir({ ultimas_respostas: [{ ...RESPOSTA, enviada_em: null, erro: "chatwoot_503" }] });
    expect(container.textContent).toContain("Não enviado");
    expect(container.textContent).toContain("A tarefa está no alto desta ficha.");
  });

  it("custo do dia é dito por extenso quando é zero — e só para quem vê custo", async () => {
    const admin = await abrir({ custo_usd_hoje: 0 });
    expect(admin.container.textContent).toContain("Custo de IA hoje");
    const relacionamento = await abrir({ custo_usd_hoje: 0, ultimas_respostas: [RESPOSTA] }, "relacionamento");
    expect(relacionamento.container.textContent).not.toContain("Custo de IA hoje");
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = await abrir({ pausado: true, pausado_ate: "2026-09-07T15:30:00.000Z", impedimentos: ["A conversa foi assumida pela equipe."], ultimas_respostas: [RESPOSTA] });
    await semViolacoes(container);
  });
});
