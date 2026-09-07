import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirOrcamento, inicioDoDiaSp } from "./ia";
import { montarConfigAgente, CONFIG_PADRAO, CHAVE_ATIVO, CHAVE_TETO_IA_DIA } from "./config";

/**
 * O orçamento próprio do agente (C3/D19) e o interruptor.
 *
 * Por que orçamento próprio: `verificar_cooldown_ia` tem cooldown de 600 s POR
 * JORNADA — calaria o agente na segunda mensagem do cliente — e o teto diário
 * compara `criado_por = p_perfil` com um perfil que o agente não tem, então
 * nunca dispararia. Trava errada aperta, trava certa não existe.
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

describe("conferirOrcamento", () => {
  it("passa quando as duas contas estão abaixo do teto", async () => {
    const r = await conferirOrcamento(cliente([COM_PROMPT, { count: 3, error: null }, { count: 1, error: null }]), {
      jornadaId: "j1",
      tetoDia: 100,
      tetoJornadaDia: 10,
    });
    expect(r).toMatchObject({ dentro: true, noDia: 3, naJornadaNoDia: 1, motivo: null });
  });

  it("barra no teto do DIA", async () => {
    const r = await conferirOrcamento(cliente([COM_PROMPT, { count: 100, error: null }, { count: 0, error: null }]), {
      jornadaId: "j1",
      tetoDia: 100,
      tetoJornadaDia: 10,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "teto_ia_dia" });
  });

  it("barra no teto da JORNADA no dia", async () => {
    const r = await conferirOrcamento(cliente([COM_PROMPT, { count: 5, error: null }, { count: 10, error: null }]), {
      jornadaId: "j1",
      tetoDia: 100,
      tetoJornadaDia: 10,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "teto_ia_jornada_dia" });
  });

  it("prompt inexistente (0090 não aplicada) NÃO libera IA", async () => {
    const r = await conferirOrcamento(cliente([{ data: [], error: null }]), { jornadaId: "j1", tetoDia: 100, tetoJornadaDia: 10 });
    expect(r).toMatchObject({ dentro: false, motivo: "prompt_do_agente_inexistente" });
  });

  it("não saber quanto já se gastou NÃO é licença para gastar", async () => {
    const r = await conferirOrcamento(cliente([COM_PROMPT, { error: { code: "42P01", message: "sem tabela" } }]), {
      jornadaId: "j1",
      tetoDia: 100,
      tetoJornadaDia: 10,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "falha_ao_contar_orcamento" });
  });
});

describe("inicioDoDiaSp — a janela do orçamento é o dia de São Paulo", () => {
  it("11h de SP e 23h de SP caem no MESMO dia", () => {
    expect(inicioDoDiaSp(Date.parse("2026-09-07T14:00:00Z"))).toBe("2026-09-07T03:00:00.000Z");
    expect(inicioDoDiaSp(Date.parse("2026-09-08T02:00:00Z"))).toBe("2026-09-07T03:00:00.000Z");
  });

  it("00h30 de SP já é o dia seguinte, e não o anterior", () => {
    expect(inicioDoDiaSp(Date.parse("2026-09-08T03:30:00Z"))).toBe("2026-09-08T03:00:00.000Z");
  });
});

describe("montarConfigAgente — o desligado é o default", () => {
  it("mapa vazio = agente desligado com os tetos de código", () => {
    expect(montarConfigAgente(new Map())).toEqual(CONFIG_PADRAO);
  });

  it("só `true` de verdade liga", () => {
    for (const valor of [true, "true", 1, "sim", null, undefined]) {
      const esperado = valor === true;
      expect(montarConfigAgente(new Map([[CHAVE_ATIVO, { valor }]])).ativo).toBe(esperado);
    }
  });

  it("teto inválido cai no padrão em vez de virar 0 (que zeraria o agente)", () => {
    expect(montarConfigAgente(new Map([[CHAVE_TETO_IA_DIA, { valor: -3 }]])).tetoIaDia).toBe(CONFIG_PADRAO.tetoIaDia);
    expect(montarConfigAgente(new Map([[CHAVE_TETO_IA_DIA, { valor: "muitos" }]])).tetoIaDia).toBe(CONFIG_PADRAO.tetoIaDia);
    expect(montarConfigAgente(new Map([[CHAVE_TETO_IA_DIA, { valor: 42 }]])).tetoIaDia).toBe(42);
  });
});

describe("teto de IA zerado — desliga só a IA, mantém o texto fixo", () => {
  it("`0` é valor válido e NÃO cai no padrão (senão a tela diria uma coisa e o agente faria outra)", () => {
    expect(montarConfigAgente(new Map([[CHAVE_TETO_IA_DIA, { valor: 0 }]])).tetoIaDia).toBe(0);
  });

  it("com teto 0 o orçamento barra antes de qualquer chamada ao provedor", async () => {
    const r = await conferirOrcamento(cliente([COM_PROMPT, { count: 0, error: null }, { count: 0, error: null }]), {
      jornadaId: "j1",
      tetoDia: 0,
      tetoJornadaDia: 10,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "teto_ia_dia" });
  });
});
