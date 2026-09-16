import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avaliarGatilho, decidirGatilho, type EstadoParaGatilho } from "./gatilho";

/**
 * Os TRÊS gatilhos do ciclo automático (Fase 10, Fatia 3, §4.3 do plano):
 * tempo+fala-nova, virada de bloco MANUAL (piso 8s), sob demanda (fora deste
 * módulo — o botão nunca passa por `avaliarGatilho`). "Nunca por turno de
 * fala. Nunca por cron fixo. Silêncio = zero chamada." — é isto que
 * `decidirGatilho` precisa provar sozinho, sem banco.
 *
 * Fase 12, Fatia 1: `virada_bloco` SÓ conta quando `blocoAtualOrigem ===
 * "manual"` — mudança de bloco por INFERÊNCIA da própria IA não é gatilho
 * (senão vira laço: inferiu → mudou → disparou → inferiu de novo).
 */

const AGORA = Date.parse("2026-09-11T14:00:00.000Z");

function estado(sobrescritas: Partial<EstadoParaGatilho> = {}): EstadoParaGatilho {
  return {
    ultimoCicloEm: null,
    houveSegmentoNovo: false,
    ultimoBlocoIndice: null,
    blocoAtualIndice: 0,
    blocoAtualOrigem: "manual",
    agoraMs: AGORA,
    intervaloSegundos: 45,
    ...sobrescritas,
  };
}

describe("decidirGatilho — núcleo puro", () => {
  it("SILÊNCIO TOTAL: sem ciclo anterior e sem segmento novo → não dispara (mesmo com bloco declarado)", () => {
    const r = decidirGatilho(estado({ houveSegmentoNovo: false }));
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("intervalo estourado MAS sem fala nova → NÃO dispara (o coração da regra §2.3: silêncio não gasta IA)", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 3600_000).toISOString(), // 1h atrás, bem além do intervalo
        houveSegmentoNovo: false,
      }),
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("fala nova MAS intervalo ainda não estourou → NÃO dispara (nunca por turno de fala)", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 10_000).toISOString(), // 10s atrás, intervalo é 45s
        houveSegmentoNovo: true,
      }),
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("intervalo estourado E fala nova → dispara por 'intervalo'", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 46_000).toISOString(),
        houveSegmentoNovo: true,
      }),
    );
    expect(r).toEqual({ dispara: true, gatilho: "intervalo" });
  });

  it("exatamente no limite do intervalo (46s ainda dentro de 45s) conta como estourado — >=, não >", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 45_000).toISOString(),
        houveSegmentoNovo: true,
        intervaloSegundos: 45,
      }),
    );
    expect(r.dispara).toBe(true);
  });

  it("PRIMEIRA avaliação da sessão (nunca claimou nada) com segmento existente → dispara por 'intervalo' (infinito >= 45)", () => {
    const r = decidirGatilho(estado({ ultimoCicloEm: null, houveSegmentoNovo: true }));
    expect(r).toEqual({ dispara: true, gatilho: "intervalo" });
  });

  it("virada de bloco MANUAL: mudou de índice, origem='manual', já passou o PISO de 8s → dispara por 'virada_bloco'", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 20_000).toISOString(),
        ultimoBlocoIndice: 2,
        blocoAtualIndice: 3,
        blocoAtualOrigem: "manual",
        houveSegmentoNovo: false,
      }),
    );
    expect(r).toEqual({ dispara: true, gatilho: "virada_bloco" });
  });

  it("virada de bloco ANTES do piso de 8s (martelada) → NÃO dispara por bloco — mas cai na checagem de intervalo, que também não bate", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 5_000).toISOString(), // 5s atrás, abaixo do piso de 8s
        ultimoBlocoIndice: 2,
        blocoAtualIndice: 3,
        blocoAtualOrigem: "manual",
        houveSegmentoNovo: true, // mesmo COM fala nova, 5s < 45s do intervalo
      }),
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("bloco não mudou (mesmo índice) → gatilho de virada não se aplica, só o de intervalo decide", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 46_000).toISOString(),
        ultimoBlocoIndice: 3,
        blocoAtualIndice: 3,
        blocoAtualOrigem: "manual",
        houveSegmentoNovo: true,
      }),
    );
    expect(r).toEqual({ dispara: true, gatilho: "intervalo" });
  });

  it("virada de bloco tem PRIORIDADE sobre intervalo quando os dois bateriam ao mesmo tempo", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 50_000).toISOString(), // > 45s (intervalo bateria) E > 8s (piso de bloco bateria)
        ultimoBlocoIndice: 1,
        blocoAtualIndice: 2,
        blocoAtualOrigem: "manual",
        houveSegmentoNovo: true,
      }),
    );
    expect(r.gatilho).toBe("virada_bloco");
  });

  it("primeira avaliação (ultimoBlocoIndice=null) NUNCA dispara por virada de bloco — não há 'antes' para comparar", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: null,
        ultimoBlocoIndice: null,
        blocoAtualIndice: 5,
        blocoAtualOrigem: "manual",
        houveSegmentoNovo: false,
      }),
    );
    expect(r.gatilho).not.toBe("virada_bloco");
  });

  // -------------------------------------------------------------------------
  // Fase 12, Fatia 1 — a trava contra o laço de realimentação. Sem ela, o
  // ciclo dispara em cascata: infere bloco novo → grava → a avaliação
  // seguinte vê o índice mudar → dispara "virada de bloco" (furando o piso
  // do intervalo) → infere de novo → repete.
  // -------------------------------------------------------------------------

  it("🔴 TRAVA: mudou de índice mas origem='inferido' → NÃO dispara por virada_bloco (mudança da própria IA não é gatilho)", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 20_000).toISOString(), // > piso de 8s
        ultimoBlocoIndice: 2,
        blocoAtualIndice: 3,
        blocoAtualOrigem: "inferido",
        houveSegmentoNovo: false, // sem fala nova: intervalo também não bateria
      }),
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("🔴 TRAVA: origem='indisponivel' também não conta como virada, mesmo com índice mudando", () => {
    const r = decidirGatilho(
      estado({
        ultimoCicloEm: new Date(AGORA - 20_000).toISOString(),
        ultimoBlocoIndice: 0,
        blocoAtualIndice: 1,
        blocoAtualOrigem: "indisponivel",
        houveSegmentoNovo: false,
      }),
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("🔴 TESTE DE ACEITE (obrigatório, encomendado pelo coordenador): 3 avaliações seguidas com bloco INFERIDO diferente a cada uma não disparam NENHUM ciclo extra", () => {
    // Simula 3 janelas de tempo (cada uma > piso de 8s desde a anterior, e >
    // 45s de intervalo também bateria SE fosse considerado) em que a IA
    // inferiu um bloco novo a cada avaliação — o cenário exato do laço.
    const janelas = [
      { ultimoBlocoIndice: 0, blocoAtualIndice: 1, ultimoCicloEmMs: AGORA - 60_000 },
      { ultimoBlocoIndice: 1, blocoAtualIndice: 2, ultimoCicloEmMs: AGORA - 40_000 },
      { ultimoBlocoIndice: 2, blocoAtualIndice: 3, ultimoCicloEmMs: AGORA - 20_000 },
    ];

    for (const janela of janelas) {
      const r = decidirGatilho(
        estado({
          ultimoCicloEm: new Date(janela.ultimoCicloEmMs).toISOString(),
          ultimoBlocoIndice: janela.ultimoBlocoIndice,
          blocoAtualIndice: janela.blocoAtualIndice,
          blocoAtualOrigem: "inferido",
          houveSegmentoNovo: false,
        }),
      );
      expect(r).toEqual({ dispara: false, gatilho: null });
    }
  });
});

// ---------------------------------------------------------------------------
// avaliarGatilho — camada de leitura (mock de banco)
// ---------------------------------------------------------------------------

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  constructor(
    private readonly tabela: string,
    private readonly respostas: { ciclo: Resultado; segmento: Resultado },
  ) {}
  select() { return this; }
  eq() { return this; }
  gt() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    return Promise.resolve(this.tabela === "copiloto_ciclos" ? this.respostas.ciclo : this.respostas.segmento);
  }
  then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
    return this.maybeSingle().then(ok) as PromiseLike<R1>;
  }
}

function cliente(respostas: { ciclo: Resultado; segmento: Resultado }): SupabaseClient {
  return { from: (t: string) => new ConsultaFalsa(t, respostas) } as unknown as SupabaseClient;
}

describe("avaliarGatilho — camada de leitura", () => {
  it("nenhum ciclo anterior, nenhum segmento → não dispara", async () => {
    const r = await avaliarGatilho(cliente({ ciclo: { data: null, error: null }, segmento: { data: null, error: null } }), {
      sessaoId: "s1",
      blocoAtualIndice: 0,
      blocoAtualOrigem: "manual",
      intervaloSegundos: 45,
      agoraMs: AGORA,
    });
    expect(r).toEqual({ dispara: false, gatilho: null });
  });

  it("nenhum ciclo anterior, HÁ segmento existente → dispara por intervalo (1ª avaliação)", async () => {
    const r = await avaliarGatilho(
      cliente({ ciclo: { data: null, error: null }, segmento: { data: { ordem: 1 }, error: null } }),
      { sessaoId: "s1", blocoAtualIndice: 0, blocoAtualOrigem: "manual", intervaloSegundos: 45, agoraMs: AGORA },
    );
    expect(r).toEqual({ dispara: true, gatilho: "intervalo" });
  });

  it("falha de leitura NUNCA dispara — mesmo princípio do gate/orçamento", async () => {
    const r = await avaliarGatilho(
      cliente({ ciclo: { data: null, error: { code: "08006", message: "conexão perdida" } }, segmento: { data: null, error: null } }),
      { sessaoId: "s1", blocoAtualIndice: 0, blocoAtualOrigem: "manual", intervaloSegundos: 45, agoraMs: AGORA },
    );
    expect(r).toEqual({ dispara: false, gatilho: null });
  });
});
