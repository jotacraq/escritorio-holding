import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cifrarToken, decifrarToken, reselarToken } from "./token-cifrado";
import { CAMPOS_LIGACAO_IA_EQUIPE, projetarParaEquipe } from "./tipos";
import type { LigacaoIa } from "@/types/integracoes";

/**
 * B1 do pentest (06/09/2026): o v1 cifrava sem AAD, então o blob de uma ligação
 * decifrava em qualquer outra linha. GCM provava que ninguém FORJOU o texto,
 * mas não que ele veio DAQUELA linha — e o texto é a credencial do link `/p/a`
 * de um cliente específico. O v2 sela o `id` da ligação como dado associado.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "tok_" + "z".repeat(40);

const envOriginal = { ...process.env };
beforeEach(() => {
  process.env.LINK_PUBLICO_PEPPER = "pepper-de-teste-com-tamanho-suficiente-para-o-hkdf";
});
afterEach(() => {
  process.env = { ...envOriginal };
});

describe("token-cifrado · ida e volta", () => {
  it("decifra o que cifrou, na MESMA ligação", () => {
    expect(decifrarToken(cifrarToken(TOKEN, A), A)).toBe(TOKEN);
  });

  it("é v2 e traz quatro partes (versão, iv, tag, cifra)", () => {
    const blob = cifrarToken(TOKEN, A)!;
    expect(blob.startsWith("v2.")).toBe(true);
    expect(blob.split(".")).toHaveLength(4);
  });

  it("nunca guarda o token em claro", () => {
    expect(cifrarToken(TOKEN, A)).not.toContain(TOKEN);
  });

  it("IV é sorteado a cada cifra: o mesmo token dá blobs diferentes", () => {
    expect(cifrarToken(TOKEN, A)).not.toBe(cifrarToken(TOKEN, A));
  });
});

describe("token-cifrado · AAD (a correção do B1)", () => {
  it("o blob de uma ligação NÃO abre em outra", () => {
    const blob = cifrarToken(TOKEN, A)!;
    expect(decifrarToken(blob, A)).toBe(TOKEN);
    expect(decifrarToken(blob, B)).toBeNull();
  });

  it("sem `ligacaoId` não cifra nem decifra — some, não vaza", () => {
    expect(cifrarToken(TOKEN, "")).toBeNull();
    expect(decifrarToken(cifrarToken(TOKEN, A), "")).toBeNull();
  });

  it("adulterar qualquer parte devolve null (GCM autentica)", () => {
    const [v, iv, tag, dados] = cifrarToken(TOKEN, A)!.split(".");
    expect(decifrarToken([v, iv, tag, dados.slice(0, -2) + "AA"].join("."), A)).toBeNull();
    expect(decifrarToken([v, iv, tag.slice(0, -2) + "AA", dados].join("."), A)).toBeNull();
    expect(decifrarToken([v, iv.slice(0, -2) + "AA", tag, dados].join("."), A)).toBeNull();
  });

  it("pepper trocado devolve null (o banco sozinho não vale nada)", () => {
    const blob = cifrarToken(TOKEN, A)!;
    process.env.LINK_PUBLICO_PEPPER = "outro-pepper-igualmente-comprido-e-diferente";
    expect(decifrarToken(blob, A)).toBeNull();
  });

  it("sem pepper, cifrar e decifrar devolvem null em vez de lançar", () => {
    delete process.env.LINK_PUBLICO_PEPPER;
    expect(cifrarToken(TOKEN, A)).toBeNull();
    expect(decifrarToken("v2.aa.bb.cc", A)).toBeNull();
  });

  /**
   * O v1 deixou de existir de propósito: a coluna `token_link_cifrado` nasce na
   * 0073, que ainda não foi aplicada — não há um único valor v1 no mundo.
   * Aceitá-lo seria manter para sempre um caminho sem AAD que ninguém usou.
   */
  it("formato v1 e lixo devolvem null, sem lançar", () => {
    for (const v of ["v1.aa.bb.cc", "v3.aa.bb.cc", "", "abc", "a.b.c", "a.b.c.d.e", null, undefined]) {
      expect(decifrarToken(v, A)).toBeNull();
    }
  });
});

describe("reselarToken · B2, a retentativa herda o link do sistema", () => {
  it("abre com o id de origem e sela para o id de destino", () => {
    const blob = cifrarToken(TOKEN, A)!;
    const herdado = reselarToken(blob, A, B)!;
    expect(herdado).not.toBe(blob);
    expect(decifrarToken(herdado, B)).toBe(TOKEN);
    // E continua valendo só para a linha certa.
    expect(decifrarToken(herdado, A)).toBeNull();
  });

  it("herdar nada, herdar de origem errada ou sem pepper devolve null — nunca erro", () => {
    expect(reselarToken(null, A, B)).toBeNull();
    expect(reselarToken("", A, B)).toBeNull();
    expect(reselarToken(cifrarToken(TOKEN, A), B, A)).toBeNull();
    delete process.env.LINK_PUBLICO_PEPPER;
    expect(reselarToken("v2.aa.bb.cc", A, B)).toBeNull();
  });
});

/**
 * I1 do pentest: o POST da Ficha caía num fallback que devolvia a linha crua de
 * `insert().select("*")` — com `token_link_cifrado` dentro. Um caminho de erro
 * não pode ser mais permissivo que o caminho feliz.
 */
describe("projetarParaEquipe · I1", () => {
  const linha = {
    id: A,
    jornada_id: B,
    status: "na_fila",
    tentativa: 1,
    telefone: "+5511987654321",
    token_link_cifrado: "v2.segredo.que.nao.pode.sair",
    coluna_futura_qualquer: "também não sai",
  } as unknown as LigacaoIa;

  it("remove `token_link_cifrado` e qualquer coluna não listada", () => {
    const projetada = projetarParaEquipe(linha) as unknown as Record<string, unknown>;
    expect(projetada).not.toHaveProperty("token_link_cifrado");
    expect(projetada).not.toHaveProperty("coluna_futura_qualquer");
    expect(JSON.stringify(projetada)).not.toContain("v2.segredo");
  });

  it("mantém o que a equipe precisa ver", () => {
    const projetada = projetarParaEquipe(linha) as unknown as Record<string, unknown>;
    expect(projetada.id).toBe(A);
    expect(projetada.status).toBe("na_fila");
    expect(projetada.telefone).toBe("+5511987654321");
  });

  it("é uma allowlist: nunca inventa campo que a linha não tinha", () => {
    const projetada = projetarParaEquipe({ id: A } as unknown as LigacaoIa) as unknown as Record<string, unknown>;
    expect(Object.keys(projetada)).toEqual(["id"]);
  });

  it("a allowlist e a lista de colunas do SELECT são a MESMA coisa", () => {
    expect(CAMPOS_LIGACAO_IA_EQUIPE).not.toContain("token_link_cifrado");
    expect(CAMPOS_LIGACAO_IA_EQUIPE.length).toBeGreaterThan(20);
  });
});
