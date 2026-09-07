// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { AgenteResumo } from "@/types/agente";

/**
 * A aba existe para não deixar duas coisas acontecerem em silêncio, e é
 * exatamente isso que este arquivo trava:
 *
 *  1. **ligado com env faltando** = ligado e MUDO. Nada falha, nada aparece no
 *     log, o cliente escreve e não recebe nada. A tela tem de dizer a
 *     consequência, não pintar um selo cinza de "desconfigurado".
 *  2. **ligado com o prompt inativo** = só respostas fixas. É uma escolha
 *     legítima (o prompt nasce inativo por desenho), mas precisa ser uma
 *     escolha declarada, não uma surpresa no primeiro cliente que perguntar
 *     algo fora do roteiro.
 *
 * O `useToast` real precisa do provider do layout; aqui ele é dublê, porque o
 * que se testa é a LEITURA da tela, não o toast.
 */

const { estado } = vi.hoisted(() => ({ estado: { resumo: null as AgenteResumo | null } }));

vi.mock("@/lib/api/agente", () => ({
  lerResumoDoAgente: () => Promise.resolve(estado.resumo),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ notificar: () => {} }) }));

const { AgenteWhatsappAba } = await import("./AgenteWhatsappAba");

const BASE: AgenteResumo = {
  ativo: false,
  envs_faltando: [],
  prompt_chave: "agente_whatsapp_onboarding",
  prompt_versao: 1,
  prompt_ativo: true,
  silencio_humano_minutos: 30,
  esquivas_ate_humano: 2,
  intervalo_link_horas: 6,
  teto_respostas_hora: 6,
  teto_ia_jornada_dia: 10,
  teto_ia_dia: 100,
  respostas_hoje: 0,
  execucoes_ia_hoje: 0,
  custo_usd_hoje: 0,
  ultimas_respostas: [],
};

async function abrir(resumo: Partial<AgenteResumo>) {
  estado.resumo = { ...BASE, ...resumo };
  const montado = montar(<AgenteWhatsappAba />);
  // `useRecurso` resolve numa continuação de microtask; dois turnos bastam.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return montado;
}

describe("Admin → Agente de WhatsApp", () => {
  beforeEach(() => {
    estado.resumo = BASE;
  });

  it("diz para que serve antes de qualquer número", async () => {
    const { container } = await abrir({});
    expect(container.textContent).toContain("Sessão de Viabilidade");
    expect(container.textContent).toContain("só fala com quem está no cadastro");
  });

  it("desligado: o interruptor oferece ligar e a tela não finge que ele responde", async () => {
    const { container } = await abrir({ ativo: false });
    expect(container.textContent).toContain("O agente está desligado");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Ligar o agente"))).toBe(true);
  });

  it("ligado com env faltando: alerta com a CONSEQUÊNCIA e o nome das variáveis", async () => {
    const { container } = await abrir({ ativo: true, envs_faltando: ["CHATWOOT_INBOX_ID", "CHATWOOT_TOKEN"] });
    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("não responde nada");
    expect(container.textContent).toContain("CHATWOOT_INBOX_ID");
    expect(container.textContent).toContain("CHATWOOT_TOKEN");
  });

  it("desligado com env faltando: mesmo aviso, no tempo futuro — ainda não está mudo, mas vai estar", async () => {
    const { container } = await abrir({ ativo: false, envs_faltando: ["CHATWOOT_INBOX_ID"] });
    expect(container.textContent).toContain("Não vai responder nada quando for ligado");
  });

  it("prompt inativo: 'só respostas fixas', com o que isso significa para o cliente", async () => {
    const { container } = await abrir({ ativo: true, prompt_ativo: false, prompt_versao: 1 });
    expect(container.textContent).toContain("Só respostas fixas");
    expect(container.textContent).toContain("encaminha para a equipe");
  });

  it("prompt inexistente (0090 não aplicada) não vira 'prompt inativo' — é outra coisa", async () => {
    const { container } = await abrir({ prompt_versao: null, prompt_ativo: false });
    expect(container.textContent).toContain("ainda não existe neste banco");
    expect(container.textContent).not.toContain("Só respostas fixas");
  });

  it("tudo em ordem: confirmação discreta, status e nunca alerta", async () => {
    const { container } = await abrir({ ativo: true, prompt_ativo: true });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("prompt ativo");
  });

  it("dia sem resposta mostra travessão e o motivo — nunca zero plausível", async () => {
    const { container } = await abrir({ ativo: true, respostas_hoje: 0, custo_usd_hoje: 0 });
    expect(container.textContent).toContain("ninguém escreveu ainda hoje");
    expect(container.textContent).toContain("nenhuma resposta custou IA hoje");
  });

  it("as regras aparecem com unidade, e a explicação fica no title", async () => {
    const { container } = await abrir({});
    expect(container.textContent).toContain("30 minutos");
    const titles = Array.from(container.querySelectorAll("[title]")).map((n) => n.getAttribute("title") ?? "");
    expect(titles.some((t) => t.includes("Assumir conversa"))).toBe(true);
  });

  it("sem resposta nenhuma, a auditoria mostra vazio rotulado, não uma tabela vazia", async () => {
    const { container } = await abrir({});
    expect(container.textContent).toContain("O agente ainda não respondeu ninguém");
    expect(container.querySelector("table")).toBeNull();
  });

  it("com respostas: intenção, certeza, custo e a que processo pertence", async () => {
    const { container } = await abrir({
      ativo: true,
      respostas_hoje: 1,
      ultimas_respostas: [
        {
          id: "r1",
          mensagem_recebida_id: "m1",
          jornada_id: "j1",
          conversa_externa_id: "c1",
          intencao: "duvida_juridica",
          confianca: 0.91,
          acao: "encaminhar_humano",
          texto: "Essa é uma pergunta para a Dra. Elaine. Já avisei a equipe.",
          custo_usd: null,
          enviada_em: "2026-09-07T12:00:05.000Z",
          erro: null,
          criado_em: "2026-09-07T12:00:00.000Z",
        },
      ],
    });
    expect(container.textContent).toContain("Dúvida jurídica");
    expect(container.textContent).toContain("91% de certeza");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/jornadas/j1#conversa"]')).toBeTruthy();
  });

  it("não tem violação de acessibilidade nos dois estados que importam", async () => {
    await semViolacoes((await abrir({ ativo: true, prompt_ativo: true })).container);
    await semViolacoes((await abrir({ ativo: true, envs_faltando: ["CHATWOOT_INBOX_ID"], prompt_ativo: false })).container);
  });
});
