import { describe, expect, it } from "vitest";
import { TABS_FICHA, tabDoItem, interpretarHashFicha } from "./tabs";

/**
 * Fatia 3 — testes de mesa da parte PURA (catálogo das 4 tabs + decisão de
 * hash). O comportamento de UI (não-montar tab inativa, deep-link abrindo a
 * gaveta certa) é provado em `components/ficha360/TabsFicha.test.tsx`; aqui
 * é só a lógica, sem DOM.
 */

describe("TABS_FICHA — as 4 tabs, sempre visíveis (correção do João: 'não preciso ocultar')", () => {
  it("existem as 4 tabs, nesta ordem: Sessão, Documentos, Croqui, Holding", () => {
    expect(TABS_FICHA.map((t) => t.chave)).toEqual(["sessao", "documentos", "croqui", "holding"]);
  });

  it("não há flag de visibilidade — nenhuma propriedade 'oculta'/'visivelPadrao' no catálogo", () => {
    for (const tab of TABS_FICHA) {
      expect(Object.keys(tab).sort()).toEqual(["chave", "itens", "rotulo"]);
    }
  });
});

describe("tabDoItem — em qual tab cada gaveta vive", () => {
  it("os itens de Sessão (formulário fica fora: ele é da tab Sessão só por conta do agrupamento por sessão da Pasta)", () => {
    expect(tabDoItem("sessao")).toBe("sessao");
    expect(tabDoItem("briefing")).toBe("sessao");
    expect(tabDoItem("relatorio_sv")).toBe("sessao");
    expect(tabDoItem("analise_sessao")).toBe("sessao");
    expect(tabDoItem("diagnostico_sv")).toBe("sessao");
    expect(tabDoItem("material")).toBe("sessao");
  });

  it("documentos e patrimônio são da tab Documentos", () => {
    expect(tabDoItem("documentos")).toBe("documentos");
    expect(tabDoItem("patrimonio")).toBe("documentos");
  });

  it("item sem tab dona devolve null (ex.: 'formulario', que a página resolve pelo hash direto)", () => {
    expect(tabDoItem("formulario")).toBeNull();
    expect(tabDoItem("ligacao")).toBeNull();
    expect(tabDoItem("croqui")).toBeNull();
    expect(tabDoItem("familiares")).toBeNull();
    expect(tabDoItem("transcricao")).toBeNull();
  });
});

const ALIAS = { "analise-sessao": "analise_sessao", relatorio: "relatorio_sv", diagnostico: "diagnostico_sv", timeline: "historico", links: "enviar" };
const CHAVES_EM_GAVETA = new Set(["formulario", "ligacao", "documentos", "patrimonio", "briefing", "sessao", "material"]);

describe("interpretarHashFicha — o que cada hash de deep-link significa", () => {
  it("hash vazio não faz nada", () => {
    expect(interpretarHashFicha("", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "nenhuma" });
  });

  it("#formulario abre a gaveta 'formulario' (teste obrigatório #2 da Fatia 3)", () => {
    expect(interpretarHashFicha("formulario", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-gaveta", chave: "formulario" });
  });

  it("#ligacao (a aba de Contato) abre a gaveta 'ligacao'", () => {
    expect(interpretarHashFicha("ligacao", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-gaveta", chave: "ligacao" });
  });

  it("#historico abre a gaveta 'historico' DENTRO da tab Sessão (é lá que o botão Histórico vive)", () => {
    expect(interpretarHashFicha("historico", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-gaveta-na-tab", tab: "sessao", chave: "historico" });
  });

  it("#timeline (alias antigo) vira #historico e tem o MESMO efeito", () => {
    expect(interpretarHashFicha("timeline", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-gaveta-na-tab", tab: "sessao", chave: "historico" });
  });

  it("#croqui abre o details na tab Croqui (sempre visível — não precisa 'forçar' nada)", () => {
    expect(interpretarHashFicha("croqui", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-details-na-tab", tab: "croqui", idDoBloco: "croqui" });
  });

  it("#conversa abre o details na tab Sessão", () => {
    expect(interpretarHashFicha("conversa", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "abrir-details-na-tab", tab: "sessao", idDoBloco: "conversa" });
  });

  it("#enviar rola até a barra, sem abrir gaveta nem trocar tab", () => {
    expect(interpretarHashFicha("enviar", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "rolar-ate", alvo: "enviar" });
  });

  it("#links (alias antigo) vira #enviar", () => {
    expect(interpretarHashFicha("links", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "rolar-ate", alvo: "enviar" });
  });

  it("hash desconhecido (fora de ALIAS e de CHAVES_EM_GAVETA) não faz nada", () => {
    expect(interpretarHashFicha("nao-existe", ALIAS, CHAVES_EM_GAVETA)).toEqual({ tipo: "nenhuma" });
  });
});
