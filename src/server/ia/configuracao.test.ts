import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfiguracoesBool } from "./configuracao";

/**
 * `lerConfiguracoesBool` — leitura em LOTE de flags booleanas (18/09/2026,
 * achado do Fable na revisão da memória do copiloto).
 *
 * Existe porque `montarEstadoCopiloto` roda no GET de POLLING (a cada 3 s com
 * a tela em foco) e fazia uma requisição ao PostgREST por flag. Este leitor
 * troca N requisições por UMA (`in('chave', [...])`).
 *
 * O contrato que estes testes trancam é o de SEGURANÇA, não o de performance:
 * cada chave cai no SEU padrão quando o banco não responde o esperado — nunca
 * no lado oposto, e nunca derrubando quem chamou.
 */

function clienteFalso(resposta: {
  data?: Array<{ chave: string; valor: unknown }> | null;
  error?: unknown;
  lanca?: boolean;
}): SupabaseClient {
  const builder = {
    select: () => builder,
    in: () => builder,
    returns: async () => {
      if (resposta.lanca) throw new Error("driver sem .in / rede caiu");
      return { data: resposta.data ?? null, error: resposta.error ?? null };
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("lerConfiguracoesBool — cada chave cai no SEU padrão", () => {
  it("lê os valores presentes e respeita o padrão das chaves ausentes", async () => {
    const supabase = clienteFalso({
      data: [{ chave: "a.ligada", valor: true }],
      // "b.desligada" não vem na resposta — é o que o PostgREST faz com chave inexistente
    });

    const flags = await lerConfiguracoesBool(supabase, { "a.ligada": false, "b.desligada": false });

    expect(flags["a.ligada"]).toBe(true);
    expect(flags["b.desligada"]).toBe(false);
  });

  it("aceita booleano em texto ('true'/'false'), como as leituras unitárias já faziam", async () => {
    const supabase = clienteFalso({
      data: [
        { chave: "x", valor: "true" },
        { chave: "y", valor: "false" },
      ],
    });

    const flags = await lerConfiguracoesBool(supabase, { x: false, y: true });

    expect(flags.x).toBe(true);
    expect(flags.y).toBe(false);
  });

  it("valor de tipo inesperado mantém o padrão — nunca inventa booleano", async () => {
    const supabase = clienteFalso({ data: [{ chave: "x", valor: { algo: 1 } }] });
    const flags = await lerConfiguracoesBool(supabase, { x: true });
    expect(flags.x).toBe(true);
  });

  it("🔴 erro do banco: CADA chave cai no SEU padrão — fail-OPEN e fail-CLOSED convivem", async () => {
    const supabase = clienteFalso({ error: { message: "boom" } });

    const flags = await lerConfiguracoesBool(supabase, {
      "copiloto_sessao.inventario_mencionado": true, // fail-OPEN
      "copiloto_sessao.resumo_acumulado": false, // fail-CLOSED (B76)
    });

    expect(flags["copiloto_sessao.inventario_mencionado"]).toBe(true);
    expect(flags["copiloto_sessao.resumo_acumulado"]).toBe(false);
  });

  /**
   * 🔴 O caso que apareceu de verdade: um mock de teste sem `.in` fez a query
   * LANÇAR, e o throw subiu pela rota de polling virando **HTTP 500** na tela
   * ao vivo. Em produção o cliente real tem `.in`, mas a lição vale: config
   * ilegível não pode derrubar quem chamou.
   */
  it("🔴 a query LANÇA: devolve os padrões em vez de propagar a exceção", async () => {
    const supabase = clienteFalso({ lanca: true });

    const flags = await lerConfiguracoesBool(supabase, { "a.open": true, "b.closed": false });

    expect(flags["a.open"]).toBe(true);
    expect(flags["b.closed"]).toBe(false);
  });

  it("chave devolvida que não foi pedida é ignorada — não contamina o resultado", async () => {
    const supabase = clienteFalso({
      data: [
        { chave: "pedida", valor: true },
        { chave: "intrusa", valor: true },
      ],
    });

    const flags = await lerConfiguracoesBool(supabase, { pedida: false });

    expect(flags.pedida).toBe(true);
    expect(Object.keys(flags)).toEqual(["pedida"]);
  });
});
