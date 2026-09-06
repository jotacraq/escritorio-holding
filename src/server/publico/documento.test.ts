import { describe, expect, it, vi } from "vitest";

/**
 * Prova da decisão do teto de arquivos do upload público, com a leitura do link
 * e da tabela `configuracoes` MOCKADAS — não substitui o roteiro
 * `scripts/verificacao-0075.sql` (que prova a RPC no banco), prova só o que é
 * determinístico no TypeScript:
 *
 *  1. `resolverLinkParaUpload` traz `usos` DO LINK (o denominador do banco) na
 *     mesma consulta que já existia — nenhuma consulta a mais;
 *  2. `tetoDeArquivosBatido` decide contra esse `usos`, não contra a contagem
 *     de `documentos` da jornada (link reemitido volta a aceitar envio);
 *  3. `limiteArquivosPorLink` lê `configuracoes['link.limite_arquivos']` na
 *     faixa 1..50, com fallback 10 — a MESMA faixa que
 *     `app.limite_arquivos_por_link()` (0075) e que o zod de
 *     `src/server/admin/configuracoes.ts` aceitam;
 *  4. o zod da chave em Admin recusa fora de 1..50 e recusa não-inteiro.
 *
 * `documento.ts` guarda os tetos num cache de módulo (60 s), então cada teste
 * que depende dele faz `vi.resetModules()` + import dinâmico em vez de exigir
 * um "reset para teste" no código de produção.
 */

// `registrarErro` toca Sentry/console; aqui não interessa e não pode poluir a saída.
vi.mock("@/server/erros", () => ({ registrarErro: vi.fn() }));

const HASH = "a".repeat(64);

/** Cliente Supabase mínimo: só `.from(tabela)` com as cadeias que o código usa. */
function clienteFalso(opcoes: {
  link?: Record<string, unknown> | null;
  jornada?: Record<string, unknown> | null;
  configuracoes?: Array<{ chave: string; valor: unknown }> | null;
  erroConfiguracoes?: unknown;
}) {
  const colunasLidas: Record<string, string> = {};
  const tabelasLidas: string[] = [];

  const from = vi.fn((tabela: string) => {
    tabelasLidas.push(tabela);
    if (tabela === "configuracoes") {
      return {
        select: (colunas: string) => {
          colunasLidas[tabela] = colunas;
          return {
            in: async () => ({
              data: opcoes.erroConfiguracoes ? null : (opcoes.configuracoes ?? []),
              error: opcoes.erroConfiguracoes ?? null,
            }),
          };
        },
      };
    }
    return {
      select: (colunas: string) => {
        colunasLidas[tabela] = colunas;
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: tabela === "links_publicos" ? (opcoes.link ?? null) : (opcoes.jornada ?? null),
              error: null,
            }),
          }),
        };
      },
    };
  });

  return { cliente: { from } as never, from, colunasLidas, tabelasLidas };
}

const LINK_OK = {
  id: "11111111-1111-4111-8111-111111111111",
  jornada_id: "22222222-2222-4222-8222-222222222222",
  tipo: "documentos",
  estado: "ativo",
  expira_em: new Date(Date.now() + 86_400_000).toISOString(),
  usos: 3,
};

const JORNADA_OK = {
  id: "22222222-2222-4222-8222-222222222222",
  pessoa_id: "33333333-3333-4333-8333-333333333333",
  desfecho: "aberta",
};

async function carregarModulo() {
  vi.resetModules();
  return import("./documento");
}

describe("resolverLinkParaUpload — traz o denominador do banco", () => {
  it("devolve `usos` do link e o lê na consulta que já existia", async () => {
    const { resolverLinkParaUpload } = await carregarModulo();
    const { cliente, colunasLidas, tabelasLidas } = clienteFalso({ link: LINK_OK, jornada: JORNADA_OK });

    const resolvido = await resolverLinkParaUpload(cliente, HASH);

    expect(resolvido).toEqual({
      linkId: LINK_OK.id,
      jornadaId: JORNADA_OK.id,
      pessoaId: JORNADA_OK.pessoa_id,
      usos: 3,
    });
    // Zero consulta nova: `usos` entrou no MESMO select.
    expect(colunasLidas["links_publicos"]).toContain("usos");
    expect(tabelasLidas).toEqual(["links_publicos", "jornadas"]);
  });

  it("cai em 0 quando `usos` não vem (banco sem a coluna no cache do PostgREST), nunca em NaN", async () => {
    const { resolverLinkParaUpload } = await carregarModulo();
    const linkSemUsos: Record<string, unknown> = { ...LINK_OK };
    delete linkSemUsos.usos;
    const { cliente } = clienteFalso({ link: linkSemUsos, jornada: JORNADA_OK });

    await expect(resolverLinkParaUpload(cliente, HASH)).resolves.toMatchObject({ usos: 0 });
  });

  it.each([
    ["tipo errado", { ...LINK_OK, tipo: "formulario" }],
    ["link revogado", { ...LINK_OK, estado: "revogado" }],
    ["link expirado", { ...LINK_OK, expira_em: new Date(Date.now() - 1_000).toISOString() }],
  ])("continua recusando: %s", async (_nome, link) => {
    const { resolverLinkParaUpload } = await carregarModulo();
    const { cliente } = clienteFalso({ link, jornada: JORNADA_OK });
    await expect(resolverLinkParaUpload(cliente, HASH)).resolves.toBeNull();
  });

  it("continua recusando jornada fechada", async () => {
    const { resolverLinkParaUpload } = await carregarModulo();
    const { cliente } = clienteFalso({ link: LINK_OK, jornada: { ...JORNADA_OK, desfecho: "ganha" } });
    await expect(resolverLinkParaUpload(cliente, HASH)).resolves.toBeNull();
  });
});

describe("tetoDeArquivosBatido — o denominador é POR LINK", () => {
  it("libera abaixo do teto e recusa a partir dele (mesma comparação da RPC: `usos >= limite`)", async () => {
    const { tetoDeArquivosBatido } = await carregarModulo();
    expect(tetoDeArquivosBatido(0, 10)).toBe(false);
    expect(tetoDeArquivosBatido(9, 10)).toBe(false);
    expect(tetoDeArquivosBatido(10, 10)).toBe(true);
    expect(tetoDeArquivosBatido(11, 10)).toBe(true);
  });

  it("link REEMITIDO volta a aceitar envio — o defeito que esta mudança corrige", async () => {
    const { tetoDeArquivosBatido } = await carregarModulo();
    // A jornada já tem 10 documentos `origem='cliente'` do link anterior (o
    // denominador antigo recusaria), mas o link novo tem `usos = 0`: é o que o
    // banco vê em `registrar_documento_publico`, e agora a rota também.
    const documentosDaJornada = 10;
    const usosDoLinkNovo = 0;
    expect(documentosDaJornada >= 10).toBe(true); // denominador antigo: recusava
    expect(tetoDeArquivosBatido(usosDoLinkNovo, 10)).toBe(false); // novo: aceita
  });
});

describe("limiteArquivosPorLink — 1..50 com fallback 10", () => {
  it.each([
    ["valor válido no meio da faixa", 25, 25],
    ["mínimo da faixa", 1, 1],
    ["máximo da faixa", 50, 50],
    ["zero (fora)", 0, 10],
    ["negativo (fora)", -3, 10],
    ["acima do teto", 51, 10],
    ["não inteiro", 10.5, 10],
    ["string", "dez", 10],
    ["nulo", null, 10],
  ])("%s -> %s vira %s", async (_nome, bruto, esperado) => {
    const { limiteArquivosPorLink } = await carregarModulo();
    const { cliente } = clienteFalso({ configuracoes: [{ chave: "link.limite_arquivos", valor: bruto }] });
    await expect(limiteArquivosPorLink(cliente)).resolves.toBe(esperado);
  });

  it("chave ausente (banco sem a 0075) vale 10", async () => {
    const { limiteArquivosPorLink } = await carregarModulo();
    const { cliente } = clienteFalso({ configuracoes: [] });
    await expect(limiteArquivosPorLink(cliente)).resolves.toBe(10);
  });

  it("erro de leitura vale 10 e NÃO envenena o cache (a próxima chamada relê)", async () => {
    const { limiteArquivosPorLink } = await carregarModulo();
    const falho = clienteFalso({ erroConfiguracoes: { message: "boom" } });
    await expect(limiteArquivosPorLink(falho.cliente)).resolves.toBe(10);
    expect(falho.from).toHaveBeenCalledTimes(1);
    await expect(limiteArquivosPorLink(falho.cliente)).resolves.toBe(10);
    expect(falho.from).toHaveBeenCalledTimes(2);
  });

  it("cacheia por 60 s: duas leituras seguidas custam UMA consulta", async () => {
    const { limiteArquivosPorLink } = await carregarModulo();
    const { cliente, from } = clienteFalso({ configuracoes: [{ chave: "link.limite_arquivos", valor: 7 }] });
    await expect(limiteArquivosPorLink(cliente)).resolves.toBe(7);
    await expect(limiteArquivosPorLink(cliente)).resolves.toBe(7);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe("configuracoes['link.limite_arquivos'] — validação da tela de Admin", () => {
  it.each([1, 10, 50])("aceita %s", async (valor) => {
    const { SCHEMAS_CONFIGURACAO } = await import("@/server/admin/configuracoes");
    expect(SCHEMAS_CONFIGURACAO["link.limite_arquivos"].safeParse(valor).success).toBe(true);
  });

  it.each([0, -1, 51, 1000, 10.5, "10", null, true])("recusa %s", async (valor) => {
    const { SCHEMAS_CONFIGURACAO } = await import("@/server/admin/configuracoes");
    expect(SCHEMAS_CONFIGURACAO["link.limite_arquivos"].safeParse(valor).success).toBe(false);
  });

  it("a faixa do zod é a MESMA de `limiteArquivosPorLink` (uma não pode aceitar o que a outra ignora)", async () => {
    const { SCHEMAS_CONFIGURACAO } = await import("@/server/admin/configuracoes");
    const schema = SCHEMAS_CONFIGURACAO["link.limite_arquivos"];
    for (const valor of [0, 1, 25, 50, 51, 10.5]) {
      const { limiteArquivosPorLink } = await carregarModulo();
      const { cliente } = clienteFalso({ configuracoes: [{ chave: "link.limite_arquivos", valor }] });
      const aceitoPeloZod = schema.safeParse(valor).success;
      const aplicadoNaRota = (await limiteArquivosPorLink(cliente)) === valor;
      expect(aplicadoNaRota).toBe(aceitoPeloZod);
    }
  });
});
