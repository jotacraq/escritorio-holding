// @vitest-environment jsdom
import { useRef, useState } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { LinkRetrospecto, PopupRetrospecto, caminhoRetrospecto } from "./PopupRetrospecto";
import type { RetrospectoDaSessao } from "@/types/copiloto";

/**
 * Fase 13, FE-6/FE-7 — o pop-up do Retrospecto da Sessão.
 *
 * O que estes testes travam:
 *  1. **Falha do backend vira STUB ROTULADO**, nunca corpo vazio. É a regra
 *     da casa ("funcionalidade não pronta aparece como stub rotulado, jamais
 *     como dado plausível") aplicada ao caso que o próprio plano prevê: o
 *     retrospecto nunca derruba o encerramento, então `retrospecto: null` na
 *     resposta é um caminho ESPERADO, não uma borda rara.
 *  2. **Encerrar 2× mostra o mesmo papel**: sem retrospecto na resposta, o
 *     pop-up BUSCA o que já existe em vez de esperar um novo.
 *  3. **Não existe nota de 0 a 10** — o número grande é cobertura, com o
 *     denominador na tela.
 *  4. **Download é `<a href download>`**, nunca `createObjectURL`.
 *  5. A11y: `role="dialog"`, foco na raiz ao abrir, `Esc` fecha, foco volta.
 */

const RETROSPECTO: RetrospectoDaSessao = {
  sessao_id: "s1",
  jornada_id: "j1",
  origem: "derivado",
  schema_versao: 1,
  blocos_com_atividade: 9,
  blocos_no_roteiro: 13,
  evidencias_redigidas_em: null,
  criado_em: "2026-09-19T20:00:00Z",
  conteudo: {
    versao: 1,
    cobertura: {
      blocos_com_atividade: 9,
      blocos_no_roteiro: 13,
      nao_percorridos: [{ id: "b11", titulo: "PARTE 11 — Fechamento", indice: 10 }],
    },
    duracao: { iniciado_em: "2026-09-19T18:00:00Z", encerrado_em: "2026-09-19T19:54:00Z", minutos: 114 },
    patrimonio: {
      total_itens_proprios: 31,
      total_itens_incertos: 4,
      por_categoria: [{ categoria: "imovel", contagem_propria: 20, contagem_incerta: 4, sem_titularidade: 3 }],
    },
    observacoes_do_cliente: [
      { origem: "ficha", categoria: "objecao", tipo: null, texto: "Tem dois filhos de casamentos diferentes.", evidencia: "são dois de um e um de outro", n: 3, confianca: null },
      { origem: "observacao", categoria: null, tipo: "inferencia", texto: "Decide junto com a esposa.", evidencia: null, n: 1, confianca: 0.68 },
    ],
    pontos_de_melhoria: [{ item: "Não perguntou sobre dívidas da empresa.", n: 2, bloco_id: "b4", bloco_titulo: "PARTE 04 — Radiografia" }],
    saude_do_motor: {
      sugestoes: 178,
      confianca_media: 0.66,
      sugestoes_com_evidencia_nao_conferida: 107,
      execucoes_ia: 299,
      execucoes_truncadas: 49,
    },
    podado: false,
    nota_de_rodape: "Cobertura é fração do roteiro com registro do copiloto — não é nota de condução.",
  },
};

const fetchOriginal = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

function responder(status: number, corpo: unknown) {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  });
}

describe("PopupRetrospecto — o retrospecto que veio junto do encerramento", () => {
  it("mostra a COBERTURA com o denominador na tela — nunca uma nota de 0 a 10", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    // 22/09/2026: a cobertura deixou de ser número-herói isolado e virou uma
    // linha de `dl` no rodapé de telemetria — o denominador continua na tela,
    // que é a regra (nunca nota de 0 a 10, sempre NUMERADOR de DENOMINADOR).
    expect(container.textContent).toContain("9 de 13 partes com registro do copiloto");
    expect(container.textContent).toContain(RETROSPECTO.conteudo.nota_de_rodape);
    // Nenhuma requisição: o documento já veio com a resposta do encerramento.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("traz os fatos medidos e as observações separadas por tipo", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    expect(container.textContent).toContain("1 h 54 min");
    expect(container.textContent).toContain("35 captados");
    // 22/09/2026: o rótulo saiu de dentro da linha e virou SUBTÍTULO de grupo,
    // por isso no plural — os fatos passaram a ser agrupados por assunto.
    expect(container.textContent).toContain("Objeç");
    expect(container.textContent).toContain("Inferência");
    expect(container.textContent).toContain("Tem dois filhos de casamentos diferentes.");
    expect(container.textContent).toContain("Não perguntou sobre dívidas da empresa.");
    expect(container.textContent).toContain("PARTE 11 — Fechamento");
  });

  it("FE-7 — baixar é um `<a href download>` para a rota, sem trocar de página e sem Blob", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    const link = container.querySelector("a[download]") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe(caminhoRetrospecto("s1", "docx"));
    expect(link.textContent).toContain(".docx");
  });

  it("aponta para onde consultar depois, sem inventar uma página nova", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    expect(container.querySelector('a[href="/jornadas/j1#retrospecto"]')).not.toBeNull();
  });
});

describe("PopupRetrospecto — sem retrospecto na resposta", () => {
  it("BUSCA o que já existe (encerrar 2× mostra o mesmo papel, nunca dois)", async () => {
    responder(200, RETROSPECTO);
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);

    await waitFor(() => expect(container.textContent).toContain("de 13 partes com registro do copiloto"));
    expect(global.fetch).toHaveBeenCalledWith(caminhoRetrospecto("s1"), expect.anything());
  });

  it("404 → stub ROTULADO, nunca um corpo vazio disfarçado de retrospecto", async () => {
    responder(404, { erro: "nao_encontrado", mensagem: "Sem retrospecto" });
    const { container, queryByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);

    await waitFor(() => expect(container.textContent).toContain("Não foi possível montar o retrospecto desta sessão."));
    // Nada de cobertura, nada de zeros, nada de "0 de 0 partes".
    expect(container.textContent).not.toContain("partes com registro");
    expect(container.textContent).not.toContain("Cobertura do roteiro");
    // Sem documento, não há o que baixar.
    expect(container.querySelector("a[download]")).toBeNull();
    // 404 é estado, não falha transiente: insistir não faz um documento existir.
    expect(queryByRole("button", { name: /tentar de novo/i })).toBeNull();
  });

  it("falha transiente (500) oferece 'Tentar de novo' — e o retry funciona", async () => {
    responder(500, { erro: "interno", mensagem: "falhou" });
    const { container, getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("Não foi possível montar o retrospecto desta sessão."));

    responder(200, RETROSPECTO);
    fireEvent.click(getByRole("button", { name: /tentar de novo/i }));

    await waitFor(() => expect(container.textContent).toContain("de 13 partes com registro do copiloto"));
  });
});

describe("PopupRetrospecto — a11y", () => {
  /** Harness com o botão que abre: é ele que precisa receber o foco de volta. */
  function Harness() {
    const [aberto, setAberto] = useState(false);
    const gatilhoRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={gatilhoRef} type="button" onClick={() => setAberto(true)}>
          Encerrar copiloto desta sessão
        </button>
        {aberto && (
          <PopupRetrospecto
            sessaoId="s1"
            retrospectoInicial={RETROSPECTO}
            aoFechar={() => {
              setAberto(false);
              gatilhoRef.current?.focus();
            }}
          />
        )}
      </>
    );
  }

  it("abre em `role=dialog` + `aria-modal`, com o foco na raiz", () => {
    const { getByRole } = montar(<Harness />);
    fireEvent.click(getByRole("button", { name: /encerrar copiloto/i }));

    const dialogo = getByRole("dialog");
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialogo);
  });

  it("Esc fecha e devolve o foco a quem abriu", () => {
    const { getByRole, queryByRole } = montar(<Harness />);
    const gatilho = getByRole("button", { name: /encerrar copiloto/i });
    fireEvent.click(gatilho);
    expect(getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it("o botão 'Fechar' faz o mesmo", () => {
    const { getByRole, queryByRole } = montar(<Harness />);
    const gatilho = getByRole("button", { name: /encerrar copiloto/i });
    fireEvent.click(gatilho);
    fireEvent.click(getByRole("button", { name: /fechar/i }));
    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  /**
   * D-5 — FOCUS TRAP. `aria-modal="true"` PROMETE que o resto da página não
   * existe enquanto o diálogo está aberto; sem prender o Tab, quem navega por
   * teclado sai para uma árvore que a tecnologia assistiva já declarou
   * inexistente. jsdom não move foco por Tab sozinho (não há gerenciador de
   * foco nativo), então o que se testa aqui é a DECISÃO do handler — o
   * `preventDefault` e para onde ele manda o foco. A prova de que o ciclo
   * fecha de verdade é em Chromium, registrada no scratchpad.
   */
  describe("focus trap", () => {
    function tab({ shift = false } = {}) {
      const evento = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
      document.dispatchEvent(evento);
      return evento;
    }

    it("Tab no ÚLTIMO controle volta para o primeiro, em vez de sair do diálogo", () => {
      const { getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
      const baixar = getByRole("link", { name: /baixar/i });
      const fechar = getByRole("button", { name: /fechar/i });
      const linkFicha = getByRole("link", { name: /abrir o retrospecto na ficha/i });

      linkFicha.focus();
      const evento = tab();

      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(baixar);
      // Sanidade: os 3 controles do documento existem e estão nesta ordem.
      expect([baixar, fechar, linkFicha].every((el) => el.isConnected)).toBe(true);
    });

    it("Shift+Tab no PRIMEIRO controle vai para o último, fechando o ciclo pelo outro lado", () => {
      const { getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
      const baixar = getByRole("link", { name: /baixar/i });
      const linkFicha = getByRole("link", { name: /abrir o retrospecto na ficha/i });

      baixar.focus();
      const evento = tab({ shift: true });

      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(linkFicha);
    });

    it("foco fora do diálogo (o `<body>` logo depois de abrir) é puxado para dentro", () => {
      const { getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.focus();

      const evento = tab();

      expect(evento.defaultPrevented).toBe(true);
      expect(getByRole("dialog").contains(document.activeElement)).toBe(true);
    });

    it("estado 'carregando': o ciclo tem UM controle ('Fechar') e mesmo assim não vaza", () => {
      // Sem `retrospectoInicial` e com a resposta pendente, o corpo é o
      // spinner — o único focável é o "Fechar" do cabeçalho. Um ciclo de um
      // elemento ainda é um ciclo: o Tab nele volta para ele mesmo, nunca
      // para a página por baixo.
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
      const { getByRole, getAllByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);
      expect(getAllByRole("button")).toHaveLength(1);

      const fechar = getByRole("button", { name: /fechar/i });
      fechar.focus();
      const evento = tab();

      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(fechar);
    });

    it("a partir da RAIZ, o Tab segue naturalmente — o próximo destino já é dentro do diálogo", () => {
      // Aqui NÃO se prende: prender seria pular o primeiro controle. O foco
      // nasce na raiz (`tabIndex={-1}`) e o próximo `Tab` do navegador cai
      // no primeiro focável, que já está dentro.
      const { getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
      expect(document.activeElement).toBe(getByRole("dialog"));

      expect(tab().defaultPrevented).toBe(false);
    });

    it("no STUB o ciclo também fecha — 'Tentar de novo' e 'Fechar', nada além", async () => {
      responder(500, { erro: "interno", mensagem: "falhou" });
      const { container, getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);
      await waitFor(() => expect(container.textContent).toContain("Não foi possível montar"));

      const fechar = getByRole("button", { name: /fechar/i });
      const tentar = getByRole("button", { name: /tentar de novo/i });
      tentar.focus();
      const evento = tab();

      expect(evento.defaultPrevented).toBe(true);
      // "Fechar" vem antes de "Tentar de novo" na ordem do DOM (cabeçalho
      // antes do corpo), então o ciclo volta para ele.
      expect(document.activeElement).toBe(fechar);
    });
  });

  it("a camada do pop-up vence a do AppShell (D-5): `z-[60]`, acima do `z-50` compartilhado", () => {
    const { getByRole } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    expect(getByRole("dialog").className).toContain("z-[60]");
  });

  it("axe limpo com o documento na tela", async () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    await semViolacoes(container);
  });

  it("axe limpo com o stub", async () => {
    responder(404, { erro: "nao_encontrado" });
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={null} aoFechar={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("Não foi possível montar"));
    await semViolacoes(container);
  });
});

describe("CorpoRetrospecto — vazio é vazio, nunca zero", () => {
  /** Sessão magra e REAL: 4/13 partes, nada de patrimônio, nada apontado,
   * sem janela para medir truncamento. Os números medidos em produção em
   * 19/09 incluem exatamente este caso (uma das 3 sessões tem
   * `inventario_acumulado` = 0). */
  const MAGRO: RetrospectoDaSessao = {
    ...RETROSPECTO,
    blocos_com_atividade: 4,
    conteudo: {
      ...RETROSPECTO.conteudo,
      cobertura: { blocos_com_atividade: 4, blocos_no_roteiro: 13, nao_percorridos: [] },
      duracao: { iniciado_em: null, encerrado_em: null, minutos: null },
      patrimonio: null,
      observacoes_do_cliente: [],
      pontos_de_melhoria: [],
      saude_do_motor: { sugestoes: 0, confianca_media: null, sugestoes_com_evidencia_nao_conferida: 0, execucoes_ia: null, execucoes_truncadas: null },
    },
  };

  it("escreve a ausência por extenso, sem inventar número nem porcentagem", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={MAGRO} aoFechar={() => {}} />);

    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("de 13 partes com registro do copiloto");
    expect(container.textContent).toContain("não registrada");
    expect(container.textContent).toContain("nenhum item mencionado");
    expect(container.textContent).toContain("Nenhuma observação registrada durante a sessão.");
    expect(container.textContent).toContain("Nada ficou apontado como não perguntado durante a sessão.");
    expect(container.textContent).toContain("não foi possível medir nesta sessão");
    // Nunca uma porcentagem pronta, nunca um zero disfarçado de medida.
    expect(container.textContent).not.toContain("0 captados");
    expect(container.textContent).not.toContain("0 min");
    expect(container.textContent).not.toMatch(/\d+%/);
  });

  it("proporção sempre com denominador na tela — nunca '60%'", () => {
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={RETROSPECTO} aoFechar={() => {}} />);
    expect(container.textContent).toContain("107 de 178 com evidência não conferida");
    expect(container.textContent).toContain("49 de 299 respostas da IA truncadas");
    expect(container.textContent).not.toMatch(/\d+%/);
  });

  it("poda e expurgo são DITOS, nunca omitidos em silêncio", () => {
    const podado: RetrospectoDaSessao = {
      ...RETROSPECTO,
      evidencias_redigidas_em: "2026-10-01T00:00:00Z",
      conteudo: { ...RETROSPECTO.conteudo, podado: true },
    };
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={podado} aoFechar={() => {}} />);
    expect(container.textContent).toContain("cortada por tamanho");
    expect(container.textContent).toContain("citações literais deste documento já foram removidas");
  });

  it("a nota de rodapé vem do DOCUMENTO (artefato congelado), não de uma constante da tela", () => {
    const outro: RetrospectoDaSessao = {
      ...RETROSPECTO,
      conteudo: { ...RETROSPECTO.conteudo, nota_de_rodape: "Frase congelada de outra versão do documento." },
    };
    const { container } = montar(<PopupRetrospecto sessaoId="s1" retrospectoInicial={outro} aoFechar={() => {}} />);
    expect(container.textContent).toContain("Frase congelada de outra versão do documento.");
  });
});

/**
 * D-4 — o caminho para o documento quando o pop-up NÃO abre (encerramento por
 * duração máxima). A regra dura: link só existe se o documento existir.
 */
describe("LinkRetrospecto — o link da linha sóbria", () => {
  it("com retrospecto gravado, aponta para `/jornadas/<id>#retrospecto`", async () => {
    responder(200, RETROSPECTO);
    const { findByRole } = montar(<LinkRetrospecto sessaoId="s1" />);

    const link = await findByRole("link", { name: /ver o retrospecto/i });
    expect(link.getAttribute("href")).toBe("/jornadas/j1#retrospecto");
    expect(global.fetch).toHaveBeenCalledWith(caminhoRetrospecto("s1"), expect.anything());
  });

  it("sem retrospecto (404): NENHUM link — nunca um caminho para gaveta vazia", async () => {
    responder(404, { erro: "retrospecto_nao_encontrado", mensagem: "não há" });
    const { container } = montar(<LinkRetrospecto sessaoId="s1" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("a")).toBeNull());
  });

  it("falha de rede é silêncio, não alarme: a sessão acabou e isto é um extra", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rede"));
    const { container } = montar(<LinkRetrospecto sessaoId="s1" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("uma requisição, UMA vez — o polling já parou, nada de caminho quente novo", async () => {
    responder(200, RETROSPECTO);
    const { findByRole } = montar(<LinkRetrospecto sessaoId="s1" />);
    await findByRole("link", { name: /ver o retrospecto/i });
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("alvo de 44 px — a linha sóbria continua sóbria, mas o link é clicável de verdade", async () => {
    responder(200, RETROSPECTO);
    const { findByRole } = montar(<LinkRetrospecto sessaoId="s1" />);
    const link = await findByRole("link", { name: /ver o retrospecto/i });
    expect(link.className).toContain("min-h-11");
  });
});
