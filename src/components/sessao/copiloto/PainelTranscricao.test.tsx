// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { SegmentoCopiloto } from "@/types/copiloto";
import type { PapelEquipe } from "@/types/banco";
import { PainelTranscricao } from "./PainelTranscricao";

/**
 * F3 — a transcrição ENTRA na tela (achado do Fable, 17/09):
 * `usePollingCopiloto` já buscava `segmentos_novos` e descartava; nenhum
 * componente renderizava. Este arquivo trava o que a Dra. Elaine passa a
 * ver ao vivo:
 *
 *  1. Lista `falante: texto`, mais recente EMBAIXO.
 *  2. `role="region"` com rótulo + `aria-live="off"` (NUNCA "polite" — 60
 *     segmentos anunciados em voz alta a cada 3s é inutilizável).
 *  3. Auto-scroll ao fim só quando o usuário JÁ ESTAVA no fim.
 *  4. Linha duplicada (eco do Zoom) é dado real — não maquiada aqui.
 *
 * Fase 12, Fatia 7 — turnos, não linhas soltas:
 *  5. Falas consecutivas do mesmo falante viram UM turno (hora+nome 1×).
 *  6. Advogada × demais por POSIÇÃO (recuo), nunca cor — só quando o usuário
 *     logado é resolvido como advogada; sem isso, degrada para neutro.
 *  7. Só o ÚLTIMO turno recebe o realce de 150ms, uma vez por
 *     `segmento.id`.
 *
 * Fase 12, Fatia 7 (correção de defeito): `PainelTranscricao` deixou de
 * chamar `useUsuarioAtual()` sozinho (2 idas à rede por montagem, repetidas
 * a cada troca de aba Transcrição↔Inventário) e passou a RECEBER
 * `usuarioLogado` por prop, já resolvido pelo server component
 * (`page.tsx::usuarioAtual()`). Este arquivo não mocka mais o hook — monta
 * o componente passando a prop direto, como `ConduzirSessaoApp`/
 * `PainelCopiloto` fazem na árvore real.
 */

type UsuarioLogadoTeste = { nome: string | null; papel: PapelEquipe | null } | null;

function segmento(overrides: Partial<SegmentoCopiloto>): SegmentoCopiloto {
  return {
    id: "seg-1",
    sessao_id: "s1",
    ordem: 1,
    falante: null,
    falante_confianca: null,
    texto: "texto qualquer",
    iniciado_ms: null,
    origem: "bot",
    criado_em: "2026-09-17T12:00:00Z",
    ...overrides,
  };
}

describe("PainelTranscricao — F3, a transcrição entra na tela", () => {
  it("vazio: mostra estado explícito, nunca uma lista muda", () => {
    const { getByText } = montar(<PainelTranscricao segmentos={[]} />);
    expect(getByText("Aguardando a fala da sessão.")).toBeTruthy();
  });

  it("renderiza falante e texto de cada segmento, na ordem recebida (mais recente embaixo)", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Dra. Elaine", texto: "Vamos começar pela composição familiar." }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "Somos eu, minha esposa e dois filhos." }),
    ];
    const { container, getByText } = montar(<PainelTranscricao segmentos={segmentos} />);
    expect(getByText(/Vamos começar pela composição familiar\./)).toBeTruthy();
    expect(getByText(/Somos eu, minha esposa e dois filhos\./)).toBeTruthy();

    const itens = Array.from(container.querySelectorAll("li"));
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain("Vamos começar");
    expect(itens[1].textContent).toContain("Somos eu");
  });

  it("segmento sem falante identificado: mostra só o texto, sem inventar um nome", () => {
    const { container, getByText } = montar(<PainelTranscricao segmentos={[segmento({ falante: null, texto: "fala sem falante" })]} />);
    expect(getByText("fala sem falante")).toBeTruthy();
    // Nenhum rótulo de falante inventado (regra da casa: nada de dado
    // inventado na tela) — só o horário antes do texto.
    const item = container.querySelector("li");
    expect(item?.querySelector(".font-medium")).toBeNull();
    expect(item?.querySelector(".font-semibold")).toBeNull();
  });

  it("linhas duplicadas (eco do Zoom) NÃO são deduplicadas — é dado real, problema operacional", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, texto: "o imóvel da praia fica com quem" }),
      segmento({ id: "s2", ordem: 2, texto: "o imóvel da praia fica com quem" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    // Mesmo falante (`null` nos dois) → agrupam no MESMO turno (1 `li`), mas
    // as DUAS frases continuam presentes dentro dele — nenhuma some.
    const ocorrencias = container.querySelectorAll("li p.leading-relaxed");
    expect(ocorrencias).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("`role=region` com rótulo e `aria-live=off` — NUNCA 'polite' (60 segmentos falados em voz alta é inutilizável)", () => {
    const { getByRole } = montar(<PainelTranscricao segmentos={[segmento({})]} />);
    const regiao = getByRole("region", { name: "Transcrição da sessão" });
    expect(regiao.getAttribute("aria-live")).toBe("off");
  });

  it("auto-scroll: se o usuário estava no fim, um segmento novo rola para o fim", () => {
    const { container, rerender } = montar(<PainelTranscricao segmentos={[segmento({ id: "s1" })]} />);
    const regiao = container.querySelector('[role="region"]') as HTMLDivElement;

    // jsdom não calcula layout de verdade — simula "no fim" e "cresceu".
    Object.defineProperty(regiao, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(regiao, "clientHeight", { value: 100, configurable: true });
    regiao.scrollTop = 0; // distância do fim = 0 → "no fim"

    rerender(<PainelTranscricao segmentos={[segmento({ id: "s1" }), segmento({ id: "s2", ordem: 2 })]} />);
    Object.defineProperty(regiao, "scrollHeight", { value: 200, configurable: true });
    // O efeito já deve ter tentado igualar scrollTop a scrollHeight.
    expect(regiao.scrollTop).toBeGreaterThanOrEqual(0);
  });

  it("usuário rolou para cima para reler: um segmento novo NÃO arrasta de volta para o fim", () => {
    const { container, rerender } = montar(<PainelTranscricao segmentos={[segmento({ id: "s1" })]} />);
    const regiao = container.querySelector('[role="region"]') as HTMLDivElement;

    Object.defineProperty(regiao, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(regiao, "clientHeight", { value: 100, configurable: true });
    regiao.scrollTop = 0; // longe do fim (distância = 400) — usuário rolou para cima
    fireEvent.scroll(regiao);

    // Trava o valor: se o componente tentasse forçar o fim, `scrollTop`
    // seria reescrito para perto de `scrollHeight`.
    const scrollTopAntes = regiao.scrollTop;
    rerender(<PainelTranscricao segmentos={[segmento({ id: "s1" }), segmento({ id: "s2", ordem: 2 })]} />);
    expect(regiao.scrollTop).toBe(scrollTopAntes);
  });

  it("não tem violação de acessibilidade", async () => {
    const segmentos = [segmento({ id: "s1", falante: "Dra. Elaine", texto: "Pergunta um" }), segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "Resposta um" })];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    await semViolacoes(container);
  });

  // -------------------------------------------------------------------------
  // Fase 12, Fatia 7 — agrupamento em turnos
  // -------------------------------------------------------------------------

  it("3 falas consecutivas do mesmo falante viram 1 turno, com 3 linhas de texto", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "Primeira frase." }),
      segmento({ id: "s2", ordem: 2, falante: "Elaine Montenegro", texto: "Segunda frase." }),
      segmento({ id: "s3", ordem: 3, falante: "Elaine Montenegro", texto: "Terceira frase." }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);

    const itens = container.querySelectorAll("li");
    expect(itens).toHaveLength(1);
    // Nome aparece 1× dentro do turno, não 3×.
    expect(itens[0].textContent?.match(/Elaine Montenegro/g)).toHaveLength(1);
    const linhas = itens[0].querySelectorAll("p.leading-relaxed");
    expect(linhas).toHaveLength(3);
    expect(linhas[0].textContent).toContain("Primeira frase.");
    expect(linhas[1].textContent).toContain("Segunda frase.");
    expect(linhas[2].textContent).toContain("Terceira frase.");
  });

  it("alternância de falante gera turnos separados, um por troca", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "Pergunta A." }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "Resposta A." }),
      segmento({ id: "s3", ordem: 3, falante: "Elaine Montenegro", texto: "Pergunta B." }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);

    const itens = container.querySelectorAll("li");
    expect(itens).toHaveLength(3);
  });

  it("preserva a ordem recebida dentro e entre turnos", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Cliente", texto: "um" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "dois" }),
      segmento({ id: "s3", ordem: 3, falante: "Elaine Montenegro", texto: "três" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    const itens = container.querySelectorAll("li");
    expect(itens[0].textContent).toContain("um");
    expect(itens[0].textContent).toContain("dois");
    expect(itens[1].textContent).toContain("três");
  });

  it("falantes null consecutivos agrupam no mesmo turno (sem identificação é um valor de falante como outro)", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: null, texto: "fala sem falante 1" }),
      segmento({ id: "s2", ordem: 2, falante: null, texto: "fala sem falante 2" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Fase 12, Fatia 7 — realce só no último turno
  // -------------------------------------------------------------------------

  it("só o último turno recebe a classe de realce", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Cliente", texto: "primeiro turno" }),
      segmento({ id: "s2", ordem: 2, falante: "Elaine Montenegro", texto: "segundo turno" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    const itens = container.querySelectorAll("li");
    expect(itens[0].classList.contains("realce-insight-novo")).toBe(false);
    expect(itens[1].classList.contains("realce-insight-novo")).toBe(true);
  });

  it("o realce não se repete: um turno que já recebeu o realce e depois deixa de ser o último não reacende", () => {
    const { container, rerender } = montar(<PainelTranscricao segmentos={[segmento({ id: "s1", falante: "Cliente", texto: "a" })]} />);
    let itens = container.querySelectorAll("li");
    expect(itens[0].classList.contains("realce-insight-novo")).toBe(true);

    rerender(<PainelTranscricao segmentos={[segmento({ id: "s1", falante: "Cliente", texto: "a" }), segmento({ id: "s2", ordem: 2, falante: "Elaine Montenegro", texto: "b" })]} />);
    itens = container.querySelectorAll("li");
    expect(itens[0].classList.contains("realce-insight-novo")).toBe(false);
    expect(itens[1].classList.contains("realce-insight-novo")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fase 12, Fatia 7 — advogada por posição/peso, nunca cor; degradação neutra
  // -------------------------------------------------------------------------

  it("usuário logado resolvido como advogada: seu turno vem sem recuo e com peso maior; demais com recuo", () => {
    const usuarioLogado: UsuarioLogadoTeste = { nome: "Dra. Elaine Montenegro", papel: "advogada" };
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "pergunta" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "resposta" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} />);
    const itens = container.querySelectorAll("li");

    // Advogada: sem recuo, nome com peso maior.
    expect(itens[0].classList.contains("border-l")).toBe(false);
    expect(itens[0].querySelector(".font-semibold")).not.toBeNull();

    // Cliente: recuo (sinal primário), nome com peso menor.
    expect(itens[1].classList.contains("border-l")).toBe(true);
    expect(itens[1].classList.contains("pl-3")).toBe(true);
    expect(itens[1].querySelector(".font-medium")).not.toBeNull();
  });

  it("🔴 papel `admin` com nome casando recebe o tratamento de quem conduz — o caso REAL da Dra. Elaine", () => {
    // Medido em produção (17/09, navegador, build 8357981): a Dra. Elaine está
    // cadastrada como `admin` em `perfis_equipe`, não como `advogada`. A 1ª
    // versão exigia `papel === "advogada"` e degradou para neutro em silêncio:
    // 14 turnos, 14 com recuo, zero em destaque — a diferenciação estava
    // MORTA para a única pessoa para quem existe. Este teste prende o caso.
    const usuarioLogado: UsuarioLogadoTeste = { nome: "Dra. Elaine Montenegro", papel: "admin" };
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "pergunta" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "resposta" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} />);
    const itens = container.querySelectorAll("li");

    expect(itens[0].classList.contains("border-l")).toBe(false);
    expect(itens[0].querySelector(".font-semibold")).not.toBeNull();
    expect(itens[1].classList.contains("border-l")).toBe(true);
  });

  it("sem usuário logado resolvido (ou papel que NÃO conduz: assistente/relacionamento): degrada para neutro — nenhum turno tem recuo diferencial", () => {
    const usuarioLogado: UsuarioLogadoTeste = { nome: "Alguém", papel: "assistente" };
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "pergunta" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "resposta" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} />);
    const itens = container.querySelectorAll("li");

    // Neutro: todos no MESMO tratamento — sem confirmação de quem é a
    // advogada, ninguém ganha o tratamento "sem recuo/peso maior" (que só
    // vale para quem foi POSITIVAMENTE identificado). Ambos os turnos saem
    // com a mesma classe entre si.
    expect(itens[0].classList.contains("border-l")).toBe(itens[1].classList.contains("border-l"));
  });

  it("sem prop usuarioLogado (default): degrada para neutro, nunca lança nem inventa quem é a advogada", () => {
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Elaine Montenegro", texto: "pergunta" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "resposta" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} />);
    const itens = container.querySelectorAll("li");
    expect(itens[0].classList.contains("border-l")).toBe(itens[1].classList.contains("border-l"));
  });

  it("advogada logada mas o nome não casa com nenhum falante transcrito: nenhum turno vira 'advogada' por engano", () => {
    const usuarioLogado: UsuarioLogadoTeste = { nome: "Dra. Elaine Montenegro", papel: "advogada" };
    const segmentos = [
      segmento({ id: "s1", ordem: 1, falante: "Falante Desconhecido", texto: "pergunta" }),
      segmento({ id: "s2", ordem: 2, falante: "Cliente", texto: "resposta" }),
    ];
    const { container } = montar(<PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} />);
    const itens = container.querySelectorAll("li");
    expect(itens[0].classList.contains("border-l")).toBe(true);
    expect(itens[1].classList.contains("border-l")).toBe(true);
  });
});
