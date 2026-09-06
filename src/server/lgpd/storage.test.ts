import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUCKET_DOCUMENTOS, expurgarArquivos } from "./storage";

/**
 * O tempo 3/4 do expurgo (LGPD art. 18, VI). O que se prova aqui é o achado M2
 * do pentest da rodada 3: o `remove()` do storage-js devolve só o que EXISTIA,
 * então um objeto já removido numa tentativa anterior nunca voltava — ia para
 * `falhos`, a confirmação no banco não rodava e a retomada ficava presa para
 * sempre, com `storage_pendente` cheio e o arquivo já fora do bucket.
 */

interface Chamadas {
  remove: string[][];
  exists: string[];
  rpc: { nome: string; args: Record<string, unknown> }[];
}

function clienteFalso(opcoes: {
  /** O que o `remove` devolve como REALMENTE removido nesta chamada. */
  removidos?: string[];
  erroRemove?: { message: string } | null;
  /** Caminhos que ainda existem no bucket. */
  aindaExistem?: string[];
  erroExists?: { message: string } | null;
  erroRpc?: { message: string } | null;
}): { cliente: SupabaseClient; chamadas: Chamadas } {
  const chamadas: Chamadas = { remove: [], exists: [], rpc: [] };
  const cliente = {
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(BUCKET_DOCUMENTOS);
        return {
          async remove(caminhos: string[]) {
            chamadas.remove.push(caminhos);
            if (opcoes.erroRemove) return { data: null, error: opcoes.erroRemove };
            return { data: (opcoes.removidos ?? []).map((name) => ({ name })), error: null };
          },
          async exists(caminho: string) {
            chamadas.exists.push(caminho);
            if (opcoes.erroExists) return { data: false, error: opcoes.erroExists };
            return { data: (opcoes.aindaExistem ?? []).includes(caminho), error: null };
          },
        };
      },
    },
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.rpc.push({ nome, args });
      return { single: async () => ({ data: null, error: opcoes.erroRpc ?? null }) };
    },
  } as unknown as SupabaseClient;
  return { cliente, chamadas };
}

const A = "pessoas/abc/ir-2025.pdf";
const B = "pessoas/abc/contrato-social.pdf";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("expurgarArquivos", () => {
  it("lista vazia não chama Storage nem banco", async () => {
    const { cliente, chamadas } = clienteFalso({});
    expect(await expurgarArquivos(cliente, "sol-1", [], "p1")).toEqual({ removidos: 0, falhos: [] });
    expect(chamadas.remove).toEqual([]);
    expect(chamadas.rpc).toEqual([]);
  });

  it("confirma o que o Storage devolveu e chama a RPC com esses caminhos", async () => {
    const { cliente, chamadas } = clienteFalso({ removidos: [A, B] });
    expect(await expurgarArquivos(cliente, "sol-1", [A, B], "p1")).toEqual({ removidos: 2, falhos: [] });
    expect(chamadas.exists).toEqual([]); // nada duvidoso: nem pergunta
    expect(chamadas.rpc).toEqual([
      { nome: "confirmar_expurgo_storage", args: { p_solicitacao_id: "sol-1", p_caminhos: [A, B] } },
    ]);
  });

  it("M2: objeto que já não existe conta como REMOVIDO, e a retomada fecha", async () => {
    // O `remove` não devolve nada (os dois já tinham saído numa tentativa
    // anterior); o `exists` confirma que o bucket está limpo.
    const { cliente, chamadas } = clienteFalso({ removidos: [], aindaExistem: [] });
    const r = await expurgarArquivos(cliente, "sol-1", [A, B], "p1");
    expect(r).toEqual({ removidos: 2, falhos: [] });
    expect(chamadas.exists).toEqual([A, B]);
    expect(chamadas.rpc[0].args.p_caminhos).toEqual([A, B]);
  });

  it("o que AINDA está no bucket continua sendo falha, e não é confirmado", async () => {
    const { cliente, chamadas } = clienteFalso({ removidos: [A], aindaExistem: [B] });
    expect(await expurgarArquivos(cliente, "sol-1", [A, B], "p1")).toEqual({ removidos: 1, falhos: [B] });
    expect(chamadas.rpc[0].args.p_caminhos).toEqual([A]);
  });

  it("`exists` que falha não vira remoção otimista", async () => {
    const { cliente, chamadas } = clienteFalso({ removidos: [], erroExists: { message: "403" } });
    expect(await expurgarArquivos(cliente, "sol-1", [A], "p1")).toEqual({ removidos: 0, falhos: [A] });
    expect(chamadas.rpc).toEqual([]); // nada saiu: nada a confirmar
  });

  it("sem casamento por basename — dois clientes podem ter `rg.pdf`", async () => {
    const meu = "pessoas/abc/rg.pdf";
    const doVizinho = "pessoas/xyz/rg.pdf";
    // O Storage devolve só o nome do arquivo (é o formato que enganava antes).
    const { cliente } = clienteFalso({ removidos: ["rg.pdf"], aindaExistem: [meu, doVizinho] });
    expect(await expurgarArquivos(cliente, "sol-1", [meu, doVizinho], "p1")).toEqual({
      removidos: 0,
      falhos: [meu, doVizinho],
    });
  });

  it("erro no `remove` marca tudo como falho e não chama o banco", async () => {
    const { cliente, chamadas } = clienteFalso({ erroRemove: { message: "rede" } });
    expect(await expurgarArquivos(cliente, "sol-1", [A, B], "p1")).toEqual({ removidos: 0, falhos: [A, B] });
    expect(chamadas.rpc).toEqual([]);
  });

  it("objeto saiu mas o banco não soube: volta como falho para a retomada tentar de novo", async () => {
    const { cliente } = clienteFalso({ removidos: [A], erroRpc: { message: "42501" } });
    expect(await expurgarArquivos(cliente, "sol-1", [A], "p1")).toEqual({ removidos: 1, falhos: [A] });
  });

  it("L1: a confirmação vai pelo cliente ADMIN que a rota passou", async () => {
    const { cliente, chamadas } = clienteFalso({ removidos: [A] });
    await expurgarArquivos(cliente, "sol-1", [A], "p1");
    // Só existe um cliente na assinatura desde a 0081 — a RPC saiu de
    // `authenticated` e só `service_role` a executa.
    expect(chamadas.rpc).toHaveLength(1);
    expect(expurgarArquivos.length).toBe(4);
  });
});
