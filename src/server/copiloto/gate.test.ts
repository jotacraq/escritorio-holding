import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirGateCopiloto } from "./gate";

/**
 * O gate jurídico PRÉ-IA (achado do `fable-orchestrator`, corrigido): decisão
 * ativa em `decisoes_juridicas` E consentimento do titular, conferidos ANTES
 * de montar contexto/chamar o provedor — não mais só no INSERT (trigger de
 * 0093, que agora é o BACKSTOP, não a trava primária).
 */

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  constructor(private readonly resultado: Resultado) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.resultado); }
  then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
    return Promise.resolve(this.resultado).then(ok) as PromiseLike<R1>;
  }
}

function cliente(porTabela: Record<string, Resultado>): SupabaseClient {
  return {
    from: (t: string) => new ConsultaFalsa(porTabela[t] ?? { data: null, error: { code: "42P01", message: `tabela não mockada: ${t}` } }),
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conferirGateCopiloto", () => {
  it("SEM decisão jurídica ativa → liberado=false, motivo sem_decisao_juridica (nem chega a checar consentimento)", async () => {
    const r = await conferirGateCopiloto(
      cliente({ decisoes_juridicas: { data: null, error: null } }),
      { sessaoId: "s1", pessoaId: "p1" },
    );
    expect(r).toEqual({ liberado: false, motivo: "sem_decisao_juridica" });
  });

  it("COM decisão ativa mas SEM consentimento → liberado=false, motivo sem_consentimento_titular", async () => {
    const r = await conferirGateCopiloto(
      cliente({
        decisoes_juridicas: { data: { id: "d1" }, error: null },
        consentimentos: { data: null, error: null },
      }),
      { sessaoId: "s1", pessoaId: "p1" },
    );
    expect(r).toEqual({ liberado: false, motivo: "sem_consentimento_titular" });
  });

  it("COM decisão ativa E consentimento concedido → liberado=true", async () => {
    const r = await conferirGateCopiloto(
      cliente({
        decisoes_juridicas: { data: { id: "d1" }, error: null },
        consentimentos: { data: { concedido: true, revogado_em: null }, error: null },
      }),
      { sessaoId: "s1", pessoaId: "p1" },
    );
    expect(r).toEqual({ liberado: true, motivo: null });
  });

  it("consentimento REVOGADO (revogado_em preenchido) → liberado=false, mesmo com concedido=true no passado", async () => {
    const r = await conferirGateCopiloto(
      cliente({
        decisoes_juridicas: { data: { id: "d1" }, error: null },
        consentimentos: { data: { concedido: true, revogado_em: "2026-09-01T00:00:00Z" }, error: null },
      }),
      { sessaoId: "s1", pessoaId: "p1" },
    );
    expect(r).toMatchObject({ liberado: false, motivo: "sem_consentimento_titular" });
  });

  it("falha de leitura (erro do banco) NUNCA libera — mesmo princípio do orçamento", async () => {
    const r = await conferirGateCopiloto(
      cliente({ decisoes_juridicas: { data: null, error: { code: "08006", message: "conexão perdida" } } }),
      { sessaoId: "s1", pessoaId: "p1" },
    );
    expect(r).toEqual({ liberado: false, motivo: "falha_ao_conferir_gate" });
  });
});
