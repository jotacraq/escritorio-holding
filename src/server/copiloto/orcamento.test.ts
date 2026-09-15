import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirOrcamentoCopiloto, inicioDoDiaSp } from "./orcamento";

/**
 * Orçamento próprio do copiloto (§4.4 do plano, CONFLITO C4) — mesmo
 * raciocínio de `agente-whatsapp/ia.test.ts`: duas contagens (sessão e dia),
 * cada uma com seu teto, e falha de leitura NUNCA libera.
 */

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  constructor(
    private readonly tabela: string,
    private readonly respostas: Resultado[],
    private readonly estado: { i: number },
  ) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  gte() { return this; }
  returns() { return this; }
  // `lerConfiguracaoInt` (server/ia/configuracao.ts) usa maybeSingle: chave
  // ausente → padrão do código (30/sessão, 150/dia), o que este teste explora
  // de propósito (não precisa mockar `configuracoes.valor` para os tetos).
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
    if (this.tabela === "prompts_versoes") return Promise.resolve(this.respostas[0]).then(ok) as PromiseLike<R1>;
    const r = this.respostas[1 + this.estado.i] ?? { count: 0, error: null };
    this.estado.i += 1;
    return Promise.resolve(r).then(ok) as PromiseLike<R1>;
  }
}

function cliente(respostas: Resultado[]): SupabaseClient {
  const estado = { i: 0 };
  return { from: (t: string) => new ConsultaFalsa(t, respostas, estado) } as unknown as SupabaseClient;
}

const COM_PROMPT: Resultado = { data: [{ id: "prompt-1" }], error: null };
const INICIO = "2026-09-11T13:00:00.000Z";

describe("conferirOrcamentoCopiloto", () => {
  it("passa quando as duas contas estão abaixo do teto (padrão desde 15/09/2026, migration 0102: 90/sessão, 450/dia)", async () => {
    const r = await conferirOrcamentoCopiloto(cliente([COM_PROMPT, { count: 5, error: null }, { count: 20, error: null }]), {
      jornadaId: "j1",
      inicioSessaoIso: INICIO,
    });
    expect(r).toMatchObject({ dentro: true, naSessao: 5, noDia: 20, motivo: null });
  });

  it("barra no teto da SESSÃO", async () => {
    const r = await conferirOrcamentoCopiloto(cliente([COM_PROMPT, { count: 90, error: null }, { count: 20, error: null }]), {
      jornadaId: "j1",
      inicioSessaoIso: INICIO,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "teto_ia_sessao" });
  });

  it("barra no teto do DIA (mesmo com a sessão dentro do próprio teto)", async () => {
    const r = await conferirOrcamentoCopiloto(cliente([COM_PROMPT, { count: 5, error: null }, { count: 450, error: null }]), {
      jornadaId: "j1",
      inicioSessaoIso: INICIO,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "teto_ia_dia" });
  });

  it("prompt inexistente (0094 não aplicada) NÃO libera IA", async () => {
    const r = await conferirOrcamentoCopiloto(cliente([{ data: [], error: null }]), { jornadaId: "j1", inicioSessaoIso: INICIO });
    expect(r).toMatchObject({ dentro: false, motivo: "prompt_do_copiloto_inexistente" });
  });

  it("não saber quanto já se gastou NÃO é licença para gastar", async () => {
    const r = await conferirOrcamentoCopiloto(cliente([COM_PROMPT, { error: { code: "42P01", message: "sem tabela" } }]), {
      jornadaId: "j1",
      inicioSessaoIso: INICIO,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "falha_ao_contar_orcamento" });
  });
});

describe("inicioDoDiaSp — mesma janela de São Paulo do agente de WhatsApp", () => {
  it("11h de SP e 23h de SP caem no MESMO dia", () => {
    expect(inicioDoDiaSp(Date.parse("2026-09-07T14:00:00Z"))).toBe("2026-09-07T03:00:00.000Z");
    expect(inicioDoDiaSp(Date.parse("2026-09-08T02:00:00Z"))).toBe("2026-09-07T03:00:00.000Z");
  });
});
