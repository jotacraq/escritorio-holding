import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAVE_EXPURGO_ATIVO, CHAVE_RETENCAO_DIAS_SEGMENTOS, etapaExpurgoSegmentosCopiloto } from "./expurgo";

/**
 * Expurgo de `sessoes_copiloto_segmentos` — Fase 10, Fatia 5 (§8, §10 B69).
 * Foco do aceite:
 *   1. `copiloto_sessao.expurgo_ativo` (0098) e `retencao_dias_segmentos`
 *      (0091) são DOIS interruptores independentes — falta qualquer um,
 *      ZERO linha é tocada.
 *   2. 🔴 ORDEM: só expurga sessão com `transcricao_id` preenchido
 *      (consolidada) — nunca uma sessão sem transcrição, mesmo com
 *      segmentos vencidos há muito mais que o prazo.
 *   3. Carimbo em `sessoes_copiloto` só quando TODOS os segmentos vencidos
 *      da sessão já saíram — nunca "pela metade".
 *   4. Teto por passada (`LOTE_SEGMENTOS`) — `restaLote=true` avisa a
 *      próxima passagem para continuar, sem nunca truncar sem sinalizar.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- mock de builder encadeável do supabase-js */

interface Config {
  chave: string;
  valor: unknown;
}

interface SessaoCopilotoRow {
  sessao_id: string;
  transcricao_id: string | null;
  expurgo_segmentos_em: string | null;
  /** Backstop do DELETE (achado do coordenador): só segmento com
   * `criado_em <= encerrado_em` é apagável. `undefined` nos fixtures
   * antigos (pré-correção) É PROPOSITAL num dos testes novos — simula
   * sessão sem `encerrado_em` conhecido, que deve ficar fail-closed. */
  encerrado_em?: string | null;
  /** Motivo gravado pelo carimbo — só lido pelos testes que verificam a
   * distinção entre motivo padrão e motivo "com retidos" (achado (i)+(ii)
   * do Fable). `undefined` nos fixtures que não verificam este campo. */
  expurgo_segmentos_motivo?: string | null;
}

interface SegmentoRow {
  id: string;
  sessao_id: string;
  criado_em: string;
}

/**
 * Cliente falso ÚNICO para todo o teste, com estado mutável em memória para
 * `configuracoes`, `sessoes_copiloto` e `sessoes_copiloto_segmentos` — o
 * bastante para exercitar select/delete/update/count sem depender de um
 * builder específico por chamada (o módulo real encadeia `.select().not()
 * .is().limit()`, `.select().in().lt().limit()`, `.delete().in()`,
 * `.select(..., {count:'exact',head:true}).eq().lt()` e
 * `.update().eq().is()` — o mock cobre cada forma usada por `expurgo.ts`).
 */
function clienteFalso(estado: { configs: Config[]; sessoes: SessaoCopilotoRow[]; segmentos: SegmentoRow[] }): SupabaseClient {
  const from = vi.fn((tabela: string): any => {
    if (tabela === "configuracoes") {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (_campo: string, valor: string) => {
        builder._chave = valor;
        return builder;
      };
      builder.maybeSingle = async () => {
        const linha = estado.configs.find((c) => c.chave === builder._chave);
        return { data: linha ? { valor: linha.valor } : null, error: null };
      };
      return builder;
    }

    if (tabela === "sessoes_copiloto") {
      const builder: any = { _filtros: {} };
      builder.select = () => builder;
      builder.order = () => builder;
      builder.not = (campo: string, _op: string, _valor: null) => {
        builder._filtros[campo] = "not_null";
        return builder;
      };
      builder.is = (campo: string, valor: null) => {
        builder._filtros[campo] = valor;
        return builder;
      };
      builder.eq = (campo: string, valor: string) => {
        builder._filtros[campo] = valor;
        return builder;
      };
      builder.limit = () => builder;
      builder.returns = () => builder;
      builder.update = (patch: Record<string, unknown>, opts?: { count?: string }) => {
        builder._patch = patch;
        builder._patchCount = opts?.count === "exact";
        return builder;
      };
      // `.is('expurgo_segmentos_em', null)` no UPDATE (idempotência) reusa `eq`/`is` acima —
      // mas o UPDATE precisa da sessão-alvo via `.eq('sessao_id', ...)`.
      builder.then = (resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) => {
        if (builder._patch) {
          const alvo = estado.sessoes.find((s) => s.sessao_id === builder._filtros.sessao_id);
          let carimbouAgora = false;
          if (alvo && alvo.expurgo_segmentos_em === null) {
            Object.assign(alvo, builder._patch);
            carimbouAgora = true;
          }
          return Promise.resolve(resolve({ data: null, error: null, count: carimbouAgora ? 1 : 0 }));
        }
        const linhas = estado.sessoes.filter((s) => {
          if (builder._filtros.transcricao_id === "not_null" && s.transcricao_id === null) return false;
          if ("expurgo_segmentos_em" in builder._filtros && s.expurgo_segmentos_em !== builder._filtros.expurgo_segmentos_em) return false;
          return true;
        });
        return Promise.resolve(
          resolve({ data: linhas.map((s) => ({ sessao_id: s.sessao_id, encerrado_em: s.encerrado_em ?? null })), error: null }),
        );
      };
      return builder;
    }

    if (tabela === "sessoes_copiloto_segmentos") {
      const builder: any = { _filtros: {} };
      builder.select = (_campos: string, opts?: { count?: string; head?: boolean }) => {
        builder._count = opts?.count === "exact";
        return builder;
      };
      builder.in = (campo: string, valores: string[]) => {
        builder._filtros[campo] = { tipo: "in", valores };
        return builder;
      };
      builder.eq = (campo: string, valor: string) => {
        builder._filtros[campo] = { tipo: "eq", valor };
        return builder;
      };
      builder.lt = (campo: string, valor: string) => {
        builder._filtros[campo] = { tipo: "lt", valor };
        return builder;
      };
      builder.limit = () => builder;
      builder.returns = () => builder;
      builder.delete = () => {
        builder._delete = true;
        return builder;
      };

      const casa = (linha: SegmentoRow) => {
        for (const [campo, filtro] of Object.entries(builder._filtros) as [string, any][]) {
          const v = (linha as any)[campo];
          if (filtro.tipo === "in" && !filtro.valores.includes(v)) return false;
          if (filtro.tipo === "eq" && v !== filtro.valor) return false;
          if (filtro.tipo === "lt" && !(v < filtro.valor)) return false;
        }
        return true;
      };

      builder.then = (resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) => {
        const linhas = estado.segmentos.filter(casa);
        if (builder._delete) {
          for (const l of linhas) {
            const idx = estado.segmentos.indexOf(l);
            if (idx >= 0) estado.segmentos.splice(idx, 1);
          }
          return Promise.resolve(resolve({ data: linhas, error: null }));
        }
        if (builder._count) {
          return Promise.resolve(resolve({ data: null, error: null, count: linhas.length }));
        }
        return Promise.resolve(resolve({ data: linhas, error: null }));
      };
      return builder;
    }

    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });
  return { from } as unknown as SupabaseClient;
}

const HOJE = Date.now();
const DIAS = (n: number) => new Date(HOJE - n * 86_400_000).toISOString();

describe("etapaExpurgoSegmentosCopiloto", () => {
  it("expurgo_ativo=false (default de fábrica) → ZERO linha tocada, pulada='expurgo_desligado'", async () => {
    const cliente = clienteFalso({
      configs: [{ chave: CHAVE_EXPURGO_ATIVO, valor: false }],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(20) }],
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(100) }],
    });
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r).toEqual({ segmentosRemovidos: 0, sessoesConcluidas: 0, sessoesComSegmentosRetidos: 0, pulada: "expurgo_desligado" });
  });

  it("expurgo_ativo=true mas retencao_dias_segmentos com valor INVÁLIDO (0) → ZERO linha tocada", async () => {
    const cliente = clienteFalso({
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 0 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(20) }],
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(100) }],
    });
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0);
    expect(r.pulada).toBe("sem_retencao_configurada");
  });

  it("🔴 sessão SEM transcrição consolidada (transcricao_id null) — segmento vencido há 100 dias NÃO é removido", async () => {
    const cliente = clienteFalso({
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: null, expurgo_segmentos_em: null, encerrado_em: DIAS(20) }],
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(100) }],
    });
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0);
    expect(r.sessoesConcluidas).toBe(0);
  });

  it("sessão COM transcrição consolidada, segmento vencido ANTES do encerramento → removido e sessão carimbada", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      // encerrado_em POSTERIOR ao segmento — o backstop deixa passar.
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(29) } as SessaoCopilotoRow],
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(30) }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(r.sessoesConcluidas).toBe(1);
    expect(estado.segmentos).toHaveLength(0);
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
  });

  it("segmento DENTRO do prazo (recente) NÃO é removido, e a sessão NÃO é carimbada", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(20) } as SessaoCopilotoRow],
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(1) }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0);
    expect(r.sessoesConcluidas).toBe(0);
    expect(estado.segmentos).toHaveLength(1);
    expect(estado.sessoes[0].expurgo_segmentos_em).toBeNull();
  });

  it("sessão com MISTURA de segmento vencido e recente → remove só o vencido, NÃO carimba (ainda tem pendência)", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(15) } as SessaoCopilotoRow],
      segmentos: [
        { id: "seg-velho", sessao_id: "s1", criado_em: DIAS(30) },
        { id: "seg-novo", sessao_id: "s1", criado_em: DIAS(1) },
      ],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(r.sessoesConcluidas).toBe(1); // o único vencido saiu, zero sobrou → carimba
    expect(estado.segmentos.map((s) => s.id)).toEqual(["seg-novo"]);
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
  });

  it("idempotente: 2ª passada sobre sessão JÁ carimbada não recarimba nem tenta apagar de novo", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [
        { sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: "2026-01-01T00:00:00Z", encerrado_em: DIAS(60) } as SessaoCopilotoRow,
      ],
      segmentos: [] as SegmentoRow[],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    // sessão já carimbada não entra nas "elegíveis" (filtro expurgo_segmentos_em is null)
    expect(r.segmentosRemovidos).toBe(0);
    expect(r.sessoesConcluidas).toBe(0);
    expect(estado.sessoes[0].expurgo_segmentos_em).toBe("2026-01-01T00:00:00Z");
  });

  it("MÚLTIPLAS sessões consolidadas com segmento vencido → todas removidas e carimbadas na mesma passagem", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [
        { sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(29) } as SessaoCopilotoRow,
        { sessao_id: "s2", transcricao_id: "t2", expurgo_segmentos_em: null, encerrado_em: DIAS(29) } as SessaoCopilotoRow,
        // s3 NÃO consolidada — regra dura §🔴: nunca expurga sem transcrição, mesmo vencida há 200 dias.
        { sessao_id: "s3", transcricao_id: null, expurgo_segmentos_em: null, encerrado_em: DIAS(199) } as SessaoCopilotoRow,
      ],
      segmentos: [
        { id: "seg-s1", sessao_id: "s1", criado_em: DIAS(30) },
        { id: "seg-s2", sessao_id: "s2", criado_em: DIAS(30) },
        { id: "seg-s3", sessao_id: "s3", criado_em: DIAS(200) },
      ],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(2);
    expect(r.sessoesConcluidas).toBe(2);
    expect(estado.segmentos.map((s) => s.id)).toEqual(["seg-s3"]); // s3 intocada
    expect(estado.sessoes.find((s) => s.sessao_id === "s3")!.expurgo_segmentos_em).toBeNull();
  });

  it("erro real do banco (não 42703) propaga como `erro`, nunca finge sucesso", async () => {
    const clienteComFalha = {
      from: vi.fn((tabela: string) => {
        if (tabela === "configuracoes") {
          const builder: any = {};
          builder.select = () => builder;
          builder.eq = (_c: string, v: string) => {
            builder._chave = v;
            return builder;
          };
          builder.maybeSingle = async () => {
            if (builder._chave === CHAVE_EXPURGO_ATIVO) return { data: { valor: true }, error: null };
            if (builder._chave === CHAVE_RETENCAO_DIAS_SEGMENTOS) return { data: { valor: 7 }, error: null };
            return { data: null, error: null };
          };
          return builder;
        }
        if (tabela === "sessoes_copiloto") {
          const builder: any = {};
          builder.select = () => builder;
          builder.not = () => builder;
          builder.is = () => builder;
          builder.order = () => builder;
          builder.limit = () => builder;
          builder.returns = () => builder;
          builder.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve(resolve({ data: null, error: { message: "conexao_perdida" } }));
          return builder;
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      }),
    } as unknown as SupabaseClient;

    const r = await etapaExpurgoSegmentosCopiloto(clienteComFalha);
    expect(r.segmentosRemovidos).toBe(0);
    expect(r.sessoesConcluidas).toBe(0);
    expect(r.erro).toBeTruthy();
    expect(r.pulada).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 🔴 BACKSTOP — achado do coordenador: "fala digitada depois do
// encerramento é destruída em silêncio". `removerSegmentosVencidos` só
// apaga segmento com `criado_em <= sessoes_copiloto.encerrado_em`, mesmo
// que a correção (a) na rota (`POST .../copiloto/segmentos` recusando
// sessão encerrada) seja reintroduzida com um buraco no futuro. Trava no
// CAMINHO DE SAÍDA (o DELETE em si), não só na feature que grava.
// ---------------------------------------------------------------------------
describe("etapaExpurgoSegmentosCopiloto — backstop do DELETE (criado_em <= encerrado_em)", () => {
  it("🔴 segmento gravado DEPOIS do encerramento, mas vencido por IDADE: NUNCA é apagado — mas a sessão SAI DO POOL (achado (i)+(ii) do Fable)", async () => {
    // 🔴 CORREÇÃO (achado (i)+(ii) do Fable via coordenador — "a pendência
    // eterna ressuscita o starvation que você matou"). Este teste ANTES
    // provava "sessoesConcluidas: 0, nunca carimbado" — comportamento que
    // parecia certo isolado, mas mantinha a sessão ETERNAMENTE na frente
    // do FIFO. O segmento CONTINUA nunca apagado (fail-closed intacto);
    // o que muda é que a sessão sai do pool com um motivo DISTINTO e
    // VERDADEIRO, visível em `sessoesComSegmentosRetidos`.
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      // encerrado_em ANTES do segmento — simula o cenário do coordenador:
      // a advogada encerrou, digitou um detalhe depois, e (por um buraco
      // futuro na correção de rota) o segmento foi gravado mesmo assim.
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow],
      segmentos: [{ id: "seg-pos-encerramento", sessao_id: "s1", criado_em: DIAS(29) }], // depois de encerrado_em, mas vencido por idade
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0);
    expect(estado.segmentos).toHaveLength(1); // nunca apagado — fail-closed intacto
    expect(r.sessoesConcluidas).toBe(1); // saiu do pool
    expect(r.sessoesComSegmentosRetidos).toBe(1); // anomalia visível
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
    expect(estado.sessoes[0].expurgo_segmentos_motivo).toContain("retido");
  });

  it("🔴 sessão SEM encerrado_em conhecido: FAIL-CLOSED (segmento nunca apagado), mas SAI DO POOL com motivo distinto (achado (ii) residual)", async () => {
    // 🔴 CORREÇÃO (achado (ii) do Fable via coordenador, aplicado ao caso
    // RESIDUAL: sessão elegível cujo `trazidas` tem linha vencida, mas
    // NENHUMA é apagável porque `encerrado_em` é desconhecido — sem a
    // correção, essa sessão NUNCA entraria em `sessoesAfetadas` (só quem
    // teve DELETE) e `carimbarSessoesSemPendencia` jamais a avaliaria: o
    // MESMO starvation do achado (ii), por um caminho diferente do
    // "backstop retendo pós-encerramento". `sessoesComVencidoNaoApagavel`
    // (`removerSegmentosVencidos`) é o que garante que ela seja avaliada
    // mesmo sem ter tido DELETE nesta passagem.
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null } as SessaoCopilotoRow], // encerrado_em ausente
      segmentos: [{ id: "seg1", sessao_id: "s1", criado_em: DIAS(100) }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0);
    expect(estado.segmentos).toHaveLength(1); // fail-closed intacto — nunca apagado
    // 🔴 SEM `encerrado_em`, este job NUNCA vai conseguir confirmar o
    // segmento como apagável — "sobra" aqui não é "pela metade" (a
    // próxima passagem não resolve sozinha, porque a causa não é o teto do
    // lote). Tratar como "pela metade" prenderia esta sessão eternamente
    // na frente do FIFO — o MESMO starvation do achado (ii). A sessão SAI
    // DO POOL, carimbada com motivo distinto que documenta a causa real
    // (fail-closed por falta de dado, não retenção pós-encerramento).
    expect(r.sessoesConcluidas).toBe(1);
    expect(r.sessoesComSegmentosRetidos).toBe(1);
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
    expect(estado.sessoes[0].expurgo_segmentos_motivo).toContain("sem encerrado_em conhecido");
  });

  it("🔴 MISTURA: segmento ANTES do encerramento é apagado; segmento DEPOIS (retido pelo backstop) SAI DO POOL com motivo distinto — não fica pendente eterna", async () => {
    // 🔴 CORREÇÃO (achado (i)+(ii) do Fable via coordenador — "a pendência
    // eterna ressuscita o starvation que você matou"). Este teste ANTES
    // provava "não carimba" — decisão que parecia certa isolada, mas
    // travava a sessão ETERNAMENTE na frente do FIFO (nunca some do
    // pool). Agora prova o comportamento CORRIGIDO: todos os vencidos
    // RESTANTES (só `seg-depois`, já que `seg-antes` foi apagado) estão
    // retidos pelo backstop → a sessão É carimbada, com um motivo
    // DISTINTO do padrão, e o segmento retido continua intacto (nunca
    // apagado — fail-closed preservado).
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow],
      segmentos: [
        { id: "seg-antes", sessao_id: "s1", criado_em: DIAS(31) }, // antes do encerramento — apagável
        { id: "seg-depois", sessao_id: "s1", criado_em: DIAS(29) }, // depois — retido pelo backstop, mesmo vencido
      ],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(estado.segmentos.map((s) => s.id)).toEqual(["seg-depois"]); // retido, NUNCA apagado
    expect(r.sessoesConcluidas).toBe(1); // saiu do pool
    expect(r.sessoesComSegmentosRetidos).toBe(1); // a anomalia É visível no resultado
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
    // Motivo VERDADEIRO — nunca o motivo padrão de "vencida" (os segmentos
    // NÃO foram todos apagados; 1 continua lá, preservado).
    expect(estado.sessoes[0].expurgo_segmentos_motivo).toContain("retido");
  });

  it("caminho comum (nada retido, tudo apagável): sessoesComSegmentosRetidos fica em 0, motivo padrão", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(10) } as SessaoCopilotoRow],
      segmentos: [{ id: "seg-vencido-normal", sessao_id: "s1", criado_em: DIAS(30) }], // vencido, ANTES do encerramento — apagável
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(estado.segmentos).toHaveLength(0);
    expect(r.sessoesConcluidas).toBe(1); // nada sobrou — carimbo normal
    expect(r.sessoesComSegmentosRetidos).toBe(0); // NÃO é o caso "com retidos" — não contamina a métrica
    expect(estado.sessoes[0].expurgo_segmentos_motivo).not.toContain("retido");
  });

  it("segmento EXATAMENTE no instante do encerramento (criado_em === encerrado_em) é apagável — `<=`, não `<`", async () => {
    const encerradoEm = DIAS(30);
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: encerradoEm } as SessaoCopilotoRow],
      segmentos: [{ id: "seg-no-instante", sessao_id: "s1", criado_em: encerradoEm }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(estado.segmentos).toHaveLength(0);
  });

  // 🔴 Achado do coordenador — "a fronteira <= compara strings de formatos
  // diferentes". `criado_em` (PostgREST): microssegundos + offset explícito
  // (`+00:00`). `encerrado_em` (aplicação, `new Date().toISOString()`):
  // milissegundos + `Z`. O teste ANTERIOR usava o MESMO formato nos dois
  // lados — não provava nada sobre produção, que nunca usa o mesmo formato
  // nas duas colunas. Este teste usa formatos DIFERENTES de propósito, no
  // MESMO instante real (bem no passado, para também vencer por idade),
  // para prender a comparação lexicográfica se ela voltar (comparar string
  // — não Date.parse — faria este teste falhar, porque "+00:00" ordena
  // DEPOIS de "Z" lexicograficamente, mesmo sendo o MESMO instante).
  it("🔴 mistura de FORMATOS (segmento em 'Z', encerrado_em em '+00:00') no MESMO instante real: ainda compara corretamente", async () => {
    // Prova ISOLADA de que a comparação NÃO É LEXICOGRÁFICA: '+' (0x2B) tem
    // código menor que 'Z' (0x5A), então "...500+00:00" ordena ANTES de
    // "...500Z" como STRING — mesmo sendo o MESMO instante em ISO-8601. Se
    // `removerSegmentosVencidos` voltar a comparar string (`<=` sem
    // `Date.parse`), este teste PEGA a regressão nesta combinação exata
    // (a combinação oposta, por acidente, compararia certo mesmo com bug —
    // por isso o formato de cada lado importa, não só "formatos diferentes").
    const instanteZ = DIAS(100); // "...000Z" — formato de new Date().toISOString()
    const instantePg = instanteZ.replace("Z", "+00:00"); // mesmo instante, formato PostgREST
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      // encerrado_em em formato PostgREST; criado_em (abaixo) em formato Z —
      // a combinação que a comparação lexicográfica erraria.
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: instantePg } as SessaoCopilotoRow],
      segmentos: [{ id: "seg-formato-misto", sessao_id: "s1", criado_em: instanteZ }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    // Mesmo instante real, formatos diferentes: `<=` tem de reconhecer
    // IGUALDADE (apagável), não desigualdade por causa da diferença textual.
    expect(r.segmentosRemovidos).toBe(1);
    expect(estado.segmentos).toHaveLength(0);
  });

  // 🔴 Distingue de propósito o caso "pela metade" DE VERDADE (o teto do
  // lote cortou, mas o que sobra AINDA É APAGÁVEL — a próxima passagem
  // resolve sozinha) do caso "nunca vai resolver sozinho" (retido/sem
  // encerrado_em, corrigido acima). Simula o corte do lote com um mock
  // PRÓPRIO: o DELETE só alcança 1 dos 2 segmentos vencidos e apagáveis
  // (como se `LOTE_SEGMENTOS` tivesse cortado ali); o segundo, também
  // apagável, sobra — a sessão NÃO deve sair do pool.
  it("🔴 sobra vencido APAGÁVEL (o teto da QUERY de leitura cortou, não backstop): continua 'pela metade', NÃO sai do pool", async () => {
    // O corte do lote acontece na QUERY DE LEITURA (`.limit(LOTE_SEGMENTOS)`
    // em `removerSegmentosVencidos`), não no DELETE — uma vez lidas, todas
    // as linhas apagáveis são removidas de uma vez (`delete().in(...)`).
    // Este mock simula a 1ª leitura trazendo só 1 dos 2 segmentos vencidos
    // e apagáveis (como se o teto tivesse cortado ali); o 2º, que sobra,
    // AINDA é apagável (dentro do encerrado_em) — a sessão NÃO deve sair
    // do pool, porque a próxima passagem resolve sozinha.
    const encerradoEm = DIAS(5); // depois dos dois segmentos — ambos apagáveis
    let jaDeletou = false;

    const from = vi.fn((tabela: string): any => {
      if (tabela === "configuracoes") {
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = (_c: string, v: string) => {
          builder._chave = v;
          return builder;
        };
        builder.maybeSingle = async () => {
          if (builder._chave === CHAVE_EXPURGO_ATIVO) return { data: { valor: true }, error: null };
          if (builder._chave === CHAVE_RETENCAO_DIAS_SEGMENTOS) return { data: { valor: 7 }, error: null };
          return { data: null, error: null };
        };
        return builder;
      }
      if (tabela === "sessoes_copiloto") {
        const builder: any = {};
        builder.select = () => builder;
        builder.not = () => builder;
        builder.is = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.returns = () => builder;
        builder.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data: [{ sessao_id: "s1", encerrado_em: encerradoEm }], error: null }));
        return builder;
      }
      if (tabela === "sessoes_copiloto_segmentos") {
        const builder: any = {};
        builder.select = () => builder;
        builder.in = () => builder;
        builder.eq = () => builder;
        builder.lt = () => builder;
        builder.limit = () => builder;
        builder.returns = () => builder;
        builder.delete = () => {
          builder._delete = true;
          return builder;
        };
        builder.then = (resolve: (v: unknown) => unknown) => {
          if (builder._delete) {
            jaDeletou = true;
            // Apaga só o que foi LIDO na 1ª query (seg-1) — reflete o real:
            // `ids` vem da leitura, o DELETE nunca "corta" sozinho.
            return Promise.resolve(resolve({ data: [{ id: "seg-1" }], error: null }));
          }
          if (!jaDeletou) {
            // 1ª leitura (removerSegmentosVencidos, `.limit(LOTE_SEGMENTOS)`):
            // simula o TETO DA QUERY só trazendo seg-1 — seg-2 (também
            // vencido e apagável) ficou de fora desta passagem.
            return Promise.resolve(
              resolve({ data: [{ id: "seg-1", sessao_id: "s1", criado_em: DIAS(30) }], error: null }),
            );
          }
          // 2ª leitura (carimbarSessoesSemPendencia, depois do DELETE):
          // sobrou seg-2, AINDA apagável (criado_em < encerrado_em) — não
          // foi lido na 1ª passagem por causa do teto, mas existe no banco.
          return Promise.resolve(resolve({ data: [{ criado_em: DIAS(20) }], error: null }));
        };
        return builder;
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    });

    const r = await etapaExpurgoSegmentosCopiloto({ from } as unknown as SupabaseClient);
    expect(r.segmentosRemovidos).toBe(1); // só o que a query de leitura trouxe
    expect(r.sessoesConcluidas).toBe(0); // NÃO sai do pool — sobra é apagável, próxima passagem resolve
    expect(r.sessoesComSegmentosRetidos).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 🔴 5º CAMINHO — achado do coordenador: "squatter eterno por soluço de
// banco". Sessão elegível com ZERO segmentos restantes (esvaziada numa
// passagem ANTERIOR cujo carimbo abortou por erro transiente, ou cujo
// processo morreu entre o DELETE e o carimbo) nunca aparecia em
// `sessoesAfetadas` nem `sessoesComVencidoNaoApagavel` — os dois só
// existem quando `removerSegmentosVencidos` encontra segmento VENCIDO
// nesta passagem. `buscarSessoesEsvaziadas` fecha esse gap.
// ---------------------------------------------------------------------------
describe("etapaExpurgoSegmentosCopiloto — 5º caminho (sessão esvaziada sem carimbo)", () => {
  it("🔴 sessão elegível com ZERO segmentos (esvaziada em passagem anterior): é carimbada AGORA, com motivo distinto", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      // Elegível (transcricao_id preenchido, expurgo_segmentos_em null) mas
      // SEM NENHUM segmento — simula o squatter: um DELETE de passagem
      // anterior já removeu tudo, mas o carimbo daquela passagem abortou
      // (timeout de rede) antes de chegar aqui.
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow],
      segmentos: [] as SegmentoRow[],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(0); // nada a remover — já estava vazia
    expect(r.sessoesConcluidas).toBe(1); // MAS é carimbada agora — sai do pool
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
    expect(estado.sessoes[0].expurgo_segmentos_motivo).toContain("esvaziada em passagem anterior");
  });

  it("sessão que NUNCA teve segmento algum (nem vencido) também é carimbada — mesmo tratamento", async () => {
    // Cenário levemente diferente do "esvaziada": aqui é uma sessão
    // consolidada que nunca recebeu NENHUM segmento (ex.: bot nunca
    // transcreveu nada). Semanticamente é o mesmo estado observável —
    // zero segmentos restantes — e deve sair do pool do mesmo jeito, sem
    // depender de "por que" está vazia.
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [{ sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow],
      segmentos: [] as SegmentoRow[],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.sessoesConcluidas).toBe(1);
    expect(estado.sessoes[0].expurgo_segmentos_em).not.toBeNull();
  });

  it("MISTURA: 1 sessão com vencido normal (motivo padrão) + 1 sessão esvaziada (motivo distinto), na MESMA passagem", async () => {
    const estado = {
      configs: [
        { chave: CHAVE_EXPURGO_ATIVO, valor: true },
        { chave: CHAVE_RETENCAO_DIAS_SEGMENTOS, valor: 7 },
      ],
      sessoes: [
        { sessao_id: "s1", transcricao_id: "t1", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow, // vencido normal
        { sessao_id: "s2", transcricao_id: "t2", expurgo_segmentos_em: null, encerrado_em: DIAS(30) } as SessaoCopilotoRow, // esvaziada
      ],
      segmentos: [{ id: "seg-s1", sessao_id: "s1", criado_em: DIAS(30) }],
    };
    const cliente = clienteFalso(estado);
    const r = await etapaExpurgoSegmentosCopiloto(cliente);
    expect(r.segmentosRemovidos).toBe(1);
    expect(r.sessoesConcluidas).toBe(2); // as DUAS saem do pool
    const s1 = estado.sessoes.find((s) => s.sessao_id === "s1")!;
    const s2 = estado.sessoes.find((s) => s.sessao_id === "s2")!;
    expect(s1.expurgo_segmentos_motivo).not.toContain("esvaziada"); // motivo padrão
    expect(s2.expurgo_segmentos_motivo).toContain("esvaziada em passagem anterior"); // motivo distinto
  });

  it("🔴 erro no carimbo de UMA sessão NÃO impede o carimbo das outras (isolamento por sessão)", async () => {
    // Simula timeout de rede no UPDATE de carimbo da sessão s1 — s2 deve
    // ser carimbada normalmente, na MESMA passagem.
    const encerradoEm = DIAS(30);
    let tentativasUpdateS1 = 0;

    const from = vi.fn((tabela: string): any => {
      if (tabela === "configuracoes") {
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = (_c: string, v: string) => {
          builder._chave = v;
          return builder;
        };
        builder.maybeSingle = async () => {
          if (builder._chave === CHAVE_EXPURGO_ATIVO) return { data: { valor: true }, error: null };
          if (builder._chave === CHAVE_RETENCAO_DIAS_SEGMENTOS) return { data: { valor: 7 }, error: null };
          return { data: null, error: null };
        };
        return builder;
      }
      if (tabela === "sessoes_copiloto") {
        const builder: any = { _filtros: {} };
        builder.select = () => builder;
        builder.not = () => builder;
        builder.is = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.returns = () => builder;
        builder.eq = (campo: string, valor: string) => {
          builder._filtros[campo] = valor;
          return builder;
        };
        builder.update = (patch: Record<string, unknown>) => {
          builder._patch = patch;
          return builder;
        };
        builder.then = (resolve: (v: unknown) => unknown) => {
          if (builder._patch) {
            if (builder._filtros.sessao_id === "s1") {
              tentativasUpdateS1++;
              return Promise.resolve(resolve({ data: null, error: { message: "timeout de rede" }, count: null }));
            }
            return Promise.resolve(resolve({ data: null, error: null, count: 1 }));
          }
          return Promise.resolve(
            resolve({
              data: [
                { sessao_id: "s1", encerrado_em: encerradoEm },
                { sessao_id: "s2", encerrado_em: encerradoEm },
              ],
              error: null,
            }),
          );
        };
        return builder;
      }
      if (tabela === "sessoes_copiloto_segmentos") {
        const builder: any = {};
        builder.select = () => builder;
        builder.in = () => builder;
        builder.eq = () => builder;
        builder.lt = () => builder;
        builder.limit = () => builder;
        builder.returns = () => builder;
        builder.delete = () => {
          builder._delete = true;
          return builder;
        };
        builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })); // ambas esvaziadas
        return builder;
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    });

    const r = await etapaExpurgoSegmentosCopiloto({ from } as unknown as SupabaseClient);
    // s1 falhou (timeout simulado) — não conta como concluída; s2 conta.
    expect(r.sessoesConcluidas).toBe(1);
    expect(tentativasUpdateS1).toBe(1); // tentou, falhou, seguiu em frente — não travou o laço
  });
});

